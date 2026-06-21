/**
 * Normalisasi nomor telepon/WhatsApp ke format internasional siap-pakai untuk
 * tautan `wa.me/<digits>`. Tidak menyertakan tanda `+`.
 *
 * Aturan:
 * - Buang semua karakter non-digit (spasi, "-", "(", ")", titik, dst).
 * - Konversi prefix internasional "00" → "" (cth: 0062812… → 62812…).
 * - Nomor diawali "0" (lokal Indonesia) → ganti dengan "62".
 * - Nomor diawali "8" (umum di Indonesia, tanpa prefix) → tambahkan "62".
 * - Selain itu, biarkan apa adanya (asumsi sudah berkode negara).
 *
 * Return null bila kosong atau bukan nomor valid (kurang dari 8 digit / lebih dari 15).
 */
export function normalizeWaNumber(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = String(input).replace(/\D+/g, "");
  if (!digits) return null;

  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = "62" + digits.slice(1);
  else if (digits.startsWith("8")) digits = "62" + digits;

  // E.164: 8–15 digit (tanpa "+").
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/** Format tampilan ramah-mata: "+62 812-3456-7890" untuk nomor ID, fallback "+<digits>". */
export function formatWaDisplay(digits: string | null | undefined): string {
  const n = normalizeWaNumber(digits ?? "");
  if (!n) return "";
  if (n.startsWith("62")) {
    const rest = n.slice(2);
    // Pisahkan setiap 4 digit, awali tiap blok dengan "-" kecuali blok pertama.
    const parts = rest.match(/.{1,4}/g) ?? [rest];
    return `+62 ${parts.join("-")}`;
  }
  return `+${n}`;
}