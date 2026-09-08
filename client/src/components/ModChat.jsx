import React, { useEffect, useRef, useState } from "react";
import MessageBubble from "./MessageBubble.jsx";
import TypingIndicator from "./TypingIndicator.jsx";
import FieldCard from "./FieldCard.jsx";
import PreviewCard from "./PreviewCard.jsx";
import ProgressTracker from "./ProgressTracker.jsx";
import ChangeList from "./ChangeList.jsx";

const s = {
  container: { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", width: "100%", background: "#1a1a1a" },
  messagesArea: { flex: 1, overflowY: "auto", padding: "16px 0", display: "flex", flexDirection: "column", gap: 12, minHeight: 0 },
  inputArea: { padding: "14px 16px", borderTop: "1px solid #2a2a2a", flexShrink: 0, background: "#1a1a1a" },
  inputRow: { display: "flex", gap: 8, alignItems: "center" },
  input: { flex: 1, padding: "13px 18px", borderRadius: 24, border: "1px solid #3a3a3a", background: "#222", color: "#fff", fontSize: 15, outline: "none", fontFamily: "'Inter',sans-serif", minWidth: 0 },
  sendBtn: { width: 44, height: 44, borderRadius: "50%", border: "none", background: "linear-gradient(135deg,#B8860B,#DAA520)", color: "#1a1a1a", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  sendBtnDisabled: { opacity: 0.4, cursor: "not-allowed" },
  completeScreen: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, padding: 40, textAlign: "center", gap: 14 },
  completeTitle: { fontSize: 24, fontWeight: 700, color: "#fff", fontFamily: "'Inter',sans-serif" },
  completeText: { fontSize: 15, color: "#aaa", lineHeight: 1.6, maxWidth: 380, fontFamily: "'Inter',sans-serif" },
};

export default function ModChat({ chat, isMobile }) {
  const {
    messages, isLoading, isComplete, submissionData,
    activeFields, dismissFields, step, changeList,
    sendMessage, startConversation, keepPreview, tryAgainPreview, skipPreview, saveWithoutPreview,
  } = chat;

  const [input, setInput] = useState("");
  const messagesEnd = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { startConversation(); }, [startConversation]);
  useEffect(() => { messagesEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isLoading]);
  // Autofocus only on desktop — on mobile it pops the keyboard on page load and buries the UI
  useEffect(() => { if (!isLoading && !isMobile) setTimeout(() => inputRef.current?.focus(), 100); }, [isLoading, isMobile]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    sendMessage(text);
  };

  const visible = messages.filter(m => !m.hidden);

  return (
    <div style={s.container}>
      <ProgressTracker step={step} isComplete={isComplete} isMobile={isMobile} />
      <ChangeList changes={changeList} isMobile={isMobile} />

      {isComplete ? (
        <div style={s.completeScreen}>
          <div style={{ fontSize: 44 }}>✓</div>
          <div style={s.completeTitle}>Changes Sent to the Design Team</div>
          <div style={s.completeText}>
            Thank you{submissionData?.name ? `, ${submissionData.name}` : ""}! Your customization requests
            {changeList.length ? ` (${changeList.length} change${changeList.length > 1 ? "s" : ""})` : ""} are on their way to the Barnhaus design team. Someone will reach out within 24 hours.
          </div>
        </div>
      ) : (
        <>
          <div style={s.messagesArea}>
            {visible.map((msg, i) =>
              msg.preview ? (
                <PreviewCard
                  key={`p${msg.preview.id}`}
                  preview={msg.preview}
                  onKeep={keepPreview}
                  onTryAgain={tryAgainPreview}
                  onSkip={skipPreview}
                  onSaveNoImage={saveWithoutPreview}
                  disabled={isLoading}
                />
              ) : (
                <MessageBubble key={i} message={msg} />
              )
            )}
            {isLoading && <TypingIndicator />}
            <div ref={messagesEnd} />
          </div>

          {activeFields && (
            <div style={{ padding: "0 16px" }}>
              <FieldCard
                fields={activeFields}
                onSubmit={(msg, values) => {
                  dismissFields();
                  const isContactCard = activeFields?.some(f => f.key === "email");
                  const partial = isContactCard && values ? { name: values.name, email: values.email, phone: values.phone } : undefined;
                  sendMessage(msg, { partial });
                }}
                onDismiss={dismissFields}
              />
            </div>
          )}

          <div style={s.inputArea}>
            <div style={s.inputRow}>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Describe the changes you want…"
                style={s.input}
                onFocus={e => (e.target.style.borderColor = "#B8860B")}
                onBlur={e => (e.target.style.borderColor = "#3a3a3a")}
                disabled={isLoading}
              />
              <button
                onClick={handleSend}
                style={{ ...s.sendBtn, ...(isLoading || !input.trim() ? s.sendBtnDisabled : {}) }}
                disabled={isLoading || !input.trim()}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
