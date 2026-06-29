import { useEffect, useState } from "react";
import { Gauge, Sparkles, MonitorCog, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

const LS_KEY = "app-reduce-motion";
export const REDUCE_MOTION_EVENT = "reduce-motion-change";
export type ReduceMotionMode = "system" | "on" | "off";

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

function effectiveReduced(mode: ReduceMotionMode): boolean {
  if (mode === "on") return true;
  if (mode === "off") return false;
  return systemPrefersReduced();
}

export function applyReduceMotion() {
  if (typeof document === "undefined") return;
  const mode = readMode();
  const on = effectiveReduced(mode);
  document.documentElement.classList.toggle("reduce-motion", on);
  document.documentElement.dataset.motion = mode;
}

const NEXT: Record<ReduceMotionMode, ReduceMotionMode> = {
  system: "on",
  on: "off",
  off: "system",
};

const LABELS: Record<ReduceMotionMode, { label: string; title: string }> = {
  system: {
    label: "Animasi: ikuti sistem",
    title: "Ikuti preferensi sistem (prefers-reduced-motion). Klik untuk paksa kurangi.",
  },
  on: {
    label: "Animasi: kurangi",
    title: "Animasi & transisi diminimalkan. Klik untuk menonaktifkan pengurangan.",
  },
  off: {
    label: "Animasi: penuh",
    title: "Semua animasi aktif (mengesampingkan prefers-reduced-motion). Klik untuk kembali ke sistem.",
  },
};

export function ReduceMotionToggle() {
  const [mode, setMode] = useState<ReduceMotionMode>(() => readMode());

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, mode);
    } catch {
      /* ignore */
    }
    applyReduceMotion();
    try {
      window.dispatchEvent(new CustomEvent(REDUCE_MOTION_EVENT, { detail: { mode } }));
    } catch {
      /* ignore */
    }
  }, [mode]);

  // Re-evaluate when the system preference changes while in "system" mode,
  // and stay in sync with changes from other tabs (storage event).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const onMq = () => {
      if (readMode() === "system") applyReduceMotion();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_KEY) {
        const next = readMode();
        setMode(next);
      }
    };
    try { mq?.addEventListener?.("change", onMq); } catch { /* ignore */ }
    window.addEventListener("storage", onStorage);
    return () => {
      try { mq?.removeEventListener?.("change", onMq); } catch { /* ignore */ }
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const meta = LABELS[mode];
  const Icon = mode === "on" ? Gauge : mode === "off" ? Sparkles : MonitorCog;

  return (
    <div className="flex w-full items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 flex-1 justify-start gap-2 px-2 text-xs"
        onClick={() => setMode((m) => NEXT[m])}
        title={meta.title}
        aria-label={meta.title}
      >
        <Icon className="h-3.5 w-3.5" />
        <span className="truncate">{meta.label}</span>
      </Button>
      {mode !== "system" && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 shrink-0 p-0"
          onClick={() => setMode("system")}
          title="Reset ke sistem (ikuti prefers-reduced-motion)"
          aria-label="Reset animasi ke pengaturan sistem"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}