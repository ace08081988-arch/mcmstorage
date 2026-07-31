/**
 * Helper murni untuk menghitung `objectFit` / `objectPosition` yang dipakai
 * SEMUA elemen `<video>` di CallScreen (remote besar + preview lokal, baik
 * dalam mode PiP maupun swap). Menyatukan logika ini di satu tempat menjamin
 * bahwa kedua video pasti tersinkron — tidak ada jalur render yang menerima
 * style berbeda karena kelalaian refactor.
 *
 * Semua fungsi di sini bebas efek samping dan bebas dependency React, jadi
 * bisa di-test langsung tanpa DOM.
 */
export type VideoFit = "cover" | "contain";
export type VideoPosPreset = "center" | "top" | "bottom" | "left" | "right";
export type VideoPosXY = { x: number; y: number };

/**
 * Ubah preset arah menjadi string CSS `object-position` (mis. "50% 0%").
 */
export function presetPosToCss(pos: VideoPosPreset): string {
  switch (pos) {
    case "center": return "50% 50%";
    case "top": return "50% 0%";
    case "bottom": return "50% 100%";
    case "left": return "0% 50%";
    case "right": return "100% 50%";
  }
}

/**
 * Gabungkan preset + posisi custom (hasil drag) jadi string CSS. Custom
 * mengalahkan preset saat non-null, dibulatkan ke 1 desimal untuk stabil.
 */
export function combineVideoPos(
  preset: VideoPosPreset,
  custom: VideoPosXY | null,
): string {
  if (custom) return `${custom.x.toFixed(1)}% ${custom.y.toFixed(1)}%`;
  return presetPosToCss(preset);
}

/**
 * Style inline yang WAJIB dipakai identik oleh SEMUA `<video>` (remote +
 * preview lokal). `objectPosition` hanya berlaku saat mode `cover` — di mode
 * `contain`, browser mengabaikan geser, jadi kita kunci ke "50% 50%" supaya
 * reset otomatis.
 */
export function computeVideoStyle(
  fit: VideoFit,
  posPreset: VideoPosPreset,
  posCustom: VideoPosXY | null,
): { objectFit: VideoFit; objectPosition: string } {
  return {
    objectFit: fit,
    objectPosition: fit === "cover" ? combineVideoPos(posPreset, posCustom) : "50% 50%",
  };
}

/**
 * Kelas Tailwind untuk `object-fit` — dipasang bersamaan dengan style
 * inline supaya kedua sumber informasi konsisten (some browsers/paths
 * membaca dari className kalau inline gagal terapkan).
 */
export function videoFitClassFor(fit: VideoFit): "object-cover" | "object-contain" {
  return fit === "cover" ? "object-cover" : "object-contain";
}