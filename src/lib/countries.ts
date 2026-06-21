/**
 * Daftar negara untuk pemilih kontak & format lokal.
 * `dial` = kode panggilan internasional tanpa tanda "+".
 * `trunk` = digit "trunk" lokal yang harus dibuang sebelum kode negara (mis. "0" untuk ID/MY).
 * `currency` & `locale` jadi default ketika negara dipilih.
 */
export type Country = {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  dial: string;
  trunk?: string;
  currency: string;
  locale: string;
  flag: string;
};

export const COUNTRIES: Country[] = [
  { code: "ID", name: "Indonesia",       dial: "62",  trunk: "0", currency: "IDR", locale: "id-ID", flag: "🇮🇩" },
  { code: "MY", name: "Malaysia",        dial: "60",  trunk: "0", currency: "MYR", locale: "ms-MY", flag: "🇲🇾" },
  { code: "SG", name: "Singapura",       dial: "65",              currency: "SGD", locale: "en-SG", flag: "🇸🇬" },
  { code: "BN", name: "Brunei",          dial: "673",             currency: "BND", locale: "ms-BN", flag: "🇧🇳" },
  { code: "TH", name: "Thailand",        dial: "66",  trunk: "0", currency: "THB", locale: "th-TH", flag: "🇹🇭" },
  { code: "VN", name: "Vietnam",         dial: "84",  trunk: "0", currency: "VND", locale: "vi-VN", flag: "🇻🇳" },
  { code: "PH", name: "Filipina",        dial: "63",  trunk: "0", currency: "PHP", locale: "en-PH", flag: "🇵🇭" },
  { code: "AU", name: "Australia",       dial: "61",  trunk: "0", currency: "AUD", locale: "en-AU", flag: "🇦🇺" },
  { code: "CN", name: "Tiongkok",        dial: "86",              currency: "CNY", locale: "zh-CN", flag: "🇨🇳" },
  { code: "HK", name: "Hong Kong",       dial: "852",             currency: "HKD", locale: "zh-HK", flag: "🇭🇰" },
  { code: "TW", name: "Taiwan",          dial: "886", trunk: "0", currency: "TWD", locale: "zh-TW", flag: "🇹🇼" },
  { code: "JP", name: "Jepang",          dial: "81",  trunk: "0", currency: "JPY", locale: "ja-JP", flag: "🇯🇵" },
  { code: "KR", name: "Korea Selatan",   dial: "82",  trunk: "0", currency: "KRW", locale: "ko-KR", flag: "🇰🇷" },
  { code: "IN", name: "India",           dial: "91",  trunk: "0", currency: "INR", locale: "en-IN", flag: "🇮🇳" },
  { code: "AE", name: "Uni Emirat Arab", dial: "971", trunk: "0", currency: "AED", locale: "ar-AE", flag: "🇦🇪" },
  { code: "SA", name: "Arab Saudi",      dial: "966", trunk: "0", currency: "SAR", locale: "ar-SA", flag: "🇸🇦" },
  { code: "GB", name: "Inggris (UK)",    dial: "44",  trunk: "0", currency: "GBP", locale: "en-GB", flag: "🇬🇧" },
  { code: "US", name: "Amerika Serikat", dial: "1",   trunk: "1", currency: "USD", locale: "en-US", flag: "🇺🇸" },
  { code: "CA", name: "Kanada",          dial: "1",   trunk: "1", currency: "CAD", locale: "en-CA", flag: "🇨🇦" },
  { code: "DE", name: "Jerman",          dial: "49",  trunk: "0", currency: "EUR", locale: "de-DE", flag: "🇩🇪" },
  { code: "FR", name: "Prancis",         dial: "33",  trunk: "0", currency: "EUR", locale: "fr-FR", flag: "🇫🇷" },
  { code: "NL", name: "Belanda",         dial: "31",  trunk: "0", currency: "EUR", locale: "nl-NL", flag: "🇳🇱" },
];

export const DEFAULT_COUNTRY: Country = COUNTRIES[0];

export function findCountry(code: string | null | undefined): Country {
  if (!code) return DEFAULT_COUNTRY;
  return COUNTRIES.find((c) => c.code === code.toUpperCase()) ?? DEFAULT_COUNTRY;
}

export const LANGUAGES = [
  { code: "id", name: "Bahasa Indonesia" },
  { code: "en", name: "English" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];

export const DATE_FORMATS = [
  { code: "DD/MM/YYYY",   sample: "31/12/2026" },
  { code: "MM/DD/YYYY",   sample: "12/31/2026" },
  { code: "YYYY-MM-DD",   sample: "2026-12-31" },
  { code: "DD MMM YYYY",  sample: "31 Des 2026" },
] as const;

export type DateFormatCode = (typeof DATE_FORMATS)[number]["code"];