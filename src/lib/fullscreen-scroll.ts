/**
 * Pengaturan perilaku scroll saat mode layar penuh.
 *
 * Dipakai terutama agar preferensi "Saat scroll" tidak terasa mengganggu:
 * pengguna bisa mengatur seberapa jauh harus menggulir sebelum layar penuh
 * diminta, arah gulir yang memicu, apakah posisi gulir dikunci sesaat saat
 * transisi, dan apakah efek "bounce" dikunci selama layar penuh aktif.
 */

export type ScrollTriggerDirection = "any" | "down";

export type FullscreenScrollSettings = {
  /** Jarak gulir minimum (px) sebelum layar penuh diminta. */
  threshold: number;
  /** Arah gulir yang memicu layar penuh. */
  direction: ScrollTriggerDirection;
  /** Tahan posisi gulir sesaat saat masuk layar penuh (anti "loncat"). */
  freezeOnEnter: boolean;
  /** Kunci overscroll/bounce selama layar penuh aktif. */
  lockOverscroll: boolean;
  /** Pakai animasi halus untuk scroll programatik. */
  smoothScroll: boolean;
};

export const FULLSCREEN_SCROLL_LS_KEY = "app-fullscreen-scroll";
export const FULLSCREEN_SCROLL_EVENT = "app-fullscreen-scroll-change";

export const DEFAULT_SCROLL_SETTINGS: FullscreenScrollSettings = {
  threshold: 80,
  direction: "down",
  freezeOnEnter: true,
  lockOverscroll: true,
  smoothScroll: false,
};

/**
 * Cache in-memory: handler scroll dipanggil puluhan kali per detik, dan
 * `localStorage.getItem` + `JSON.parse` di jalur itu terasa sebagai lag.
 * Cache dibatalkan saat pengaturan berubah (dalam tab maupun tab lain).
 */
let cache: FullscreenScrollSettings | null = null;

function loadScrollSettings(): FullscreenScrollSettings {
  if (typeof window === "undefined") return DEFAULT_SCROLL_SETTINGS;
  try {
    const raw = localStorage.getItem(FULLSCREEN_SCROLL_LS_KEY);
    if (!raw) return DEFAULT_SCROLL_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<FullscreenScrollSettings>;
    return {
      threshold:
        typeof parsed.threshold === "number" && parsed.threshold >= 0
          ? Math.min(parsed.threshold, 600)
          : DEFAULT_SCROLL_SETTINGS.threshold,
      direction: parsed.direction === "any" ? "any" : "down",
      freezeOnEnter: parsed.freezeOnEnter !== false,
      lockOverscroll: parsed.lockOverscroll !== false,
      smoothScroll: parsed.smoothScroll === true,
    };
  } catch {
    return DEFAULT_SCROLL_SETTINGS;
  }
}

export function readScrollSettings(): FullscreenScrollSettings {
  if (!cache) cache = loadScrollSettings();
  return cache;
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (!e.key || e.key === FULLSCREEN_SCROLL_LS_KEY) cache = null;
  });
}

export function writeScrollSettings(next: Partial<FullscreenScrollSettings>) {
  if (typeof window === "undefined") return;
  const merged = { ...readScrollSettings(), ...next };
  cache = merged;
  try {
    localStorage.setItem(FULLSCREEN_SCROLL_LS_KEY, JSON.stringify(merged));
  } catch {
    /* ignore */
  }
  applyScrollSettings(merged);
  try {
    window.dispatchEvent(new CustomEvent(FULLSCREEN_SCROLL_EVENT, { detail: merged }));
  } catch {
    /* ignore */
  }
}

/** Tulis pengaturan ke <html> supaya CSS bisa menyesuaikan. */
export function applyScrollSettings(
  s: FullscreenScrollSettings = readScrollSettings(),
) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.scrollLock = s.lockOverscroll ? "1" : "0";
  root.dataset.scrollSmooth = s.smoothScroll ? "1" : "0";
}

/**
 * Kunci posisi gulir sebentar (default 350ms) supaya perubahan tinggi
 * viewport saat masuk/keluar layar penuh tidak membuat halaman meloncat.
 */
export function freezeScrollPosition(ms = 350) {
  if (typeof window === "undefined") return;
  const y = window.scrollY;
  const until = Date.now() + ms;
  const hold = () => {
    if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
    if (Date.now() < until) requestAnimationFrame(hold);
  };
  requestAnimationFrame(hold);
}
