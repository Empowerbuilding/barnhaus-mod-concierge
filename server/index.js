import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { chat } from "./claude.js";
import { fetchShopifyProduct, fetchModPlans, getModPlan, resolveFloorPlanImage } from "./shopify.js";
import { generateFloorPlanPreview, generateExteriorPreview } from "./previews.js";
import { fetchFloorPlans, writeSubmission } from "./supabase.js";
import { sendN8nWebhook, sendDiscordNotification, writeToCRM, deleteDiscordMessage, notifyVanessa, logModification, triggerLeadSMS, logFormSubmitActivity, notifyLeadAlerts, sendModAckEmail } from "./notify.js";
import { uploadImage, analyzeImage } from "./upload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// DRY_RUN (default TRUE) — when on, completion/partial submissions are logged
// but NO external writes fire (no Discord, no CRM, no portal, no email/SMS, no DB).
const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";

app.use(cors());
app.use(express.json());

// Multer — in-memory storage for image uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only images allowed"));
  }
});

// In-memory stores
const sessions = new Map();
let floorPlans = [];

// Load floor plans on startup
async function loadFloorPlans() {
  try {
    floorPlans = await fetchFloorPlans();
    console.log(`Loaded ${floorPlans.length} floor plans`);
  } catch (err) {
    console.error("Failed to load floor plans:", err.message);
  }
}

// Serve static React build
app.use(express.static(path.join(__dirname, "../client/dist")));

// ---------------------------------------------------------------------------
// Mod Concierge — plan catalog endpoints
// ---------------------------------------------------------------------------

// List all customizable plans (Shopify products, filtered + cached 10 min)
app.get("/api/mod-plans", async (_req, res) => {
  try {
    const plans = await fetchModPlans();
    res.json(plans.map(p => ({
      id: p.id,
      handle: p.handle,
      title: p.title,
      shortTitle: p.shortTitle,
      featuredImage: p.featuredImage,
      floorPlanImage: p.floorPlanImage,
      beds: p.beds,
      baths: p.baths,
      sqft: p.sqft,
      tags: p.tags,
    })));
  } catch (err) {
    console.error("mod-plans error:", err.message);
    res.status(500).json({ error: "Failed to load plans" });
  }
});

// Single plan detail — resolves the floor-plan image (vision-classified, cached)
app.get("/api/mod-plans/:handle", async (req, res) => {
  try {
    const plan = await getModPlan(req.params.handle);
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    const floorPlanImage = await resolveFloorPlanImage(plan);
    res.json({
      id: plan.id,
      handle: plan.handle,
      title: plan.title,
      shortTitle: plan.shortTitle,
      description: plan.description,
      featuredImage: plan.featuredImage,
      floorPlanImage,
      images: plan.images,
      beds: plan.beds,
      baths: plan.baths,
      sqft: plan.sqft,
      tags: plan.tags,
    });
  } catch (err) {
    console.error("mod-plan detail error:", err.message);
    res.status(500).json({ error: "Failed to load plan" });
  }
});

// Generate a concept preview via the n8n image-edit webhooks
app.post("/api/generate-preview", async (req, res) => {
  try {
    const { sessionId, editPrompt, target, imageUrl, email } = req.body;
    if (!editPrompt || !imageUrl) {
      return res.status(400).json({ error: "editPrompt and imageUrl required" });
    }

    const session = sessionId ? sessions.get(sessionId) : null;
    const contactEmail = email || session?.contactEmail || null;

    console.log(`Generating ${target || "floorplan"} preview: "${editPrompt.slice(0, 100)}"`);
    const result = target === "exterior"
      ? await generateExteriorPreview(imageUrl, editPrompt, contactEmail)
      : await generateFloorPlanPreview(imageUrl, editPrompt);

    if (session) {
      if (!session.previews) session.previews = [];
      session.previews.push({ editPrompt, target: target || "floorplan", beforeUrl: imageUrl, afterUrl: result.resultUrl, at: Date.now() });
    }

    res.json({ success: true, resultUrl: result.resultUrl, verified: result.verified ?? null, notes: result.notes ?? null });
  } catch (err) {
    console.error("generate-preview error:", err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------

// Image upload endpoint
app.post("/api/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file provided" });
    const { sessionId } = req.body;

    // Upload + analyze in parallel
    const [url, analysis] = await Promise.all([
      uploadImage(req.file.buffer, req.file.mimetype, req.file.originalname),
      analyzeImage(req.file.buffer, req.file.mimetype),
    ]);

    // Track in session
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId);
      session.imageUrls.push(url);
      if (!session.imageAnalyses) session.imageAnalyses = [];
      if (analysis) session.imageAnalyses.push({ url, analysis });
    }

    res.json({ url, analysis });
  } catch (err) {
    console.error("Upload error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", plans: floorPlans.length, dryRun: DRY_RUN });
});

