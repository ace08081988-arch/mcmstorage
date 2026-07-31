/**
 * Auto-tuning ambang kompensasi viewport.
 *
 * Engine anchor mengirim sampel per-frame ke modul ini. Setiap jendela
 * evaluasi (beberapa detik) sampel diringkas menjadi indikator ketidakstabilan
 * posisi MobileBottomNav:
 *
 *  - flip     : status keyboard buka/tutup berkedip (klasifikasi salah)
 *  - salah    : keyboard "terdeteksi" padahal itu address bar saat scroll
 *  - getar    : offset berubah-ubah padahal mode tidak berubah
 *  - lambat   : jarak antar frame rAF jauh di atas 60fps (perangkat berat)
 *
 * Penyesuaian dilakukan BERTAHAP (satu langkah kecil per jendela, dengan
 * cooldown) dan selalu lewat `setViewportAnchorConfig`, jadi hasilnya tetap
 * tersimpan per user + per perangkat dan bisa dilihat/di-override manual.
 * Saat perangkat terbukti stabil beberapa jendela berturut-turut, nilai
 * ditarik pelan-pelan kembali ke bawaan agar tidak "kaku" selamanya.
 */
import { peekUserIdSync, scopedKey } from "@/lib/user-scoped-storage";
import { peekDeviceKeySync } from "@/lib/device-key";
import {
  DEFAULT_VIEWPORT_ANCHOR_CONFIG,
  getViewportAnchorConfig,
  setViewportAnchorConfig,
  type ViewportAnchorConfig,
} from "@/lib/viewport-anchor-config";

export type AutotuneReason = "flip" | "false-keyboard" | "jitter" | "slow-frames" | "relax";

export type AutotuneAdjustment = {
  at: number;
  reason: AutotuneReason;
  /** Ringkasan yang bisa dibaca user. */
  label: string;
  changes: { key: keyof ViewportAnchorConfig; from: number; to: number }[];
};

export type AutotuneStats = {
  /** Jumlah jendela evaluasi yang sudah dianalisis. */
  windows: number;
  /** Jendela stabil berturut-turut. */
  stableStreak: number;
  /** Skor stabilitas 0-100 dari jendela terakhir. */
  score: number;
  lastEvaluatedAt: number;
  lastWindow: {
    flips: number;
    falseKeyboard: number;
    jitter: number;
    slowFrames: number;
    samples: number;
  };
};

const EVAL_WINDOW_MS = 6000;
const COOLDOWN_MS = 15000;
const MIN_SAMPLES = 40;

export const VIEWPORT_AUTOTUNE_EVENT = "mcm:viewport-anchor-autotune";
const BASE_KEY = "mcm:viewportAnchorAutotune";

function storageKey() {
  return scopedKey(BASE_KEY, peekUserIdSync(), `d:${peekDeviceKeySync()}`);
}

type Persisted = { enabled: boolean; history: AutotuneAdjustment[] };

let persisted: Persisted | null = null;

function load(): Persisted {
  if (persisted) return persisted;
  if (typeof window === "undefined") return { enabled: true, history: [] };
  try {
    const raw = window.localStorage.getItem(storageKey());
    const parsed = raw ? (JSON.parse(raw) as Partial<Persisted>) : null;
    persisted = {
      enabled: parsed?.enabled ?? true,
      history: Array.isArray(parsed?.history) ? parsed.history.slice(0, 20) : [],
    };
  } catch {
    persisted = { enabled: true, history: [] };
  }
  return persisted;
}

function save() {
  if (typeof window === "undefined" || !persisted) return;
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(persisted));
  } catch {
    /* storage penuh — tetap berlaku untuk sesi ini */
  }
}

const EMPTY_WINDOW = { flips: 0, falseKeyboard: 0, jitter: 0, slowFrames: 0, samples: 0 };

let stats: AutotuneStats = {
  windows: 0,
  stableStreak: 0,
  score: 100,
  lastEvaluatedAt: 0,
  lastWindow: { ...EMPTY_WINDOW },
};

function emit() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(VIEWPORT_AUTOTUNE_EVENT));
}

export function isAutotuneEnabled(): boolean {
  return load().enabled;
}

export function setAutotuneEnabled(enabled: boolean) {
  const p = load();
  p.enabled = enabled;
  save();
  resetWindow(typeof performance !== "undefined" ? performance.now() : 0);
  emit();
}

export function getAutotuneHistory(): AutotuneAdjustment[] {
  return load().history;
}

export function getAutotuneStats(): AutotuneStats {
  return stats;
}

export function clearAutotuneHistory() {
  const p = load();
  p.history = [];
  save();
  stats = {
    windows: 0,
    stableStreak: 0,
    score: 100,
    lastEvaluatedAt: 0,
    lastWindow: { ...EMPTY_WINDOW },
  };
  emit();
}

// ---------------------------------------------------------------- akumulator
let windowStart = 0;
let samples = 0;
let flips = 0;
let falseKeyboard = 0;
let jitter = 0;
let slowFrames = 0;
let lastKeyboard = false;
let lastKeyboardChangeAt = 0;
let lastOffset = 0;
let lastFrameAt = 0;
let lastAdjustAt = 0;

function resetWindow(now: number) {
  windowStart = now;
  samples = 0;
  flips = 0;
  falseKeyboard = 0;
  jitter = 0;
  slowFrames = 0;
}

export type AutotuneSample = {
  now: number;
  shrinkPx: number;
  offsetPx: number;
  keyboardOpen: boolean;
  recentlyScrolled: boolean;
  config: ViewportAnchorConfig;
};

