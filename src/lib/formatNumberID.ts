/**
 * Helper format angka id-ID (titik ribuan, koma desimal).
 * SSOT — jangan pakai `toLocaleString('id-ID')` langsung; import dari sini
 * supaya semua tempat konsisten dan mudah dites.
 */

const nfInt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

export function formatIntegerID(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return nfInt.format(Math.trunc(n));
}

/**
 * Format desimal id-ID.
 * @param maxDecimals maksimum digit desimal (default 2)
 * @param trimTrailingZeros kalau true, "1.500,50" jadi "1.500,5" dan "1.500,00" jadi "1.500". Default true untuk kuantitas, false untuk uang.
 */
export function formatDecimalID(
  n: number | null | undefined,
  maxDecimals: number = 2,
  trimTrailingZeros: boolean = true,
): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  const opts: Intl.NumberFormatOptions = {
    minimumFractionDigits: trimTrailingZeros ? 0 : maxDecimals,
    maximumFractionDigits: maxDecimals,
  };
  return new Intl.NumberFormat("id-ID", opts).format(n);
}

/**
 * Format uang Rupiah id-ID. Default 0 desimal, tapi terima override.
 */
export function formatRupiahID(
  n: number | null | undefined,
  maxDecimals: number = 0,
): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "Rp 0";
  return "Rp " + formatDecimalID(n, maxDecimals, maxDecimals === 0 ? false : true);
}

/**
 * Parse string id-ID ("1.500,50" atau "1500,5" atau "1500.5") jadi number.
 * Return null jika tidak valid / kosong.
 */
export function parseNumberID(s: string): number | null {
  if (s === null || s === undefined) return null;
  const trimmed = String(s).trim();
  if (trimmed === "") return null;
  // Hapus semua titik (thousand sep id-ID), ganti koma jadi titik desimal.
  // Kalau string juga mengandung titik desimal ala en-US (mis. "1500.5"),
  // heuristik: kalau ada koma → titik = thousand sep; kalau tidak ada koma
  // dan titik cuma satu → titik = desimal.
  let normalized: string;
  if (trimmed.includes(",")) {
    normalized = trimmed.replace(/\./g, "").replace(",", ".");
  } else {
    const dots = (trimmed.match(/\./g) || []).length;
    normalized = dots === 1 ? trimmed : trimmed.replace(/\./g, "");
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}