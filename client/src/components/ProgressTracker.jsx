import React from "react";
import { STEPS } from "../hooks/useModChat.js";

const s = {
  wrap: { display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid #2a2a2a", background: "#1C1C1C", overflowX: "auto", flexShrink: 0 },
  step: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 },
  dot: { width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, fontFamily: "'Inter',sans-serif", flexShrink: 0 },
  label: { fontSize: 11, fontFamily: "'Inter',sans-serif", fontWeight: 600, letterSpacing: "0.03em", whiteSpace: "nowrap" },
  connector: { width: 18, height: 1, background: "#3a3a3a", margin: "0 6px", flexShrink: 0 },
};

export default function ProgressTracker({ step, isComplete, isMobile }) {
  const currentIdx = isComplete ? STEPS.length : Math.max(0, STEPS.findIndex(x => x.key === step));

  return (
    <div style={{ ...s.wrap, ...(isMobile ? { padding: "10px 12px", justifyContent: "center" } : {}) }}>
      {STEPS.map((st, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <React.Fragment key={st.key}>
            {i > 0 && <div style={{ ...s.connector, ...(isMobile ? { width: 10, margin: "0 4px" } : {}), background: done || active ? "#B8860B" : "#3a3a3a" }} />}
            <div style={s.step}>
              <div style={{
                ...s.dot,
                background: done ? "#B8860B" : active ? "#B8860B22" : "#242424",
                border: `1px solid ${done || active ? "#B8860B" : "#3a3a3a"}`,
                color: done ? "#1a1a1a" : active ? "#DAA520" : "#666",
              }}>
                {done ? "✓" : i + 1}
              </div>
              {(!isMobile || active) && (
                <span style={{ ...s.label, color: done ? "#B8860B" : active ? "#DAA520" : "#666" }}>{st.label}</span>
              )}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
