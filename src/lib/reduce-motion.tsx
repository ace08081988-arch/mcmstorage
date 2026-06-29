import { useEffect, useRef, useState, useCallback, type RefObject } from "react";
import { REDUCE_MOTION_EVENT, type ReduceMotionMode } from "@/components/ReduceMotionToggle";

const LS_KEY = "app-reduce-motion";

function readMode(): ReduceMotionMode {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw === "on" || raw === "off" || raw === "system") return raw;
  } catch {
    /* ignore */
  }
  return "system";
}

function systemPrefersReduced(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Sinkron — bisa dipakai di luar render (mis. di dalam rAF callback). */
export function isReduceMotionActive(): boolean {
  if (typeof document !== "undefined") {
    // Sumber kebenaran utama: kelas pada <html> yang dipasang ReduceMotionToggle.
    if (document.documentElement.classList.contains("reduce-motion")) return true;
    const mode = document.documentElement.dataset.motion as ReduceMotionMode | undefined;
    if (mode === "off") return false;
    if (mode === "on") return true;
  }
  const m = readMode();
  if (m === "on") return true;
  if (m === "off") return false;
  return systemPrefersReduced();
}

/** Hook reaktif — re-render saat status berubah (toggle UI, OS, storage). */
export function useReduceMotion(): boolean {
  const [active, setActive] = useState<boolean>(() => isReduceMotionActive());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setActive(isReduceMotionActive());
    sync();

    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const onMq = () => sync();
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_KEY) sync();
    };
    const onCustom = () => sync();

    try { mq?.addEventListener?.("change", onMq); } catch { /* ignore */ }
    window.addEventListener("storage", onStorage);
    window.addEventListener(REDUCE_MOTION_EVENT, onCustom as EventListener);
    return () => {
      try { mq?.removeEventListener?.("change", onMq); } catch { /* ignore */ }
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(REDUCE_MOTION_EVENT, onCustom as EventListener);
    };
  }, []);

  return active;
}

/**
 * Minimal kontrak Lottie agar tidak perlu impor lottie-web.
 * Kompatibel dengan instance dari `lottie-web`, `@lottiefiles/react-lottie-player`
 * (ref.current), dan `lottie-react` (lottieRef.current).
 */
export type LottieLike = {
  play?: () => void;
  pause?: () => void;
  stop?: () => void;
  goToAndStop?: (value: number, isFrame?: boolean) => void;
  setSpeed?: (speed: number) => void;
};

/**
 * Kontrol playback Lottie sesuai status ReduceMotion:
 * - aktif → `pause()` (atau `goToAndStop(0)` bila `freezeAtStart`).
 * - non-aktif → `play()` bila `autoPlay` true.
 * Aman terhadap ref yang masih null saat mount.
 */
export function useLottieReduceMotion(
  ref: RefObject<LottieLike | null>,
  opts: { autoPlay?: boolean; freezeAtStart?: boolean } = {},
) {
  const { autoPlay = true, freezeAtStart = false } = opts;
  const reduced = useReduceMotion();

  useEffect(() => {
    const inst = ref.current;
    if (!inst) return;
    if (reduced) {
      try {
        if (freezeAtStart && typeof inst.goToAndStop === "function") inst.goToAndStop(0, true);
        else inst.pause?.();
      } catch { /* ignore */ }
    } else if (autoPlay) {
      try { inst.play?.(); } catch { /* ignore */ }
    }
  }, [reduced, autoPlay, freezeAtStart, ref]);

  return reduced;
}

/**
 * rAF loop yang otomatis berhenti saat ReduceMotion aktif dan
 * lanjut kembali saat dinonaktifkan. `tick` menerima delta ms sejak
 * frame sebelumnya. Saat tab di-background, loop juga di-pause.
 */
export function useCanvasAnimation(
  tick: (deltaMs: number) => void,
  opts: { enabled?: boolean; pauseWhenHidden?: boolean } = {},
) {
  const { enabled = true, pauseWhenHidden = true } = opts;
  const reduced = useReduceMotion();
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!enabled || reduced) return;
    if (typeof window === "undefined") return;

    let rafId = 0;
    let last = performance.now();
    let stopped = false;

    const loop = (now: number) => {
      if (stopped) return;
      if (pauseWhenHidden && document.visibilityState === "hidden") {
        // tunggu sampai visible lagi
        const onVis = () => {
          if (document.visibilityState === "visible") {
            document.removeEventListener("visibilitychange", onVis);
            last = performance.now();
            rafId = requestAnimationFrame(loop);
          }
        };
        document.addEventListener("visibilitychange", onVis);
        return;
      }
      const delta = now - last;
      last = now;
      try { tickRef.current(delta); } catch { /* ignore */ }
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
    };
  }, [enabled, reduced, pauseWhenHidden]);

  return reduced;
}

/**
 * Wrapper render: tampilkan `fallback` (mis. poster statis) saat
 * ReduceMotion aktif, jika tidak render `children` (mis. <Lottie /> / <canvas>).
 */
export function MotionGate({
  children,
  fallback = null,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const reduced = useReduceMotion();
  return <>{reduced ? fallback : children}</>;
}

/** Util kecil untuk komponen tak ber-hook (mis. event handler kelas). */
export function withReduceMotion<T>(active: T, idle: T): T {
  return isReduceMotionActive() ? active : idle;
}

/** Re-export untuk konsumen yang ingin subscribe manual. */
export { REDUCE_MOTION_EVENT };

// Bantu Hook ESLint mengenali nama hook untuk callback tanpa ref khusus.
export function useReducedMotionEffect(callback: (reduced: boolean) => void) {
  const cb = useCallback(callback, [callback]);
  const reduced = useReduceMotion();
  useEffect(() => { cb(reduced); }, [cb, reduced]);
}