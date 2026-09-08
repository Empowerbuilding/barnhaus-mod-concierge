import React, { useState, useEffect, useCallback } from "react";
import PlanPicker from "./components/PlanPicker.jsx";
import Customizer from "./components/Customizer.jsx";

const LOGO_URL = "https://barnhaussteelbuilders.com/assets/images/logo-BbjiAVC6.png";

const s = {
  app: { minHeight: "100%", width: "100%", background: "#1a1a1a", display: "flex", flexDirection: "column" },
  appFull: { height: "100%", overflow: "hidden" },
  header: { padding: "14px 24px", borderBottom: "1px solid #2a2a2a", background: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 },
  logoWrap: { display: "flex", alignItems: "center", gap: 12, cursor: "pointer" },
  logoImg: { height: 36, width: "auto", display: "block" },
  logoFallback: { fontSize: 20, fontWeight: 700, color: "#fff", letterSpacing: "0.04em", fontFamily: "'Inter',sans-serif" },
  gold: { color: "#B8860B" },
  subtitle: { fontSize: 11, color: "#888", letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "'Inter',sans-serif", fontWeight: 500 },
  backBtn: { padding: "8px 16px", borderRadius: 8, border: "1px solid #3a3a3a", background: "transparent", color: "#aaa", fontSize: 13, cursor: "pointer", fontFamily: "'Inter',sans-serif" },
  loading: { display: "flex", alignItems: "center", justifyContent: "center", flex: 1, color: "#888", fontFamily: "'Inter',sans-serif", fontSize: 15 },
};

// Embed mode: the app runs inside a drawer iframe on the Shopify product page.
// ?embed=1 — slim header, close button that postMessages the parent, no picker nav.
const IS_EMBED = new URLSearchParams(window.location.search).get("embed") === "1";

export default function App() {
  const [plans, setPlans] = useState([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plan, setPlan] = useState(null); // full plan detail → customizer active
  const [planLoading, setPlanLoading] = useState(false);
  const [logoError, setLogoError] = useState(false);

  // Load plan list (skip in embed mode — plan comes from the deep link)
  useEffect(() => {
    if (IS_EMBED) { setPlansLoading(false); return; }
    fetch("/api/mod-plans")
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setPlans(data); })
      .catch(err => console.error("Failed to load plans:", err))
      .finally(() => setPlansLoading(false));
  }, []);

  const loadPlan = useCallback(async (handle, pushUrl = true) => {
    setPlanLoading(true);
    try {
      const res = await fetch(`/api/mod-plans/${encodeURIComponent(handle)}`);
      if (!res.ok) throw new Error("Plan not found");
      const detail = await res.json();
      setPlan(detail);
      if (pushUrl) {
        const url = new URL(window.location.href);
        url.searchParams.set("plan", handle);
        window.history.pushState({}, "", url);
      }
    } catch (err) {
      console.error("Failed to load plan:", err);
    } finally {
      setPlanLoading(false);
    }
  }, []);

  // Deep link: ?plan=<handle> skips the picker
  useEffect(() => {
    const handle = new URLSearchParams(window.location.search).get("plan");
    if (handle) loadPlan(handle, false);
  }, [loadPlan]);

  const backToPicker = () => {
    setPlan(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("plan");
    window.history.pushState({}, "", url);
  };

  const inCustomizer = !!plan;

  const closeEmbed = () => {
    try { window.parent.postMessage({ type: "modConciergeClose" }, "*"); } catch { /* noop */ }
  };

  return (
    <div style={{ ...s.app, ...(inCustomizer || IS_EMBED ? s.appFull : {}) }}>
      <div style={{ ...s.header, ...(IS_EMBED ? { padding: "10px 16px" } : {}) }}>
        <div style={{ ...s.logoWrap, ...(IS_EMBED ? { cursor: "default" } : {}) }} onClick={IS_EMBED ? undefined : backToPicker}>
          {!logoError
            ? <img src={LOGO_URL} alt="Barnhaus Steel Builders" style={{ ...s.logoImg, ...(IS_EMBED ? { height: 28 } : {}) }} onError={() => setLogoError(true)} />
            : <div style={s.logoFallback}>BARN<span style={s.gold}>HAUS</span></div>
          }
          <div style={s.subtitle}>Mod Concierge</div>
        </div>
        {IS_EMBED ? (
          <button style={{ ...s.backBtn, fontSize: 15, lineHeight: 1, padding: "8px 14px" }} onClick={closeEmbed} aria-label="Close">
            ✕
          </button>
        ) : inCustomizer && (
          <button style={s.backBtn} onClick={backToPicker}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "#B8860B"; e.currentTarget.style.color = "#DAA520"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "#3a3a3a"; e.currentTarget.style.color = "#aaa"; }}>
            ← All Plans
          </button>
        )}
      </div>

      {planLoading ? (
        <div style={s.loading}>Loading plan…</div>
      ) : inCustomizer ? (
        <Customizer key={plan.handle} plan={plan} />
      ) : IS_EMBED ? (
        <div style={s.loading}>No plan selected.</div>
      ) : (
        <PlanPicker plans={plans} loading={plansLoading} onSelect={p => loadPlan(p.handle)} />
      )}
    </div>
  );
}
