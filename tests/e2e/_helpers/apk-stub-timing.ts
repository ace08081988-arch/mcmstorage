/**
 * Threshold timing terpusat untuk `assertNoAdditionalRequests` di spec
 * E2E APK/copy-chat. Semua spec WAJIB mengimpor konstanta ini alih-alih
 * menuliskan angka literal — jadi kalau CI perlu di-tune (mis. runner
 * lebih lambat), cukup ubah satu file.
 *
 * Dua tier:
 *
 *   - {@link APK_STUB_PER_ACTION_WINDOW_MS} — untuk wrapper aksi
 *     (`assertNoAdditionalRequests(action, { windowMs: ... })`). Trailing
 *     window per-klik: cukup pendek karena aksi sinkron, tapi tetap
 *     cukup untuk menangkap refetch invalidate satu tick.
 *
 *   - {@link APK_STUB_TERMINAL_WINDOW_MS} — untuk terminal guard di
 *     akhir spec (`assertNoAdditionalRequests({ windowMs: ... })`).
 *     Sedikit lebih longgar: memberi ruang untuk background timer /
 *     refetch-on-focus yang mungkin baru tiba beberapa ratus ms
 *     setelah aksi terakhir.
 *
 * Angka default dipilih agar sama dengan mayoritas nilai sebelumnya
 * (500ms / 750ms) — perubahan minimal secara semantik.
 */
export const APK_STUB_PER_ACTION_WINDOW_MS = 500;
export const APK_STUB_TERMINAL_WINDOW_MS = 750;