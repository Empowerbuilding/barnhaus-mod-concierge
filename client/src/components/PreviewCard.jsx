import React, { useState } from "react";

const s = {
  card: { background: "#242424", border: "1px solid #B8860B", borderRadius: 12, padding: 14, margin: "4px 20px", maxWidth: 480 },
  label: { fontSize: 11, color: "#B8860B", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "'Inter',sans-serif", marginBottom: 8 },
  prompt: { fontSize: 13, color: "#ccc", fontFamily: "'Inter',sans-serif", marginBottom: 10, lineHeight: 1.4 },
  imgRow: { display: "flex", gap: 8, marginBottom: 10 },
  imgCol: { flex: 1, minWidth: 0 },
  imgLabel: { fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, fontFamily: "'Inter',sans-serif" },
  img: { width: "100%", borderRadius: 8, display: "block", background: "#111", cursor: "zoom-in" },
  btnRow: { display: "flex", gap: 8 },
  keepBtn: { flex: 1, padding: "9px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#B8860B,#DAA520)", color: "#1a1a1a", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Inter',sans-serif" },
  altBtn: { flex: 1, padding: "9px 0", borderRadius: 8, border: "1px solid #3a3a3a", background: "transparent", color: "#aaa", fontSize: 13, cursor: "pointer", fontFamily: "'Inter',sans-serif" },
  spinner: { display: "flex", alignItems: "center", gap: 10, color: "#DAA520", fontSize: 13, fontFamily: "'Inter',sans-serif", padding: "14px 4px" },
  decided: { fontSize: 12, fontWeight: 600, fontFamily: "'Inter',sans-serif", padding: "6px 0" },
  error: { fontSize: 13, color: "#e07a7a", fontFamily: "'Inter',sans-serif", marginBottom: 8 },
};

const SPIN_CSS = "@keyframes modSpin{to{transform:rotate(360deg)}}";
if (typeof document !== "undefined" && !document.getElementById("mod-spin-style")) {
  const style = document.createElement("style");
  style.id = "mod-spin-style";
  style.textContent = SPIN_CSS;
  document.head.appendChild(style);
}

export default function PreviewCard({ preview, onKeep, onTryAgain, onSkip, disabled }) {
  const [zoom, setZoom] = useState(null);
  const { status, editPrompt, target, beforeUrl, afterUrl, decided, error, verified } = preview;

  return (
    <div style={s.card}>
      <div style={s.label}>{target === "exterior" ? "Exterior Concept" : "Floor Plan Concept"}</div>
      <div style={s.prompt}>{editPrompt}</div>

      {status === "generating" && (
        <div style={s.spinner}>
          <div style={{ width: 16, height: 16, border: "2px solid #3a3a3a", borderTopColor: "#DAA520", borderRadius: "50%", animation: "modSpin 0.8s linear infinite" }} />
          Generating concept preview… this takes 15–40 seconds
        </div>
      )}

      {status === "error" && (
        <>
          <div style={s.error}>Couldn't generate that preview{error ? ` — ${error}` : ""}.</div>
          <div style={s.btnRow}>
            <button style={s.altBtn} onClick={() => onTryAgain(preview)} disabled={disabled}>Retry</button>
            <button style={s.altBtn} onClick={() => onSkip(preview)} disabled={disabled}>Skip</button>
          </div>
        </>
      )}

      {status === "ready" && (
        <>
          <div style={s.imgRow}>
            {beforeUrl && (
              <div style={s.imgCol}>
                <div style={s.imgLabel}>Before</div>
                <img src={beforeUrl} style={s.img} alt="Before" onClick={() => setZoom(beforeUrl)} />
              </div>
            )}
            <div style={s.imgCol}>
              <div style={{ ...s.imgLabel, color: "#DAA520" }}>After</div>
              <img src={afterUrl} style={{ ...s.img, border: "1px solid #B8860B55" }} alt="After" onClick={() => setZoom(afterUrl)} />
            </div>
          </div>
          {verified === false && !decided && (
            <div style={{ fontSize: 12, color: "#d9a94a", background: "#B8860B18", border: "1px solid #B8860B44", borderRadius: 8, padding: "8px 10px", marginBottom: 10, lineHeight: 1.45, fontFamily: "'Inter',sans-serif" }}>
              ⚠️ This concept may not fully capture the change — complex layout shifts are hard to preview. Your request is saved either way, and the design team will draft it precisely.
            </div>
          )}
          {decided === "kept" ? (
            <div style={{ ...s.decided, color: "#7ec97e" }}>✓ Change kept — added to your list</div>
          ) : decided === "skipped" ? (
            <div style={{ ...s.decided, color: "#888" }}>Concept skipped</div>
          ) : (
            <div style={s.btnRow}>
              <button style={s.keepBtn} onClick={() => onKeep(preview)} disabled={disabled}>✓ Keep</button>
              <button style={s.altBtn} onClick={() => onTryAgain(preview)} disabled={disabled}>↻ Try Again</button>
              <button style={s.altBtn} onClick={() => onSkip(preview)} disabled={disabled}>Skip</button>
            </div>
          )}
        </>
      )}

      {zoom && (
        <div
          onClick={() => setZoom(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out", padding: 20 }}
        >
          <img src={zoom} style={{ maxWidth: "95%", maxHeight: "95%", borderRadius: 8 }} alt="Zoomed concept" />
        </div>
      )}
    </div>
  );
}
