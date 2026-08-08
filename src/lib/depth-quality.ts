/**
 * Kualitas efek 3D (rendah / sedang / tinggi).
 *
 * Menyetel atribut `data-d3-quality` di <html>; seluruh aturan berat
 * (kilau/sheen, transform hover, bayangan berlapis) digating dari
 * `src/styles.css` berdasarkan atribut ini. Nilai disimpan per perangkat
 * (bukan per akun) karena ini murni soal performa hardware.
 */
export type DepthQuality = "low" | "medium" | "high";

export const DEPTH_QUALITY_KEY = "app-3d-quality";
/** Ringankan efek saat mode layar penuh aktif di perangkat lemah. */
export const DEPTH_LITE_FS_KEY = "app-3d-lite-fullscreen";

export const DEPTH_QUALITY_OPTIONS: { id: DepthQuality; label: string; hint: string }[] = [
  { id: "low", label: "Rendah", hint: "Datar & paling ringan — tanpa kilau, tanpa animasi angkat." },
  { id: "medium", label: "Sedang", hint: "Bayangan lembut + tekan, tanpa kilau cahaya." },
  { id: "high", label: "Tinggi", hint: "Semua efek: bevel, kilau cahaya, dan angkat 3D." },
];

/** Tebak kualitas yang aman untuk perangkat ini saat user belum memilih. */
export function detectDepthQuality(): DepthQuality {
  if (typeof window === "undefined") return "high";
  try {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const mem = nav.deviceMemory ?? 0;
    const cores = nav.hardwareConcurrency ?? 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return "low";
    if ((mem && mem <= 2) || (cores && cores <= 4)) return "low";
    if ((mem && mem <= 4) || (cores && cores <= 6)) return "medium";
  } catch {
    /* abaikan — fallback ke high */
  }
  return "high";
}

export function readDepthQuality(): DepthQuality {
  if (typeof window === "undefined") return "high";
  const raw = localStorage.getItem(DEPTH_QUALITY_KEY);
  if (raw === "low" || raw === "medium" || raw === "high") return raw;
  return detectDepthQuality();
}

/** Perangkat berspesifikasi rendah (RAM kecil / core sedikit). */
export function isLowPerfDevice(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const mem = nav.deviceMemory ?? 0;
    const cores = nav.hardwareConcurrency ?? 0;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
    return (mem > 0 && mem <= 4) || (cores > 0 && cores <= 6);
  } catch {
    return false;
  }
}

export function readLiteFullscreen(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(DEPTH_LITE_FS_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeLiteFullscreen(on: boolean) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DEPTH_LITE_FS_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  applyDepthQuality(readDepthQuality());
}

function isFullscreenNow(): boolean {
  if (typeof document === "undefined") return false;
  if (document.fullscreenElement) return true;
  return window.matchMedia?.("(display-mode: fullscreen)").matches ?? false;
}

function downgrade(q: DepthQuality): DepthQuality {
  return q === "high" ? "medium" : "low";
}

/**
 * Kualitas yang benar-benar dipakai: pilihan pengguna, diturunkan satu
 * tingkat saat layar penuh aktif di perangkat berperforma rendah.
 */
export function effectiveDepthQuality(q: DepthQuality = readDepthQuality()): DepthQuality {
  if (readLiteFullscreen() && isLowPerfDevice() && isFullscreenNow()) return downgrade(q);
  return q;
}

export function applyDepthQuality(q: DepthQuality) {
  if (typeof document === "undefined") return;
  const eff = effectiveDepthQuality(q);
  document.documentElement.dataset.d3Quality = eff;
  document.documentElement.dataset.d3Lite = eff !== q ? "1" : "0";
}

export function writeDepthQuality(q: DepthQuality) {
  if (typeof window === "undefined") return;
  localStorage.setItem(DEPTH_QUALITY_KEY, q);
  applyDepthQuality(q);
}

/**
 * Pantau perubahan mode layar penuh supaya kualitas efektif ikut turun/naik
 * tanpa perlu muat ulang. Mengembalikan fungsi pembersih.
 */
export function startDepthQualityWatch(): () => void {
  if (typeof window === "undefined") return () => {};
  const sync = () => applyDepthQuality(readDepthQuality());
  sync();
  const mq = window.matchMedia?.("(display-mode: fullscreen)");
  document.addEventListener("fullscreenchange", sync);
  mq?.addEventListener?.("change", sync);
  window.addEventListener("app-fullscreen-change", sync);
  return () => {
    document.removeEventListener("fullscreenchange", sync);
    mq?.removeEventListener?.("change", sync);
    window.removeEventListener("app-fullscreen-change", sync);
  };
}
