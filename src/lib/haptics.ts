/**
 * Haptic feedback ringan untuk reaksi sentuh UI.
 *
 * Prioritas:
 *  1. Capacitor Haptics (jika plugin terpasang di build native — di-load
 *     secara dinamis agar bundle web tidak wajib punya package-nya).
 *  2. `navigator.vibrate` (Chrome Android / WebView).
 *  3. No-op (iOS Safari web, desktop) — aman untuk semua platform.
 *
 * Menghormati `prefers-reduced-motion: reduce` — pengguna yang meminta
 * animasi minimum tidak akan digetarkan.
 */

export type HapticIntensity = "light" | "medium" | "heavy" | "selection";

const VIBRATE_MS: Record<HapticIntensity, number> = {
  selection: 8,
  light: 10,
  medium: 18,
  heavy: 28,
};

let capacitorHapticsPromise: Promise<null | {
  impact: (opts: { style: "LIGHT" | "MEDIUM" | "HEAVY" }) => Promise<void>;
  selection: () => Promise<void>;
}> | null = null;

function loadCapacitorHaptics() {
  if (capacitorHapticsPromise) return capacitorHapticsPromise;
  capacitorHapticsPromise = (async () => {
    if (typeof window === "undefined") return null;
    // @ts-expect-error — Capacitor global disuntik oleh runtime native.
    const cap = window.Capacitor;
    if (!cap?.isNativePlatform?.()) return null;
    try {
      // Import via variable expression agar TS tidak resolve module secara statis
      // (paket opsional, hanya ada di build native).
      const specifier = "@capacitor/haptics";
      const mod = await import(/* @vite-ignore */ specifier);
      const { Haptics, ImpactStyle } = mod as {
        Haptics: {
          impact: (o: { style: unknown }) => Promise<void>;
          selectionStart: () => Promise<void>;
          selectionChanged: () => Promise<void>;
          selectionEnd: () => Promise<void>;
        };
        ImpactStyle: { Light: unknown; Medium: unknown; Heavy: unknown };
      };
      return {
        impact: (opts) =>
          Haptics.impact({
            style:
              opts.style === "LIGHT"
                ? ImpactStyle.Light
                : opts.style === "HEAVY"
                  ? ImpactStyle.Heavy
                  : ImpactStyle.Medium,
          }),
        selection: async () => {
          await Haptics.selectionStart();
          await Haptics.selectionChanged();
          await Haptics.selectionEnd();
        },
      };
    } catch {
      return null;
    }
  })();
  return capacitorHapticsPromise;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function haptic(intensity: HapticIntensity = "light"): void {
  if (prefersReducedMotion()) return;
  // Fire-and-forget: jangan block handler klik.
  void (async () => {
    const cap = await loadCapacitorHaptics();
    if (cap) {
      try {
        if (intensity === "selection") await cap.selection();
        else
          await cap.impact({
            style: intensity === "heavy" ? "HEAVY" : intensity === "medium" ? "MEDIUM" : "LIGHT",
          });
        return;
      } catch {
        // fallthrough ke vibrate
      }
    }
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      try {
        navigator.vibrate(VIBRATE_MS[intensity]);
      } catch {
        /* ignore */
      }
    }
  })();
}