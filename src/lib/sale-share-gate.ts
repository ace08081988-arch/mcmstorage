/**
 * SSOT untuk aturan "boleh kirim WA/Chat atau belum" di semua surface
 * penjualan (/tugas Siapkan Sendiri, /ecer Ready, ReadyPackagesPanel).
 *
 * Kontrak (jangan diubah tanpa memutakhirkan semua callsite tombol
 * share penjualan):
 *   • Kalau `sold_at` diberikan dan bernilai null → wajib "Catat
 *     penjualan dulu" (mengunci alur Jual → Kirim untuk Siapkan
 *     Sendiri). Kalau `sold_at` TIDAK diberikan (undefined), surface
 *     tersebut memang tidak memakai gate penjualan (mis. Ready ecer
 *     yang punya semantik "aktif" sendiri) — helper tetap pass-through.
 *   • `busy` (opsional) mengunci tombol saat kirim sedang berlangsung.
 *   • `extraReason` (opsional) memungkinkan surface memberi gate spesifik
 *     domain (mis. "Foto paket belum ada") tanpa harus fork helper.
 */
export type SaleShareState =
  | { enabled: true }
  | { enabled: false; reason: string };

export function saleShareGate(opts: {
  sold_at?: string | null | undefined;
  busy?: boolean;
  extraReason?: string | null;
}): SaleShareState {
  if (opts.busy) return { enabled: false, reason: "Sedang mengirim…" };
  if (opts.sold_at === null)
    return {
      enabled: false,
      reason: "Catat penjualan dulu (tombol Jual) sebelum mengirim ke pembeli.",
    };
  if (opts.extraReason) return { enabled: false, reason: opts.extraReason };
  return { enabled: true };
}