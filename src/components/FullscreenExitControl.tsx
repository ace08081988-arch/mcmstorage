import { useCallback, useEffect, useRef, useState } from "react";
import { Minimize2 } from "lucide-react";
import { exitFullscreenByUser } from "@/lib/fullscreen-mode";

/**
 * Jalan keluar dari layar penuh yang selalu terlihat:
 *  - Tombol melayang di kanan atas (aman dari notch) saat mode layar penuh.
 *  - Gesture: usap ke bawah dari tepi paling atas layar.
 *  - Tombol Escape tetap bekerja bawaan browser.
 * Setelah keluar, layar penuh otomatis dijeda supaya tidak langsung kembali.
 */
export function FullscreenExitControl() {
  const [active, setActive] = useState(false);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    const sync = () => setActive(Boolean(document.fullscreenElement));
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const exit = useCallback(() => {
    void exitFullscreenByUser();
  }, []);

  // Gesture: usap turun dari tepi atas (≤ 24px) sejauh ≥ 70px.
  useEffect(() => {
    if (!active) return;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      startY.current = t && t.clientY <= 24 ? t.clientY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (startY.current === null) return;
      const t = e.touches[0];
      if (!t) return;
      if (t.clientY - startY.current >= 70) {
        startY.current = null;
        exit();
      }
    };
    const onEnd = () => {
      startY.current = null;
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [active, exit]);

  if (!active) return null;

  return (
    <button
      type="button"
      onClick={exit}
      aria-label="Keluar dari layar penuh"
      title="Keluar dari layar penuh (Esc)"
      className="depth-3d-sm depth-tap fixed z-[70] flex items-center gap-1.5 rounded-full border border-border/60 bg-background/85 px-3 py-1.5 text-xs font-medium text-foreground shadow-lg backdrop-blur transition-opacity hover:opacity-100 opacity-70"
      style={{
        top: "max(0.5rem, calc(var(--app-safe-top, env(safe-area-inset-top, 0px)) + 0.375rem))",
        right: "max(0.5rem, calc(var(--app-safe-right, env(safe-area-inset-right, 0px)) + 0.5rem))",
      }}
    >
      <Minimize2 className="size-3.5" aria-hidden="true" />
      <span>Keluar</span>
    </button>
  );
}

export default FullscreenExitControl;