import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { chat } from "./claude.js";
import { fetchShopifyProduct, fetchModPlans, getModPlan, resolveFloorPlanImage, resolveFloorPlanImages } from "./shopify.js";
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
    const floorPlanImages = await resolveFloorPlanImages(plan);
    const floorPlanImage = floorPlanImages[0] || null;
    res.json({
      floorPlanImages,
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
// Preview generation runs as an async job — generations take 30-100s (pro model +
// verify-retry), far too long to hold a single HTTP request open from a mobile
// browser (it aborts). Client gets a jobId back instantly and polls for status.
const previewJobs = new Map(); // jobId -> { status, result, error, createdAt }
let previewJobCounter = 0;

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of previewJobs) if (job.createdAt < cutoff) previewJobs.delete(id);
}, 5 * 60 * 1000).unref();

app.post("/api/generate-preview", (req, res) => {
  const { sessionId, editPrompt, target, imageUrl, email } = req.body;
  if (!editPrompt || !imageUrl) {
    return res.status(400).json({ error: "editPrompt and imageUrl required" });
  }

  const session = sessionId ? sessions.get(sessionId) : null;
  const contactEmail = email || session?.contactEmail || null;

  const jobId = `pv${++previewJobCounter}-${Date.now()}`;
  previewJobs.set(jobId, { status: "generating", result: null, error: null, createdAt: Date.now() });
  console.log(`[${jobId}] Generating ${target || "floorplan"} preview: "${editPrompt.slice(0, 100)}"`);

  (async () => {
    try {
      const result = target === "exterior"
        ? await generateExteriorPreview(imageUrl, editPrompt, contactEmail)
        : await generateFloorPlanPreview(imageUrl, editPrompt);

      if (session) {
        if (!session.previews) session.previews = [];
        session.previews.push({ editPrompt, target: target || "floorplan", beforeUrl: imageUrl, afterUrl: result.resultUrl, at: Date.now() });
      }

      previewJobs.set(jobId, {
        status: "done",
        result: { resultUrl: result.resultUrl, verified: result.verified ?? null, notes: result.notes ?? null },
        error: null,
        createdAt: Date.now(),
      });
      console.log(`[${jobId}] preview done`);
    } catch (err) {
      console.error(`[${jobId}] generate-preview error:`, err.message);
      previewJobs.set(jobId, { status: "error", result: null, error: err.message, createdAt: Date.now() });
    }
  })();

  res.json({ success: true, jobId });
});

app.get("/api/preview-status/:jobId", (req, res) => {
  const job = previewJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ status: "unknown" });
  res.json({ status: job.status, ...(job.result || {}), error: job.error });
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
  const out = { suggestedPlans: [], conversationComplete: false, submissionData: null, pendingPreview: null, step: null, showImage: null };
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
      const st = parsed.generate_preview.story;
      out.pendingPreview = {
        editPrompt: parsed.generate_preview.editPrompt,
        target: parsed.generate_preview.target === "exterior" ? "exterior" : "floorplan",
        story: Number.isInteger(st) && st >= 1 && st <= 3 ? st : 1,
      };
    }
    if (typeof parsed?.step === "string") out.step = parsed.step;
    if (parsed?.show_image === "floorplan" || parsed?.show_image === "exterior") {
      out.showImage = parsed.show_image;
      const st = parsed.story ?? parsed.show_image_story;
      out.showImageStory = Number.isInteger(st) && st >= 1 && st <= 3 ? st : 1;
    }
  }
  return out;
}

