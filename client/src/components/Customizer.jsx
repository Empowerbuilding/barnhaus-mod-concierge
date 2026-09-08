import React, { useState, useEffect } from "react";
import PlanPanel from "./PlanPanel.jsx";
import ModChat from "./ModChat.jsx";
import { useModChat } from "../hooks/useModChat.js";

const s = {
  desktop: { display: "flex", flex: 1, minHeight: 0, width: "100%" },
  left: { flex: "1 1 55%", minWidth: 0, borderRight: "1px solid #2a2a2a", background: "#1C1C1C", display: "flex", flexDirection: "column" },
  right: { flex: "1 1 45%", minWidth: 380, maxWidth: 640, display: "flex", flexDirection: "column" },
  mobile: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0, width: "100%" },
  mobileTop: { flexShrink: 0, background: "#1C1C1C", borderBottom: "1px solid #2a2a2a" },
  mobileChat: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" },
};

function useIsMobile() {
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 900);
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 900);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return mobile;
}

export default function Customizer({ plan }) {
  const chat = useModChat(plan);
  const isMobile = useIsMobile();

  const userActivity = chat.messages.filter(m => m.role === "user").length;

  if (isMobile) {
    return (
      <div style={s.mobile}>
        <div style={s.mobileTop}>
          <PlanPanel plan={plan} concepts={chat.concepts} isMobile userActivity={userActivity} />
        </div>
        <div style={s.mobileChat}>
          <ModChat chat={chat} isMobile />
        </div>
      </div>
    );
  }

  return (
    <div style={s.desktop}>
      <div style={s.left}>
        <PlanPanel plan={plan} concepts={chat.concepts} isMobile={false} />
      </div>
      <div style={s.right}>
        <ModChat chat={chat} />
      </div>
    </div>
  );
}
