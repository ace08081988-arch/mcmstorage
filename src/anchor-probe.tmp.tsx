import { createRoot } from "react-dom/client";
import { useViewportAnchor } from "@/lib/use-viewport-anchor";

function Bar() {
  const { anchorStyle, keyboardOpen } = useViewportAnchor({ lock: true });
  return (
    <div
      id="probe-bar"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        height: 56,
        background: "#c9a227",
        zIndex: 99999,
        opacity: keyboardOpen ? 0 : 1,
        ...anchorStyle,
      }}
    />
  );
}

export function mountProbe() {
  const host = document.createElement("div");
  document.documentElement.appendChild(host);
  createRoot(host).render(<Bar />);
}