// Floor plans endpoint for frontend (legacy Supabase plan list)
app.get("/api/plans", (_req, res) => {
  res.json(floorPlans);
});

// Extract every ```json fenced block, parse, and merge recognized directives.
function parseDirectives(aiResponse) {
  const out = { suggestedPlans: [], conversationComplete: false, submissionData: null, pendingPreview: null, step: null };
  const blocks = [...aiResponse.matchAll(/```json\s*\n?([\s\S]*?)```/g)];
  for (const m of blocks) {
    let parsed;
    try { parsed = JSON.parse(m[1].trim()); } catch { continue; }
    if (Array.isArray(parsed?.suggest_plans)) out.suggestedPlans = parsed.suggest_plans;
    if (parsed?.conversation_complete === true) {
      out.conversationComplete = true;
      out.submissionData = parsed.submission_data || null;
    }
    if (parsed?.generate_preview?.editPrompt) {
      out.pendingPreview = {
        editPrompt: parsed.generate_preview.editPrompt,
        target: parsed.generate_preview.target === "exterior" ? "exterior" : "floorplan",
      };
    }
    if (typeof parsed?.step === "string") out.step = parsed.step;
  }
  return out;
}

// Chat endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { sessionId, message, productHandle, mode } = req.body;

    if (!sessionId || !message) {
      return res.status(400).json({ error: "sessionId and message required" });
    }

    // Get or create session
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, { history: [], partialSaved: false, imageUrls: [], partialDiscordMsgId: null, productContext: null, productHandle: null, mode: null, contactEmail: null });
    }
    const session = sessions.get(sessionId);
    const history = session.history;

    // On first message, fetch product context if handle provided
    if (history.length === 0 && productHandle && !session.productContext) {
      try {
        if (mode === "mod") {
          const plan = await getModPlan(productHandle);
          if (plan) {
            session.productContext = plan;
            session.mode = "mod";
            // kick off floor-plan classification in the background (cached for /api/mod-plans/:handle)
            resolveFloorPlanImage(plan).catch(() => {});
          }
        } else {
          session.productContext = await fetchShopifyProduct(productHandle);
        }
        session.productHandle = productHandle; // track for routing at completion
      } catch (err) {
        console.error("Failed to fetch Shopify product:", err.message);
      }
    }

    // Capture contact email from field-card style messages (used for style-swap webhook)
    const emailMatch = message.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
    if (emailMatch && !session.contactEmail) session.contactEmail = emailMatch[0];

    // Add user message
    history.push({ role: "user", content: message });

    // Call Claude
    const aiResponse = await chat(history, floorPlans, session.productContext, session.mode);

    // Add assistant response to history
    history.push({ role: "assistant", content: aiResponse });

    // Parse structured directives from the response
    const { suggestedPlans, conversationComplete, submissionData, pendingPreview, step } = parseDirectives(aiResponse);

    console.log('AI response length:', aiResponse.length, '| complete:', conversationComplete, '| preview:', !!pendingPreview, '| step:', step);

    // Clean the response text — remove JSON blocks and any HTML the AI hallucinates
    const cleanText = aiResponse
      .replace(/```json[\s\S]*?```/g, "")
      .replace(/```[a-z_][^`]*?```/gs, "")
      .replace(/<[^>]+>/g, "")
      .trim();

    // Resolve suggested plan details
    const planDetails = suggestedPlans
      .map((id) => floorPlans.find((p) => String(p.id) === String(id)))
      .filter(Boolean);

    res.json({
      message: cleanText,
      suggestedPlans: planDetails,
      conversationComplete,
      submissionData,
      pendingPreview,
      step,
    });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Failed to process chat message" });
  }
});

// Complete endpoint — writes to Supabase + fires webhooks
app.post("/api/complete", async (req, res) => {
  try {
    const { submissionData, sessionId } = req.body;

    if (!submissionData) {
      return res.status(400).json({ error: "submissionData required" });
    }

    // Attach image URLs + analyses from the session
    const session = (sessionId && sessions.has(sessionId)) ? sessions.get(sessionId) : null;
    if (session?.imageUrls?.length) submissionData.imageUrls = session.imageUrls;
    if (session?.imageAnalyses?.length) submissionData.imageAnalyses = session.imageAnalyses;

    // Attach kept concept previews from the session
    if (session?.previews?.length) submissionData.conceptPreviews = session.previews;

    // Resolve floor plan names from IDs
    if (submissionData.suggested_plans?.length) {
      submissionData.suggested_plan_names = submissionData.suggested_plans
        .map(id => floorPlans.find(p => p.id === id)?.title)
        .filter(Boolean);
    }

    // Attach productHandle for routing — if session came from Shopify, tag it
    if (session?.productHandle) submissionData.productHandle = session.productHandle;

    if (DRY_RUN) {
      console.log("[DRY_RUN] Submission received — external writes suppressed:");
      console.log(JSON.stringify(submissionData, null, 2));
      return res.json({ success: true, dryRun: true });
    }

    // Delete partial Discord message if it exists
    if (session?.partialDiscordMsgId) {
      deleteDiscordMessage(session.partialDiscordMsgId).catch(() => {});
      session.partialDiscordMsgId = null;
    }

    // Write to Supabase + notify + CRM
    console.log("CRM write — submissionData keys:", Object.keys(submissionData || {}));
    // Get contact ID after CRM write for modification logging
    const crmResult = await writeToCRM(submissionData);
    const results = await Promise.allSettled([
      writeSubmission(submissionData),
      sendN8nWebhook(submissionData),
      sendDiscordNotification(submissionData),
      notifyVanessa(submissionData),
      notifyLeadAlerts(submissionData),
      logModification(submissionData, crmResult),
      triggerLeadSMS(submissionData, crmResult),
      logFormSubmitActivity(crmResult, submissionData),
      sendModAckEmail(submissionData, crmResult),
    ]);

    const [dbResult, n8nResult, discordResult] = results;

    if (dbResult.status === "rejected") console.error("DB write failed:", dbResult.reason);
    if (n8nResult.status === "rejected") console.error("n8n webhook failed:", n8nResult.reason);
    if (discordResult.status === "rejected") console.error("Discord notification failed:", discordResult.reason);

    res.json({ success: true });
  } catch (err) {
    console.error("Complete error:", err);
    res.status(500).json({ error: "Failed to complete submission" });
  }
});

// Partial lead capture — fires when contact card is submitted
app.post("/api/partial", async (req, res) => {
  try {
    const { sessionId, name, email, phone } = req.body;
    if (!email) return res.json({ ok: false });
    const session = sessions.get(sessionId);
    if (session && email) session.contactEmail = email;
    if (session?.partialSaved) return res.json({ ok: true, skipped: true });
    if (session) session.partialSaved = true;

    if (DRY_RUN) {
      console.log(`[DRY_RUN] Partial lead captured: ${name} <${email}> ${phone || ""} — external writes suppressed`);
      return res.json({ ok: true, dryRun: true });
    }

    const [firstName, ...rest] = (name || "").trim().split(" ");
    const lastName = rest.join(" ") || "Unknown";
    const partialMsgId = await sendDiscordNotification({ name, email, phone, status: "partial" });
    if (session) session.partialDiscordMsgId = partialMsgId;
    writeSubmission({ first_name: firstName, last_name: lastName, name, email, phone, status: "partial" }).catch(e => console.error("Partial save err:", e));
    writeToCRM({ first_name: firstName, last_name: lastName, email, phone }, { partial: true }).catch(e => console.error("Partial CRM err:", e));
    res.json({ ok: true });
  } catch (err) {
    console.error("Partial endpoint error:", err);
    res.json({ ok: false });
  }
});

// SPA fallback
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "../client/dist/index.html"));
});

// Start server
loadFloorPlans().then(() => {
  app.listen(PORT, () => {
    console.log(`Barnhaus Mod Concierge running on port ${PORT} (DRY_RUN=${DRY_RUN})`);
    // Warm the plan cache
    fetchModPlans().then(p => console.log(`Loaded ${p.length} mod plans from Shopify`)).catch(e => console.error("Mod plan warmup failed:", e.message));
  });
});