/** Dipanggil dari loop rAF engine anchor (murah: hanya aritmetika). */
export function observeAnchorFrame(s: AutotuneSample) {
  if (!load().enabled) return;
  const { now } = s;
  if (!windowStart) resetWindow(now);
  samples++;

  if (lastFrameAt && now - lastFrameAt > 32) slowFrames++;
  lastFrameAt = now;

  if (s.keyboardOpen !== lastKeyboard) {
    // Perubahan status <700ms = berkedip, bukan buka/tutup keyboard sungguhan.
    if (lastKeyboardChangeAt && now - lastKeyboardChangeAt < 700) flips++;
    lastKeyboard = s.keyboardOpen;
    lastKeyboardChangeAt = now;
  } else if (Math.abs(s.offsetPx - lastOffset) > s.config.hysteresisPx) {
    // Offset bergerak padahal mode tidak berubah → bar terlihat bergetar.
    jitter++;
  }
  lastOffset = s.offsetPx;

  // Keyboard "terdeteksi" saat user baru saja menggulir dan penyusutan masih
  // sewajarnya address bar → hampir pasti salah klasifikasi.
  if (s.keyboardOpen && s.recentlyScrolled && s.shrinkPx <= s.config.maxChromePx + 40) {
    falseKeyboard++;
  }

  if (now - windowStart >= EVAL_WINDOW_MS) evaluate(now);
}

function pushAdjustment(
  reason: AutotuneReason,
  label: string,
  patch: Partial<ViewportAnchorConfig>,
) {
  const before = getViewportAnchorConfig();
  const after = setViewportAnchorConfig(patch);
  const changes = (Object.keys(patch) as (keyof ViewportAnchorConfig)[])
    .filter((k) => typeof after[k] === "number" && before[k] !== after[k])
    .map((k) => ({ key: k, from: before[k] as number, to: after[k] as number }));
  if (!changes.length) return false;
  const p = load();
  p.history = [{ at: Date.now(), reason, label, changes }, ...p.history].slice(0, 20);
  save();
  lastAdjustAt = typeof performance !== "undefined" ? performance.now() : 0;
  return true;
}

function evaluate(now: number) {
  const total = samples;
  const w = { flips, falseKeyboard, jitter, slowFrames, samples: total };
  stats = {
    windows: stats.windows + 1,
    stableStreak: stats.stableStreak,
    score: stats.score,
    lastEvaluatedAt: Date.now(),
    lastWindow: w,
  };

  if (total < MIN_SAMPLES) {
    // Jendela terlalu sepi (tidak ada interaksi) — bukan bukti stabil/goyah.
    resetWindow(now);
    emit();
    return;
  }

  const jitterRate = jitter / total;
  const slowRate = slowFrames / total;
  const penalty = flips * 18 + falseKeyboard * 0.5 + jitterRate * 220 + slowRate * 80;
  stats.score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  const unstable = flips >= 2 || falseKeyboard >= 8 || jitterRate > 0.08 || slowRate > 0.35;
  stats.stableStreak = unstable ? 0 : stats.stableStreak + 1;

  const cfg = getViewportAnchorConfig();
  const cooling = now - lastAdjustAt < COOLDOWN_MS;

  if (!cooling) {
    if (falseKeyboard >= 8) {
      pushAdjustment(
        "false-keyboard",
        "Address bar sempat dianggap keyboard — ambang buka & jendela scroll dinaikkan",
        { keyboardOpenPx: cfg.keyboardOpenPx + 10, scrollGraceMs: cfg.scrollGraceMs + 50 },
      );
    } else if (flips >= 2) {
      pushAdjustment("flip", "Status keyboard berkedip — jarak hysteresis dilebarkan", {
        keyboardOpenPx: cfg.keyboardOpenPx + 10,
        keyboardClosePx: cfg.keyboardClosePx - 10,
      });
    } else if (jitterRate > 0.08) {
      pushAdjustment("jitter", "Bar bergetar — toleransi getaran dinaikkan", {
        hysteresisPx: cfg.hysteresisPx + 1,
      });
    } else if (slowRate > 0.35) {
      pushAdjustment("slow-frames", "Frame berat — durasi pengukuran dipersingkat", {
        settleMs: Math.max(150, cfg.settleMs - 40),
        hysteresisPx: cfg.hysteresisPx + 1,
      });
    } else if (stats.stableStreak >= 3) {
      // Stabil berturut-turut → tarik pelan kembali ke bawaan.
      const d = DEFAULT_VIEWPORT_ANCHOR_CONFIG;
      const relax: Partial<ViewportAnchorConfig> = {};
      if (cfg.keyboardOpenPx > d.keyboardOpenPx)
        relax.keyboardOpenPx = Math.max(d.keyboardOpenPx, cfg.keyboardOpenPx - 5);
      if (cfg.scrollGraceMs > d.scrollGraceMs)
        relax.scrollGraceMs = Math.max(d.scrollGraceMs, cfg.scrollGraceMs - 25);
      if (cfg.hysteresisPx > d.hysteresisPx)
        relax.hysteresisPx = Math.max(d.hysteresisPx, cfg.hysteresisPx - 1);
      if (Object.keys(relax).length) {
        if (
          pushAdjustment("relax", "Posisi stabil — ambang dikembalikan mendekati bawaan", relax)
        ) {
          stats.stableStreak = 0;
        }
      }
    }
  }

  resetWindow(now);
  emit();
}