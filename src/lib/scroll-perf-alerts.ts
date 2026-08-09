/**
 * Notifikasi otomatis saat performa scroll anjlok.
 *
 * Setiap fase gulir yang selesai diukur oleh `scroll-perf` dibandingkan
 * dengan ambang batas yang bisa diatur pengguna. Bila FPS turun di bawah
 * ambang, atau latensi sentuh→frame melewati batas, sebuah toast peringatan
 * muncul (dengan jeda antar-peringatan supaya tidak menumpuk) dan kejadian
 * dicatat agar bisa dilihat lagi di halaman Diagnostik.
 */
import { toast } from "sonner";
import { getScrollPerfMetrics, subscribeScrollPerf, type ScrollPerfMetrics } from "./scroll-perf";

export type ScrollPerfAlertPrefs = {
  enabled: boolean;
  /** Peringatkan bila FPS rata-rata fase di bawah nilai ini. */
  fpsMin: number;
  /** Peringatkan bila latensi sentuh→frame melewati nilai ini (ms). */
  latencyMaxMs: number;
  /** Jeda minimal antar peringatan (detik) supaya tidak spam. */
  cooldownSec: number;
};

export type ScrollPerfAlert = {
  at: number;
  reason: "fps" | "latency" | "both";
  fps: number;
  latencyMs: number;
  jankFrames: number;
};

export const SCROLL_PERF_ALERT_PREFS_KEY = "app-scroll-perf-alerts";
export const SCROLL_PERF_ALERT_LOG_KEY = "app-scroll-perf-alert-log";
const MAX_LOG = 30;

export const DEFAULT_ALERT_PREFS: ScrollPerfAlertPrefs = {
  enabled: true,
  fpsMin: 45,
  latencyMaxMs: 60,
  cooldownSec: 20,
};

const listeners = new Set<() => void>();
let prefsCache: ScrollPerfAlertPrefs | null = null;
let logCache: ScrollPerfAlert[] | null = null;

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeScrollPerfAlerts(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function loadAlertPrefs(): ScrollPerfAlertPrefs {
  if (prefsCache) return prefsCache;
  if (typeof window === "undefined") return DEFAULT_ALERT_PREFS;
  try {
    const raw = localStorage.getItem(SCROLL_PERF_ALERT_PREFS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<ScrollPerfAlertPrefs>) : {};
    prefsCache = { ...DEFAULT_ALERT_PREFS, ...parsed };
  } catch {
    prefsCache = DEFAULT_ALERT_PREFS;
  }
  return prefsCache;
}

export function saveAlertPrefs(patch: Partial<ScrollPerfAlertPrefs>): ScrollPerfAlertPrefs {
  const next = { ...loadAlertPrefs(), ...patch };
  prefsCache = next;
  try {
    localStorage.setItem(SCROLL_PERF_ALERT_PREFS_KEY, JSON.stringify(next));
  } catch {
    /* mode privat → cukup di memori */
  }
  emit();
  return next;
}

export function listScrollPerfAlerts(): ScrollPerfAlert[] {
  if (logCache) return logCache;
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SCROLL_PERF_ALERT_LOG_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    logCache = Array.isArray(parsed) ? (parsed as ScrollPerfAlert[]) : [];
  } catch {
    logCache = [];
  }
  return logCache;
}

export function clearScrollPerfAlerts(): void {
  logCache = [];
  try {
    localStorage.removeItem(SCROLL_PERF_ALERT_LOG_KEY);
  } catch {
    /* ignore */
  }
  emit();
}

function pushLog(entry: ScrollPerfAlert) {
  const rows = [entry, ...listScrollPerfAlerts()].slice(0, MAX_LOG);
  logCache = rows;
  try {
    localStorage.setItem(SCROLL_PERF_ALERT_LOG_KEY, JSON.stringify(rows));
  } catch {
    /* ignore */
  }
  emit();
}

/** Evaluasi satu fase gulir; kembalikan alasan pelanggaran ambang (bila ada). */
export function evaluateScrollPerf(
  m: ScrollPerfMetrics,
  prefs: ScrollPerfAlertPrefs,
): ScrollPerfAlert["reason"] | null {
  if (!m.fps) return null;
  const badFps = m.fps < prefs.fpsMin;
  const badLatency = m.latencyMs > prefs.latencyMaxMs;
  if (badFps && badLatency) return "both";
  if (badFps) return "fps";
  if (badLatency) return "latency";
  return null;
}

/**
 * Pantau metrik scroll dan tampilkan peringatan saat ambang terlampaui.
 * Aman dipanggil sekali saat boot; kembalikan fungsi pembersih.
 */
export function startScrollPerfAlerts(opts?: { onOpenDiagnostics?: () => void }): () => void {
  if (typeof window === "undefined") return () => {};
  let lastPhase = -1;
  let lastAlertAt = 0;

  const unsub = subscribeScrollPerf(() => {
    const m = getScrollPerfMetrics();
    // Hanya nilai fase yang sudah selesai (samples bertambah, gulir berhenti).
    if (m.scrolling || m.samples === lastPhase) return;
    lastPhase = m.samples;

    const prefs = loadAlertPrefs();
    if (!prefs.enabled) return;
    const reason = evaluateScrollPerf(m, prefs);
    if (!reason) return;

    const now = Date.now();
    if (now - lastAlertAt < prefs.cooldownSec * 1000) return;
    lastAlertAt = now;

    pushLog({
      at: now,
      reason,
      fps: m.fps,
      latencyMs: m.latencyMs,
      jankFrames: m.jankFrames,
    });

    const detail =
      reason === "fps"
        ? `FPS ${m.fps} (ambang ${prefs.fpsMin})`
        : reason === "latency"
          ? `Latensi ${m.latencyMs} ms (batas ${prefs.latencyMaxMs} ms)`
          : `FPS ${m.fps} · latensi ${m.latencyMs} ms`;

    toast.warning("Scroll terasa berat", {
      description: `${detail} · ${m.jankFrames} frame tersendat`,
      duration: 6000,
      action: {
        label: "Diagnostik",
        onClick: () => {
          if (opts?.onOpenDiagnostics) opts.onOpenDiagnostics();
          else window.location.assign("/diagnostik-viewport");
        },
      },
    });
  });

  return () => unsub();
}
