/**
 * Pemotongan teks pesan (caption WA, ringkasan riwayat, preview notifikasi)
 * yang TIDAK memotong di tengah kata.
 *
 * Aturan:
 *  1. Teks lebih pendek dari batas dikembalikan apa adanya.
 *  2. Potong di batas kata terakhir sebelum batas; tanda baca ekor dibuang.
 *  3. Kalau satu kata saja sudah melebihi batas (URL/kode tanpa spasi),
 *     barulah dipotong keras — jika tidak, hasilnya bisa string kosong.
 *  4. Selalu diakhiri elipsis "…" (dihitung di dalam `max`).
 */
export function truncateWords(input: string, max = 140): string {
  const text = (input ?? "").trim();
  if (max <= 1) return text ? "…" : "";
  if (text.length <= max) return text;

  const budget = max - 1; // sisakan ruang untuk "…"
  const slice = text.slice(0, budget);
  const lastBreak = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("\n"));

  // Ambang 40%: kalau batas kata terakhir terlalu awal, teksnya memang satu
  // token panjang → potong keras supaya hasil tetap informatif.
  const useWordBreak = lastBreak >= Math.floor(budget * 0.4);
  const cut = (useWordBreak ? slice.slice(0, lastBreak) : slice).replace(/[\s,.;:!?-]+$/u, "");
  return `${cut || slice}…`;
}

/** True bila teks akan terpotong pada batas `max`. */
export function willTruncate(input: string, max = 140): boolean {
  return (input ?? "").trim().length > max;
}
