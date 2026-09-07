// Concept preview generation — calls the n8n image-edit webhooks.

const FLOOR_PLAN_EDIT_URL =
  process.env.FLOOR_PLAN_EDIT_WEBHOOK ||
  "https://n8n.empowerbuilding.ai/webhook/floor-plan-edit";

const STYLE_SWAP_URL =
  process.env.STYLE_SWAP_WEBHOOK ||
  "https://n8n.empowerbuilding.ai/webhook/2K5uT9uqKxd1Mp3x/webhook/barnhaus-style-swap";

const PREVIEW_TIMEOUT_MS = 120_000; // webhooks take 15-40s; leave headroom

async function postJson(url, payload, timeoutMs = PREVIEW_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(`Webhook ${res.status}: ${text.slice(0, 200)}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generate a floor-plan edit concept.
 * Returns { success, resultUrl, verified, notes }
 */
export async function generateFloorPlanPreview(currentFloorPlanUrl, editPrompt) {
  const data = await postJson(FLOOR_PLAN_EDIT_URL, {
    currentFloorPlanUrl,
    editPrompt,
    planType: "2d",
    model: "pro",
  });
  if (!data.success || !data.editedFloorPlan) {
    throw new Error(`Floor plan edit failed: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return {
    success: true,
    resultUrl: data.editedFloorPlan,
    verified: data.verified ?? null,
    attempt: data.attempt ?? null,
    model: data.model ?? null,
    notes: data.notes ?? null,
  };
}

/**
 * Generate an exterior style-swap concept.
 * Returns { success, resultUrl, notes }
 */
export async function generateExteriorPreview(imageUrl, customPrompt, email) {
  const data = await postJson(STYLE_SWAP_URL, {
    email: email || "concierge@barnhaussteelbuilders.com",
    imageUrl,
    customPrompt,
    is_free_swap: true,
  });
  if (!data.success || !data.resultUrl) {
    throw new Error(`Style swap failed: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { success: true, resultUrl: data.resultUrl, notes: null };
}
