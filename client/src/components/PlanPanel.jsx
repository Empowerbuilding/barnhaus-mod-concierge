import React, { useState, useEffect, useRef } from "react";

const s = {
  wrap: { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" },
  header: { padding: "14px 20px 10px", flexShrink: 0 },
  title: { fontSize: 20, fontWeight: 700, color: "#fff", fontFamily: "'Inter',sans-serif" },
  specs: { fontSize: 13, color: "#B8860B", fontFamily: "'Inter',sans-serif", fontWeight: 500, marginTop: 2 },
  toggleRow: { display: "flex", gap: 6, padding: "0 20px 10px", flexShrink: 0 },
  toggle: { padding: "6px 18px", borderRadius: 20, fontSize: 12, fontWeight: 600, fontFamily: "'Inter',sans-serif", cursor: "pointer", border: "1px solid #3a3a3a", background: "transparent", color: "#888" },
  toggleActive: { border: "1px solid #B8860B", background: "#B8860B22", color: "#DAA520" },
  imgArea: { flex: 1, minHeight: 0, padding: "0 20px", display: "flex", alignItems: "flex-start", justifyContent: "center", overflow: "hidden" },
  img: { maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 10, background: "#111", cursor: "zoom-in" },
  stack: { flexShrink: 0, padding: "10px 20px 16px" },
  stackTitle: { fontSize: 11, color: "#B8860B", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "'Inter',sans-serif", marginBottom: 8 },
  thumbs: { display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 },
  thumb: { width: 88, height: 66, objectFit: "cover", borderRadius: 8, cursor: "pointer", flexShrink: 0, background: "#111" },
};

const STORY_LABELS = ["1st Floor", "2nd Floor", "3rd Floor"];

export default function PlanPanel({ plan, concepts, isMobile, userActivity = 0 }) {
  const floorPlans = plan.floorPlanImages?.length
    ? plan.floorPlanImages
    : [plan.floorPlanImage || plan.featuredImage].filter(Boolean);
  const [storyIdx, setStoryIdx] = useState(0);
  const original = floorPlans[storyIdx] || floorPlans[0] || plan.featuredImage;
  const [view, setView] = useState("before"); // before | after
  const [selectedConcept, setSelectedConcept] = useState(null);
  const [zoom, setZoom] = useState(false);
  const [expanded, setExpanded] = useState(!isMobile); // mobile starts compact so the chat has room
  const autoCollapsed = useRef(false);

  // Mobile: once the user starts chatting, collapse the plan panel to free screen space (once)
  useEffect(() => {
    if (isMobile && userActivity > 0 && !autoCollapsed.current) {
      autoCollapsed.current = true;
      setExpanded(false);
    }
  }, [userActivity, isMobile]);

  // Auto-flip to the newest kept concept (and re-expand on mobile so they see it)
  useEffect(() => {
    if (concepts.length) {
      setSelectedConcept(concepts[concepts.length - 1]);
      setView("after");
      if (isMobile) setExpanded(true);
    }
  }, [concepts, isMobile]);

  const afterUrl = selectedConcept?.url || (concepts.length ? concepts[concepts.length - 1].url : null);
  const shownUrl = view === "after" && afterUrl ? afterUrl : original;

  const storyTabs = floorPlans.length > 1 && view === "before" && (
    <div style={{ display: "flex", gap: 6 }}>
      {floorPlans.map((_, i) => (
        <button
          key={i}
          style={{ ...s.toggle, padding: "5px 12px", ...(storyIdx === i ? s.toggleActive : {}) }}
          onClick={() => setStoryIdx(i)}
        >
          {STORY_LABELS[i] || `Floor ${i + 1}`}
        </button>
      ))}
    </div>
  );

  const specs = [
    plan.beds && `${plan.beds} Bed`,
    plan.baths && `${plan.baths} Bath`,
    plan.sqft && `${plan.sqft.toLocaleString()} SF`,
  ].filter(Boolean).join("  ·  ");

  const zoomOverlay = zoom && shownUrl && (
    <div
      onClick={() => setZoom(false)}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out", padding: 20 }}
    >
      <button
        onClick={() => setZoom(false)}
        aria-label="Close image"
        style={{ position: "absolute", top: 14, right: 14, width: 38, height: 38, borderRadius: "50%", border: "1px solid #555", background: "rgba(30,30,30,0.9)", color: "#fff", fontSize: 17, cursor: "pointer", zIndex: 1001 }}
      >✕</button>
      <img src={shownUrl} style={{ maxWidth: "95%", maxHeight: "92%", borderRadius: 8 }} alt="Zoomed plan" />
    </div>
  );

  if (isMobile) {
    return (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px" }}>
          <img
            src={shownUrl}
            alt={plan.shortTitle}
            onClick={() => setZoom(true)}
            style={{ width: 86, height: 60, objectFit: "cover", borderRadius: 8, background: "#111", flexShrink: 0, cursor: "zoom-in" }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", fontFamily: "'Inter',sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{plan.shortTitle}</div>
            {specs && <div style={{ fontSize: 11.5, color: "#B8860B", fontWeight: 500, fontFamily: "'Inter',sans-serif", marginTop: 1 }}>{specs}</div>}
          </div>
          <button
            onClick={() => setExpanded(e => !e)}
            aria-label={expanded ? "Hide plan" : "Show plan"}
            style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 8, border: "1px solid #3a3a3a", background: "transparent", color: "#B8860B", fontSize: 13, cursor: "pointer" }}
          >
            {expanded ? "\u25B4" : "\u25BE"}
          </button>
        </div>

        {expanded && afterUrl && (
          <div style={{ ...s.toggleRow, padding: "0 14px 8px" }}>
            <button style={{ ...s.toggle, ...(view === "before" ? s.toggleActive : {}) }} onClick={() => setView("before")}>Original</button>
            <button style={{ ...s.toggle, ...(view === "after" ? s.toggleActive : {}) }} onClick={() => setView("after")}>Your Concept</button>
          </div>
        )}

        {expanded && storyTabs && (
          <div style={{ padding: "0 14px 8px" }}>{storyTabs}</div>
        )}

        {expanded && shownUrl && (
          <div style={{ height: 210, padding: "0 14px 12px" }}>
            <img
              src={shownUrl}
              alt={plan.shortTitle}
              onClick={() => setZoom(true)}
              style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 10, background: "#111", cursor: "zoom-in" }}
            />
          </div>
        )}

        {zoomOverlay}
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={s.title}>{plan.shortTitle}</div>
        {specs && <div style={s.specs}>{specs}</div>}
      </div>

      {afterUrl && (
        <div style={s.toggleRow}>
          <button style={{ ...s.toggle, ...(view === "before" ? s.toggleActive : {}) }} onClick={() => setView("before")}>Original</button>
          <button style={{ ...s.toggle, ...(view === "after" ? s.toggleActive : {}) }} onClick={() => setView("after")}>Your Concept</button>
        </div>
      )}

      {storyTabs && <div style={{ padding: "0 20px 10px", flexShrink: 0 }}>{storyTabs}</div>}

      <div style={s.imgArea}>
        {shownUrl && <img src={shownUrl} alt={plan.shortTitle} style={s.img} onClick={() => setZoom(true)} />}
      </div>

      {concepts.length > 0 && !isMobile && (
        <div style={s.stack}>
          <div style={s.stackTitle}>Kept Concepts ({concepts.length})</div>
          <div style={s.thumbs}>
            {concepts.map((c, i) => (
              <img
                key={i}
                src={c.url}
                title={c.label}
                alt={c.label}
                style={{ ...s.thumb, border: selectedConcept?.url === c.url && view === "after" ? "2px solid #B8860B" : "2px solid transparent" }}
                onClick={() => { setSelectedConcept(c); setView("after"); }}
              />
            ))}
          </div>
        </div>
      )}

      {zoomOverlay}
    </div>
  );
}
