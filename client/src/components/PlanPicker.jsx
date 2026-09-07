import React from "react";

const s = {
  wrap: { maxWidth: 1200, margin: "0 auto", padding: "32px 24px 64px", width: "100%", boxSizing: "border-box" },
  heading: { fontSize: 32, fontWeight: 700, color: "#fff", fontFamily: "'Inter',sans-serif", textAlign: "center", marginBottom: 8 },
  sub: { fontSize: 15, color: "#999", textAlign: "center", marginBottom: 36, fontFamily: "'Inter',sans-serif" },
  gold: { color: "#DAA520" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 20 },
  card: {
    background: "#1C1C1C", border: "1px solid #2e2e2e", borderRadius: 14, overflow: "hidden",
    cursor: "pointer", transition: "border-color 0.2s, transform 0.2s", display: "flex", flexDirection: "column",
  },
  imgWrap: { width: "100%", aspectRatio: "4/3", background: "#111", overflow: "hidden" },
  img: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  body: { padding: "14px 16px 16px" },
  title: { fontSize: 16, fontWeight: 600, color: "#fff", fontFamily: "'Inter',sans-serif", marginBottom: 6 },
  specs: { fontSize: 13, color: "#B8860B", fontFamily: "'Inter',sans-serif", fontWeight: 500, letterSpacing: "0.02em" },
  btn: {
    marginTop: 12, width: "100%", padding: "10px 0", borderRadius: 8, border: "none",
    background: "linear-gradient(135deg,#B8860B,#DAA520)", color: "#1a1a1a", fontSize: 13,
    fontWeight: 600, cursor: "pointer", fontFamily: "'Inter',sans-serif",
  },
  loading: { textAlign: "center", color: "#888", padding: 60, fontFamily: "'Inter',sans-serif" },
};

function specLine(p) {
  const parts = [];
  if (p.beds) parts.push(`${p.beds} Bed`);
  if (p.baths) parts.push(`${p.baths} Bath`);
  if (p.sqft) parts.push(`${p.sqft.toLocaleString()} SF`);
  return parts.join("  ·  ");
}

export default function PlanPicker({ plans, loading, onSelect }) {
  if (loading) return <div style={s.loading}>Loading plans…</div>;

  return (
    <div style={s.wrap}>
      <div style={s.heading}>Customize Your <span style={s.gold}>Barnhaus</span> Plan</div>
      <div style={s.sub}>Pick a plan, tell us what you'd change, and see concept previews of your modifications — then send them straight to our design team.</div>
      <div style={s.grid}>
        {plans.map(p => (
          <div
            key={p.id}
            style={s.card}
            onClick={() => onSelect(p)}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "#B8860B"; e.currentTarget.style.transform = "translateY(-3px)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "#2e2e2e"; e.currentTarget.style.transform = "none"; }}
          >
            <div style={s.imgWrap}>
              {p.featuredImage && <img src={p.featuredImage} alt={p.shortTitle} style={s.img} loading="lazy" />}
            </div>
            <div style={s.body}>
              <div style={s.title}>{p.shortTitle}</div>
              <div style={s.specs}>{specLine(p) || "View details"}</div>
              <button style={s.btn}>Customize This Plan</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
