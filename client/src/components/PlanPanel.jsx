import React, { useState, useEffect } from "react";

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

export default function PlanPanel({ plan, concepts, isMobile }) {
  const original = plan.floorPlanImage || plan.featuredImage;
  const [view, setView] = useState("before"); // before | after
  const [selectedConcept, setSelectedConcept] = useState(null);
  const [zoom, setZoom] = useState(false);

  // Auto-flip to the newest kept concept
  useEffect(() => {
    if (concepts.length) {
      setSelectedConcept(concepts[concepts.length - 1]);
      setView("after");
    }
  }, [concepts]);

  const afterUrl = selectedConcept?.url || (concepts.length ? concepts[concepts.length - 1].url : null);
  const shownUrl = view === "after" && afterUrl ? afterUrl : original;

  const specs = [
    plan.beds && `${plan.beds} Bed`,
    plan.baths && `${plan.baths} Bath`,
    plan.sqft && `${plan.sqft.toLocaleString()} SF`,
  ].filter(Boolean).join("  ·  ");

  return (
    <div style={{ ...s.wrap, ...(isMobile ? { height: "auto" } : {}) }}>
      <div style={s.header}>
        <div style={{ ...s.title, ...(isMobile ? { fontSize: 16 } : {}) }}>{plan.shortTitle}</div>
        {specs && <div style={s.specs}>{specs}</div>}
      </div>

      {afterUrl && (
        <div style={s.toggleRow}>
          <button style={{ ...s.toggle, ...(view === "before" ? s.toggleActive : {}) }} onClick={() => setView("before")}>Original</button>
          <button style={{ ...s.toggle, ...(view === "after" ? s.toggleActive : {}) }} onClick={() => setView("after")}>Your Concept</button>
        </div>
      )}

      <div style={{ ...s.imgArea, ...(isMobile ? { maxHeight: 240 } : {}) }}>
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

      {zoom && shownUrl && (
        <div
          onClick={() => setZoom(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out", padding: 20 }}
        >
          <img src={shownUrl} style={{ maxWidth: "95%", maxHeight: "95%", borderRadius: 8 }} alt="Zoomed plan" />
        </div>
      )}
    </div>
  );
}
