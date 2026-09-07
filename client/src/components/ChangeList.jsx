import React from "react";

const s = {
  wrap: { padding: "10px 16px", borderBottom: "1px solid #2a2a2a", background: "#1C1C1C", maxHeight: 140, overflowY: "auto", flexShrink: 0 },
  title: { fontSize: 11, color: "#B8860B", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "'Inter',sans-serif", marginBottom: 6 },
  item: { display: "flex", alignItems: "flex-start", gap: 8, padding: "3px 0" },
  check: { color: "#7ec97e", fontSize: 12, fontWeight: 700, flexShrink: 0, marginTop: 1 },
  text: { fontSize: 12.5, color: "#ccc", fontFamily: "'Inter',sans-serif", lineHeight: 1.4 },
  cat: { color: "#DAA520", fontWeight: 600 },
};

export default function ChangeList({ changes }) {
  if (!changes.length) return null;
  return (
    <div style={s.wrap}>
      <div style={s.title}>Your Changes ({changes.length})</div>
      {changes.map((c, i) => (
        <div key={i} style={s.item}>
          <span style={s.check}>✓</span>
          <span style={s.text}><span style={s.cat}>{c.category}:</span> {c.description}</span>
        </div>
      ))}
    </div>
  );
}