// Chat endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { sessionId, message, productHandle, mode, transcript } = req.body;

    if (!sessionId || !message) {
      return res.status(400).json({ error: "sessionId and message required" });
    }

    // Get or create session
    const isNewSession = !sessions.has(sessionId);
    if (isNewSession) {
      sessions.set(sessionId, { history: [], partialSaved: false, imageUrls: [], partialDiscordMsgId: null, productContext: null, productHandle: null, mode: null, contactEmail: null });
    }
    const session = sessions.get(sessionId);
    const history = session.history;

    // Recovery: if the server restarted mid-conversation (in-memory sessions),
    // the client resends its transcript — seed history so the AI keeps context.
    if (isNewSession && Array.isArray(transcript) && transcript.length > 0) {
      for (const t of transcript) {
        if ((t?.role === "user" || t?.role === "assistant") && typeof t.text === "string" && t.text.trim()) {
          history.push({ role: t.role, content: t.text.slice(0, 4000) });
        }
      }
      // history must start with a user turn and strictly alternate for Anthropic —
      // normalize by dropping a leading assistant greeting and merging repeats
      while (history.length && history[0].role === "assistant") history.shift();
      for (let i = history.length - 1; i > 0; i--) {
        if (history[i].role === history[i - 1].role) {
          history[i - 1].content += "\n" + history[i].content;
          history.splice(i, 1);
        }
      }
      // seeded history must end on an assistant turn (the incoming user message
      // is pushed below) — bridge if the restart ate the last reply
      if (history.length && history[history.length - 1].role === "user") {
        history.push({ role: "assistant", content: "(connection interrupted — continuing where we left off)" });
      }
      const emailInTranscript = transcript.map(t => t?.text || "").join(" ").match(/[\w.+-]+@[\w-]+\.[\w.]+/);
      if (emailInTranscript) session.contactEmail = emailInTranscript[0];
      console.log(`Rebuilt session ${sessionId} from client transcript (${history.length} turns)`);
    }

    // Fetch product context if handle provided and not yet loaded (first message,
    // or any message after a server restart — client sends the handle every time)
    if (productHandle && !session.productContext) {
      try {
        if (mode === "mod") {
          const plan = await getModPlan(productHandle);
          if (plan) {
            session.productContext = plan;
            session.mode = "mod";
            // resolve all floor-plan sheets (cached/prewarmed) — the prompt needs the
            // story count so the AI can target upper floors
            try { plan.floorPlanImages = await resolveFloorPlanImages(plan); } catch { plan.floorPlanImages = []; }
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
    const { suggestedPlans, conversationComplete, submissionData, pendingPreview, step, showImage, showImageStory } = parseDirectives(aiResponse);

    console.log('AI response length:', aiResponse.length, '| complete:', conversationComplete, '| preview:', !!pendingPreview, '| step:', step, '| showImage:', showImage);

    // Resolve show_image directive to an actual image URL for this plan
    let image = null;
    if (showImage && session.productContext) {
      try {
        if (showImage === "floorplan" && session.mode === "mod") {
          const sheets = await resolveFloorPlanImages(session.productContext);
          const idx = Math.min(Math.max((showImageStory || 1) - 1, 0), Math.max(sheets.length - 1, 0));
          const url = sheets[idx] || sheets[0];
          const label = sheets.length > 1 ? ["1st floor plan", "2nd floor plan", "3rd floor plan"][idx] : "Floor plan";
          image = { url: url || session.productContext.featuredImage, kind: "floorplan", label };
        } else {
          const url = session.productContext.featuredImage || session.productContext.images?.[0]?.src;
          if (url) image = { url, kind: "exterior", label: "Exterior" };
        }
      } catch { /* non-fatal — just skip the image */ }
    }

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
      image,
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
    // Warm the plan cache, then pre-classify every plan's floor-plan image in the
    // background (staggered) so first page load per plan is instant instead of
    // waiting on a vision call.
    fetchModPlans()
      .then(async plans => {
        console.log(`Loaded ${plans.length} mod plans from Shopify`);
        for (const p of plans) {
          try {
            const full = await getModPlan(p.handle);
            if (full) await resolveFloorPlanImage(full);
          } catch (e) {
            console.error(`Floor-plan warmup failed for ${p.handle}:`, e.message);
          }
          await new Promise(r => setTimeout(r, 1500));
        }
        console.log("Floor-plan image warmup complete");
      })
      .catch(e => console.error("Mod plan warmup failed:", e.message));
  });
});
