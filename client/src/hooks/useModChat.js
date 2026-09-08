import { useState, useRef, useCallback, useEffect } from "react";

function generateId() {
  return "s_" + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

export const STEPS = [
  { key: "contact", label: "Contact" },
  { key: "rooms", label: "Rooms" },
  { key: "additions", label: "Additions" },
  { key: "kitchen_bath", label: "Kitchen & Bath" },
  { key: "exterior", label: "Exterior" },
  { key: "review", label: "Review" },
];

export const CONTACT_FIELDS = [
  { key: "name", label: "Your Name", type: "text", placeholder: "Full name", flex: "1 1 180px" },
  { key: "email", label: "Email", type: "text", placeholder: "you@email.com", flex: "1 1 180px" },
  { key: "phone", label: "Phone", type: "text", placeholder: "(555) 000-0000", flex: "1 1 140px" },
];

/**
 * Chat hook for the Mod Concierge customizer.
 * @param {object} plan — plan detail from /api/mod-plans/:handle
 */
export function useModChat(plan) {
  const sessionId = useRef(generateId());
  const [messages, setMessages] = useState([]);
  const messagesRef = useRef([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const [isLoading, setIsLoading] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [submissionData, setSubmissionData] = useState(null);
  const [activeFields, setActiveFields] = useState(null);
  const [step, setStep] = useState("contact");
  const [changeList, setChangeList] = useState([]); // {category, description, conceptUrl}
  const [concepts, setConcepts] = useState([]); // kept concept images {url, label, target}
  const hasGreeted = useRef(false);
  const contactEmail = useRef(null);
  const previewCounter = useRef(0);

  // Working image state — floor-plan edits chain off the latest kept concept, PER STORY
  const currentFloorPlans = useRef({}); // story (1-based) -> latest kept concept url
  const currentExterior = useRef(null);
  const baseFloorPlans = plan?.floorPlanImages?.length
    ? plan.floorPlanImages
    : (plan?.floorPlanImage ? [plan.floorPlanImage] : (plan?.featuredImage ? [plan.featuredImage] : []));
  const baseFloorPlan = baseFloorPlans[0] || null;
  const baseExterior = plan?.featuredImage || null;

  const stepLabel = (key) => STEPS.find(s => s.key === key)?.label || "Change";

  const updatePreview = useCallback((previewId, patch) => {
    setMessages(prev => prev.map(m =>
      m.preview?.id === previewId ? { ...m, preview: { ...m.preview, ...patch } } : m
    ));
  }, []);

  const runPreview = useCallback(async (previewId, editPrompt, target, story = 1, opts = {}) => {
    const beforeUrl = target === "exterior"
      ? (currentExterior.current || baseExterior)
      : (currentFloorPlans.current[story] || baseFloorPlans[story - 1] || baseFloorPlan);

    if (!beforeUrl) {
      updatePreview(previewId, { status: "error", error: "No plan image available to edit" });
      return;
    }
    updatePreview(previewId, { status: "generating", beforeUrl });

    try {
      // Kick off the job — returns instantly with a jobId; generation takes 30-100s
      const res = await fetch("/api/generate-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionId.current,
          editPrompt,
          target,
          imageUrl: beforeUrl,
          email: contactEmail.current,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success || !data.jobId) throw new Error(data.error || "Preview generation failed");

      // Poll for completion — short requests survive mobile browsers/proxies
      const started = Date.now();
      while (Date.now() - started < 240_000) {
        await new Promise(r => setTimeout(r, 3000));
        let job;
        try {
          const sres = await fetch(`/api/preview-status/${data.jobId}`);
          job = await sres.json();
        } catch {
          continue; // transient network blip — keep polling
        }
        if (job.status === "done") {
          updatePreview(previewId, { status: "ready", afterUrl: job.resultUrl, verified: job.verified ?? null, notes: job.notes ?? null });
          return;
        }
        if (job.status === "error") throw new Error(job.error || "Preview generation failed");
        if (job.status === "unknown") {
          // Server restarted and lost the job — resubmit once automatically
          if (!opts.retried) return runPreview(previewId, editPrompt, target, story, { retried: true });
          throw new Error("Preview job expired — please retry");
        }
      }
      throw new Error("Preview took too long — please retry");
    } catch (err) {
      console.error("Preview error:", err);
      updatePreview(previewId, { status: "error", error: err.message });
    }
  }, [baseExterior, baseFloorPlan, baseFloorPlans, updatePreview]);

  const handleResponse = useCallback(async (data) => {
    if (data.message) {
      setMessages(prev => [...prev, { role: "assistant", text: data.message, image: data.image || null }]);
    }
    if (data.step) setStep(data.step);

    if (data.pendingPreview) {
      const id = ++previewCounter.current;
      const { editPrompt, target, story = 1 } = data.pendingPreview;
      setMessages(prev => [...prev, {
        role: "assistant",
        preview: { id, status: "generating", editPrompt, target, story, beforeUrl: null, afterUrl: null, decided: null },
      }]);
      runPreview(id, editPrompt, target, story);
    }

    if (data.conversationComplete && data.submissionData) {
      setSubmissionData(data.submissionData);
      setActiveFields(null);
      try {
        await fetch("/api/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ submissionData: data.submissionData, sessionId: sessionId.current }),
        });
      } catch (err) { console.error("Completion failed:", err); }
      setIsComplete(true);
    }
  }, [runPreview]);

  const sendMessage = useCallback(async (text, opts = {}) => {
    if (isComplete) return;
    setActiveFields(null);
    if (!opts.hidden) {
      setMessages(prev => [...prev, { role: "user", text }]);
    }
    if (opts.partial) {
      contactEmail.current = opts.partial.email || contactEmail.current;
      fetch("/api/partial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId.current, ...opts.partial }),
      }).catch(() => {});
    }
    setIsLoading(true);
    try {
      // productHandle + transcript ride along on every message so the server can
      // rebuild the session if it restarted mid-conversation (in-memory sessions)
      const transcript = messagesRef.current
        .filter(m => m.text && !m.preview)
        .map(m => ({ role: m.role, text: m.text }));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId.current, message: text, mode: "mod", productHandle: plan?.handle, transcript }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Chat request failed");
      await handleResponse(data);
    } catch (err) {
      console.error("Chat error:", err);
      setMessages(prev => [...prev, { role: "assistant", text: "I'm having trouble connecting right now. Please try again." }]);
    } finally {
      setIsLoading(false);
    }
  }, [isComplete, handleResponse, plan]);

  const keepPreview = useCallback((preview) => {
    updatePreview(preview.id, { decided: "kept" });
    if (preview.target === "exterior") currentExterior.current = preview.afterUrl;
    else currentFloorPlans.current[preview.story || 1] = preview.afterUrl;

    setChangeList(prev => [...prev, {
      category: stepLabel(step),
      description: preview.editPrompt,
      conceptUrl: preview.afterUrl,
    }]);
    setConcepts(prev => [...prev, { url: preview.afterUrl, label: preview.editPrompt, target: preview.target }]);
    sendMessage(`[Client kept the change: ${preview.editPrompt}. Concept: ${preview.afterUrl}]`, { hidden: true });
  }, [sendMessage, step, updatePreview]);

  const tryAgainPreview = useCallback((preview) => {
    updatePreview(preview.id, { status: "generating", afterUrl: null, decided: null });
    runPreview(preview.id, preview.editPrompt, preview.target, preview.story || 1);
  }, [runPreview, updatePreview]);

  const skipPreview = useCallback((preview) => {
    updatePreview(preview.id, { decided: "skipped" });
    sendMessage(`[Client skipped that concept for: ${preview.editPrompt}. Note it without a preview if they still want the change, and continue.]`, { hidden: true });
  }, [sendMessage, updatePreview]);

  // QA flagged the concept as inaccurate — record the change WITHOUT the image
  // (no chaining off a bad concept, nothing added to the plan panel)
  const saveWithoutPreview = useCallback((preview) => {
    updatePreview(preview.id, { decided: "saved" });
    setChangeList(prev => [...prev, {
      category: stepLabel(step),
      description: preview.editPrompt,
      conceptUrl: "",
    }]);
    sendMessage(`[The preview for "${preview.editPrompt}" wasn't accurate, so the client saved the change without a concept image. It's in their change list — acknowledge briefly and continue.]`, { hidden: true });
  }, [sendMessage, step, updatePreview]);

  const startConversation = useCallback(async () => {
    if (hasGreeted.current || !plan) return;
    hasGreeted.current = true;
    setIsLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId.current, message: "Hello", productHandle: plan.handle, mode: "mod" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start");
      setMessages([{ role: "assistant", text: data.message, image: data.image || null }]);
    } catch (err) {
      setMessages([{ role: "assistant", text: `Welcome! You're looking at the ${plan.shortTitle} — I'll walk you through customizing it. First, what's your name, email, and phone?` }]);
    } finally {
      setActiveFields(CONTACT_FIELDS);
      setIsLoading(false);
    }
  }, [plan]);

  const dismissFields = useCallback(() => setActiveFields(null), []);

  return {
    sessionId: sessionId.current,
    messages, isLoading, isComplete, submissionData,
    activeFields, dismissFields,
    step, changeList, concepts,
    baseFloorPlan, baseFloorPlans, baseExterior,
    sendMessage, startConversation,
    keepPreview, tryAgainPreview, skipPreview, saveWithoutPreview,
  };
}
