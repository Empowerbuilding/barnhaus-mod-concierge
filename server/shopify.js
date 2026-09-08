import Anthropic from "@anthropic-ai/sdk";

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || "sf43pj-td.myshopify.com";
const API_VERSION = "2026-04";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ---------------------------------------------------------------------------
// Single product fetch (legacy — used by the original concierge chat flow)
// ---------------------------------------------------------------------------
export async function fetchShopifyProduct(handle) {
  const url = `https://${DOMAIN}/admin/api/${API_VERSION}/products.json?handle=${encodeURIComponent(handle)}`;
  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Shopify API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const product = data.products?.[0];
  if (!product) return null;

  return {
    title: product.title,
    body_html: product.body_html,
    price: product.variants?.[0]?.price,
    images: (product.images || []).map(img => ({ src: img.src })),
    tags: product.tags,
  };
}

// ---------------------------------------------------------------------------
// Mod Concierge — plan catalog with in-memory cache
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let planCache = { plans: null, fetchedAt: 0 };
const floorPlanImageCache = new Map(); // productId -> url|null

function stripHtml(html) {
  return (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// Best-effort spec parsing from tags / title / handle / body
function parseSpecs(product) {
  const tags = (product.tags || "").toLowerCase();
  const haystack = [
    tags,
    (product.handle || "").replace(/-/g, "_").toLowerCase(),
    (product.title || "").toLowerCase(),
    stripHtml(product.body_html).slice(0, 1500).toLowerCase(),
  ].join(" || ");

  let beds = null, baths = null, sqft = null;

  // beds: "4_bed", "4 bed", "4_bedroom", "3 bedrooms"
  const bedMatch = haystack.match(/(\d+)[\s_-]*bed(?:room)?s?/);
  if (bedMatch) beds = parseInt(bedMatch[1], 10);

  // baths: "3_bath", "2.5 bath", "2_5_bath", "3-5-baths"
  const bathMatch = haystack.match(/(\d+(?:[._\- ]5)?)[\s_-]*bath(?:room)?s?/);
  if (bathMatch) baths = parseFloat(bathMatch[1].replace(/[._\- ]5/, ".5"));

  // sqft: "2,784 sf", "2784 sq ft", "2-784-sf" (handle), "3000_sq_ft"
  const sfMatch = haystack.match(/(\d{1}[,._\- ]?\d{3})[\s_-]*(?:sf|sq[\s_.-]*ft|square feet|sf living)/);
  if (sfMatch) sqft = parseInt(sfMatch[1].replace(/[^\d]/g, ""), 10);

  return { beds, baths, sqft };
}

// A "plan" product: has "Plan" in the title OR costs more than $50.
// Excludes utility products like "5 Style Credits" ($5, no "Plan" in title).
function isPlanProduct(product) {
  const price = parseFloat(product.variants?.[0]?.price || "0");
  const titleHasPlan = /\bplan\b/i.test(product.title || "");
  const isCredits = /credit/i.test(product.title || "") || /style_credits/i.test(product.tags || "");
  return !isCredits && (titleHasPlan || price > 50);
}

async function fetchAllProducts() {
  const url = `https://${DOMAIN}/admin/api/${API_VERSION}/products.json?limit=250&status=active`;
  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Shopify API error: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.products || [];
}

export async function fetchModPlans({ force = false } = {}) {
  const now = Date.now();
  if (!force && planCache.plans && now - planCache.fetchedAt < CACHE_TTL_MS) {
    return planCache.plans;
  }

  const products = await fetchAllProducts();
  const plans = products.filter(isPlanProduct).map(p => {
    const specs = parseSpecs(p);
    return {
      id: p.id,
      handle: p.handle,
      title: p.title,
      shortTitle: (p.title || "").split("|")[0].trim(),
      description: stripHtml(p.body_html).slice(0, 600),
      body_html: p.body_html,
      price: p.variants?.[0]?.price || null,
      tags: p.tags,
      featuredImage: p.image?.src || p.images?.[0]?.src || null,
      images: (p.images || []).map(img => ({ src: img.src, width: img.width, height: img.height })),
      beds: specs.beds,
      baths: specs.baths,
      sqft: specs.sqft,
      floorPlanImage: floorPlanImageCache.has(p.id) ? (floorPlanImageCache.get(p.id)[0] || null) : null,
    };
  });

  plans.sort((a, b) => a.shortTitle.localeCompare(b.shortTitle));
  planCache = { plans, fetchedAt: now };
  return plans;
}

export async function getModPlan(handle) {
  const plans = await fetchModPlans();
  return plans.find(p => p.handle === handle) || null;
}

// ---------------------------------------------------------------------------
// Floor-plan image selection — one Claude vision call per product, cached.
// Sends up to 8 product images and asks which are 2D floor plans.
// Multi-story plans have multiple sheets — we keep them ALL, ordered by story.
// Cache stores an ARRAY of urls per product id.
// ---------------------------------------------------------------------------

// Order floor-plan sheets by story inferred from filename (1st → 2nd → 3rd)
function storyRank(url) {
  const name = (url.split("/").pop() || "").toLowerCase();
  if (/3rd|third/.test(name)) return 3;
  if (/2nd|second|upper|loft/.test(name)) return 2;
  if (/1st|first|main|ground/.test(name)) return 1;
  return 1.5; // unknown sits after the identified 1st floor
}

export async function resolveFloorPlanImage(plan) {
  const urls = await resolveFloorPlanImages(plan);
  return urls[0] || null;
}

export async function resolveFloorPlanImages(plan) {
  if (!plan) return [];
  if (floorPlanImageCache.has(plan.id)) return floorPlanImageCache.get(plan.id);

  // Candidate selection: floor plans are usually named suggestively, smaller,
  // or near the end of the image list (renders come first). Build a candidate
  // pool of up to 8: filename matches first, then the tail of the list, then the head.
  const all = plan.images || [];
  const nameMatches = all.filter(img =>
    /floor[\s_-]?plan|layout|info|1st|2nd|first[\s_-]?floor|second[\s_-]?floor/i.test(img.src.split("/").pop() || "")
  );
  const pool = [...nameMatches, ...all.slice(-6), ...all.slice(0, 4)];
  const seen = new Set();
  const candidates = pool.filter(img => {
    if (seen.has(img.src)) return false;
    seen.add(img.src);
    return true;
  }).slice(0, 8);
  if (!candidates.length) {
    floorPlanImageCache.set(plan.id, []);
    return [];
  }

  try {
    const content = [];
    candidates.forEach((img, i) => {
      content.push({ type: "text", text: `Image index ${i}:` });
      content.push({ type: "image", source: { type: "url", url: img.src.split("?")[0] } });
    });
    content.push({
      type: "text",
      text: `These are product images for the house plan "${plan.title}". Which image indexes are 2D FLOOR PLANS (top-down room layout drawings with walls, rooms, and dimensions — NOT 3D renderings, NOT exterior photos, NOT elevation drawings)? Reply with ONLY a JSON array of the matching indexes, e.g. [5,6]. If none, reply [].`,
    });

    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 50,
      messages: [{ role: "user", content }],
    });

    const text = res.content.filter(b => b.type === "text").map(b => b.text).join("");
    const arrMatch = text.match(/\[[\d,\s]*\]/);
    const indexes = arrMatch ? JSON.parse(arrMatch[0]) : [];
    const valid = indexes.filter(i => Number.isInteger(i) && i >= 0 && i < candidates.length);
    let urls = [...new Set(valid.map(i => candidates[i].src))];
    if (!urls.length) urls = fallbackFloorPlanImages(plan);
    urls.sort((a, b) => storyRank(a) - storyRank(b));
    floorPlanImageCache.set(plan.id, urls);
    // patch the cached plan list too so /api/mod-plans reflects it
    if (planCache.plans) {
      const cached = planCache.plans.find(p => p.id === plan.id);
      if (cached) cached.floorPlanImage = urls[0] || null;
    }
    return urls;
  } catch (err) {
    console.error(`Floor plan classification failed for ${plan.handle}:`, err.message);
    const urls = fallbackFloorPlanImages(plan);
    if (urls.length) floorPlanImageCache.set(plan.id, urls);
    return urls;
  }
}

// Filename-based fallback heuristic if vision fails
function fallbackFloorPlanImages(plan) {
  const byName = (plan.images || []).filter(img =>
    /floor[\s_-]?plan|layout|(1st|2nd|3rd)[\s_-]?(info|floor)|first[\s_-]?floor|second[\s_-]?floor/i.test(img.src.split("/").pop() || "")
  );
  return [...new Set(byName.map(i => i.src))].sort((a, b) => storyRank(a) - storyRank(b));
}
