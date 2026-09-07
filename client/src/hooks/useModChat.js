import { useState, useRef, useCallback } from "react";

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

  // Working image state — floor-plan edits chain off the latest kept concept
  const currentFloorPlan = useRef(null);
  const currentExterior = useRef(null);
  const baseFloorPlan = plan?.floorPlanImage || plan?.featuredImage || null;
  const baseExterior = plan?.featuredImage || null;

  const stepLabel = (key) => STEPS.find(s => s.key === key)?.label || "Change";

  const updatePreview = useCallback((previewId, patch) => {
    setMessages(prev => prev.map(m =>
      m.preview?.id === previewId ? { ...m, preview: { ...m.preview, ...patch } } : m
    ));
  }, []);

  const runPreview = useCallback(async (previewId, editPrompt, target) => {
    const beforeUrl = target === "exterior"
      ? (currentExterior.current || baseExterior)
      : (currentFloorPlan.current || baseFloorPlan);

    if (!beforeUrl) {
      updatePreview(previewId, { status: "error", error: "No plan image available to edit" });
      return;
    }
    updatePreview(previewId, { status: "generating", beforeUrl });

    try {
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
      if (!res.ok || !data.success) throw new Error(data.error || "Preview generation failed");
      updatePreview(previewId, { status: "ready", afterUrl: data.resultUrl });
    } catch (err) {
      console.error("Preview error:", err);
      updatePreview(previewId, { status: "error", error: err.message });
    }
  }, [baseExterior, baseFloorPlan, updatePreview]);

  const handleResponse = useCallback(async (data) => {
    if (data.message) {
      setMessages(prev => [...prev, { role: "assistant", text: data.message }]);
    }
    if (data.step) setStep(data.step);

    if (data.pendingPreview) {
      const id = ++previewCounter.current;
      const { editPrompt, target } = data.pendingPreview;
      setMessages(prev => [...prev, {
        role: "assistant",
        preview: { id, status: "generating", editPrompt, target, beforeUrl: null, afterUrl: null, decided: null },
      }]);
      runPreview(id, editPrompt, target);
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
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId.current, message: text, mode: "mod" }),
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
  }, [isComplete, handleResponse]);

  const keepPreview = useCallback((preview) => {
    updatePreview(preview.id, { decided: "kept" });
    if (preview.target === "exterior") currentExterior.current = preview.afterUrl;
    else currentFloorPlan.current = preview.afterUrl;

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
    runPreview(preview.id, preview.editPrompt, preview.target);
  }, [runPreview, updatePreview]);

  const skipPreview = useCallback((preview) => {
    updatePreview(preview.id, { decided: "skipped" });
    sendMessage(`[Client skipped that concept for: ${preview.editPrompt}. Note it without a preview if they still want the change, and continue.]`, { hidden: true });
  }, [sendMessage, updatePreview]);

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
      setMessages([{ role: "assistant", text: data.message }]);
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
    baseFloorPlan, baseExterior,
    sendMessage, startConversation,
    keepPreview, tryAgainPreview, skipPreview,
  };
}
