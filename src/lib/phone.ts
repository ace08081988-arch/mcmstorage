import { findCountry, DEFAULT_COUNTRY, type Country } from "@/lib/countries";

/**
 * Normalisasi nomor telepon/WhatsApp ke format internasional siap-pakai untuk
 * tautan `wa.me/<digits>`. Tidak menyertakan tanda `+`.
 *
 * Aturan (memperhatikan negara yang dipilih):
 * - Buang semua karakter non-digit.
 * - Buang prefix "00" (kode akses internasional).
 * - Bila diawali kode negara `dial` → biarkan.
 * - Bila diawali digit "trunk" lokal negara → ganti dengan `dial`.
 * - Bila tidak ada keduanya → tambahkan `dial` di depan.
 *
 * Return `null` bila hasil <8 atau >15 digit (E.164).
 */
export function normalizeWaNumber(
  input: string | null | undefined,
  countryCode?: string | null,
): string | null {
  if (!input) return null;
  let digits = String(input).replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);

  const country: Country = findCountry(countryCode ?? DEFAULT_COUNTRY.code);
  const dial = country.dial;

  if (digits.startsWith(dial)) {
    // sudah pakai kode negara
  } else if (country.trunk && digits.startsWith(country.trunk)) {
    digits = dial + digits.slice(country.trunk.length);
  } else {
    digits = dial + digits;
  }

  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/** Format tampilan ramah-mata: "+62 812-3456-7890". */
export function formatWaDisplay(
  digits: string | null | undefined,
  countryCode?: string | null,
): string {
  const n = normalizeWaNumber(digits ?? "", countryCode);
  if (!n) return "";
  const country = findCountry(countryCode);
  if (n.startsWith(country.dial)) {
    const rest = n.slice(country.dial.length);
    const parts = rest.match(/.{1,4}/g) ?? [rest];
    return `+${country.dial} ${parts.join("-")}`;
  }
  return `+${n}`;
}