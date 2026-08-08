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

export function applyDepthQuality(q: DepthQuality) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.d3Quality = q;
}

export function writeDepthQuality(q: DepthQuality) {
  if (typeof window === "undefined") return;
  localStorage.setItem(DEPTH_QUALITY_KEY, q);
  applyDepthQuality(q);
}
