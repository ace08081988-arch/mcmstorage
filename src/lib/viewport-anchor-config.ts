/**
 * Pengaturan sensitivitas kompensasi viewport (bottom nav anchor).
 *
 * Perangkat low-end sering menghasilkan pengukuran visualViewport yang
 * "berisik": rAF telat, address bar bergerak lambat, dan animasi keyboard
 * lebih panjang. Nilai-nilai di bawah bisa disesuaikan per perangkat lalu
 * disimpan lokal (per user) supaya perilakunya pas.
 */
import { peekUserIdSync, scopedKey } from "@/lib/user-scoped-storage";

export type ViewportAnchorConfig = {
  /** Matikan seluruh kompensasi transform (bar murni `bottom: 0`). */
  enabled: boolean;
  /** Shrink (px) minimal agar dianggap keyboard TERBUKA. */
  keyboardOpenPx: number;
  /** Shrink (px) di bawah ini keyboard dianggap TERTUTUP (hysteresis). */
  keyboardClosePx: number;
  /** Jendela (ms) setelah scroll: shrink dianggap address bar, bukan keyboard. */
  scrollGraceMs: number;
  /** Batas wajar tinggi address bar/toolbar (px). */
  maxChromePx: number;
  /** Lama loop rAF tetap hidup setelah viewport berhenti bergerak (ms). */
  settleMs: number;
  /** Abaikan getaran sub-pixel di bawah nilai ini (px). */
  hysteresisPx: number;
};

export const DEFAULT_VIEWPORT_ANCHOR_CONFIG: ViewportAnchorConfig = {
  enabled: true,
  keyboardOpenPx: 140,
  keyboardClosePx: 100,
  scrollGraceMs: 300,
  maxChromePx: 180,
  settleMs: 350,
  hysteresisPx: 1,
};

/** Preset siap pakai untuk kelas perangkat berbeda. */
export const VIEWPORT_ANCHOR_PRESETS: Record<
  "default" | "lowend" | "sensitive",
  { label: string; hint: string; value: ViewportAnchorConfig }
> = {
  default: {
    label: "Seimbang (bawaan)",
    hint: "Cocok untuk sebagian besar HP Android.",
    value: DEFAULT_VIEWPORT_ANCHOR_CONFIG,
  },
  lowend: {
    label: "Perangkat low-end",
    hint: "Lebih toleran: rAF lebih pendek, hysteresis lebih besar, hemat CPU.",
    value: {
      enabled: true,
      keyboardOpenPx: 170,
      keyboardClosePx: 120,
      scrollGraceMs: 450,
      maxChromePx: 220,
      settleMs: 200,
      hysteresisPx: 4,
    },
  },
  sensitive: {
    label: "Sensitif / presisi",
    hint: "Reaksi paling cepat, dipakai kalau bar terasa telat mengikuti keyboard.",
    value: {
      enabled: true,
      keyboardOpenPx: 110,
      keyboardClosePx: 80,
      scrollGraceMs: 220,
      maxChromePx: 160,
      settleMs: 500,
      hysteresisPx: 1,
    },
  },
};

export const VIEWPORT_ANCHOR_CONFIG_EVENT = "mcm:viewport-anchor-config";
const BASE_KEY = "mcm:viewportAnchorConfig";

function storageKey() {
  return scopedKey(BASE_KEY, peekUserIdSync());
}

function clampNum(v: unknown, min: number, max: number, fallback: number) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function normalizeViewportAnchorConfig(
  raw: Partial<ViewportAnchorConfig> | null | undefined,
): ViewportAnchorConfig {
  const d = DEFAULT_VIEWPORT_ANCHOR_CONFIG;
  const cfg: ViewportAnchorConfig = {
    enabled: raw?.enabled ?? d.enabled,
    keyboardOpenPx: clampNum(raw?.keyboardOpenPx, 60, 320, d.keyboardOpenPx),
    keyboardClosePx: clampNum(raw?.keyboardClosePx, 40, 300, d.keyboardClosePx),
    scrollGraceMs: clampNum(raw?.scrollGraceMs, 0, 1200, d.scrollGraceMs),
    maxChromePx: clampNum(raw?.maxChromePx, 80, 320, d.maxChromePx),
    settleMs: clampNum(raw?.settleMs, 80, 1200, d.settleMs),
    hysteresisPx: clampNum(raw?.hysteresisPx, 0, 12, d.hysteresisPx),
  };
  // Ambang tutup harus selalu di bawah ambang buka agar hysteresis valid.
  if (cfg.keyboardClosePx >= cfg.keyboardOpenPx) {
    cfg.keyboardClosePx = Math.max(40, cfg.keyboardOpenPx - 20);
  }
  return cfg;
}

let cached: ViewportAnchorConfig | null = null;

export function getViewportAnchorConfig(): ViewportAnchorConfig {
  if (cached) return cached;
  if (typeof window === "undefined") return DEFAULT_VIEWPORT_ANCHOR_CONFIG;
  try {
    const raw = window.localStorage.getItem(storageKey());
    cached = normalizeViewportAnchorConfig(raw ? JSON.parse(raw) : null);
  } catch {
    cached = DEFAULT_VIEWPORT_ANCHOR_CONFIG;
  }
  return cached;
}

export function setViewportAnchorConfig(
  next: Partial<ViewportAnchorConfig>,
): ViewportAnchorConfig {
  const merged = normalizeViewportAnchorConfig({ ...getViewportAnchorConfig(), ...next });
  cached = merged;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(storageKey(), JSON.stringify(merged));
    } catch {
      /* storage penuh / mode privat — pengaturan tetap berlaku untuk sesi ini */
    }
    window.dispatchEvent(new CustomEvent(VIEWPORT_ANCHOR_CONFIG_EVENT, { detail: merged }));
  }
  return merged;
}

export function resetViewportAnchorConfig(): ViewportAnchorConfig {
  return setViewportAnchorConfig(DEFAULT_VIEWPORT_ANCHOR_CONFIG);
}
