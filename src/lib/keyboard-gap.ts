/**
 * SSOT klasifikasi selisih (gap) layout viewport vs visual viewport.
 *
 * Gap kecil (<=120px) hampir selalu berasal dari toolbar/address bar browser
 * Android yang muncul-hilang saat scroll — BUKAN soft-keyboard. Kalau gap itu
 * ikut diperlakukan sebagai keyboard, bilah bawah & composer "melompat" tiap
 * kali user menggulir.
 *
 * Semua kode yang butuh jawaban "apakah keyboard terbuka?" WAJIB memakai
 * helper di file ini supaya tidak ada dua ambang yang saling berlomba.
 */

/** Gap di atas nilai ini dianggap soft-keyboard. */
export const KEYBOARD_GAP_THRESHOLD_PX = 120;

/** Selisih mentah (px, >=0) antara layout viewport dan area terlihat. */
export function measureViewportGap(win: Window = window): number {
  const vv = win.visualViewport;
  if (!vv) return 0;
  const gap = win.innerHeight - vv.height - (vv.offsetTop || 0);
  return gap > 0 ? Math.round(gap) : 0;
}

/** true bila gap berasal dari keyboard, bukan toolbar browser. */
export function isKeyboardGap(gap: number): boolean {
  return gap > KEYBOARD_GAP_THRESHOLD_PX;
}

/** Inset keyboard terklasifikasi: 0 bila gap hanya toolbar browser. */
export function keyboardInsetFromGap(gap: number): number {
  return isKeyboardGap(gap) ? Math.round(gap) : 0;
}
