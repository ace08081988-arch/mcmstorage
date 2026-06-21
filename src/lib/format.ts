import { findCountry, type DateFormatCode } from "@/lib/countries";
import type { MyProfile } from "@/lib/profile";

/** Format angka sebagai mata uang sesuai pengaturan profil. */
export function formatCurrency(
  amount: number | null | undefined,
  profile?: Pick<MyProfile, "currency" | "country_code"> | null,
): string {
  if (amount == null || !Number.isFinite(amount)) return "";
  const country = findCountry(profile?.country_code);
  const currency = profile?.currency || country.currency;
  try {
    return new Intl.NumberFormat(country.locale, {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "IDR" || currency === "JPY" || currency === "KRW" || currency === "VND" ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

const MONTH_ID = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
const MONTH_EN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** Format tanggal sesuai pengaturan profil. Input boleh `Date | string | number`. */
export function formatDate(
  value: Date | string | number | null | undefined,
  profile?: Pick<MyProfile, "date_format" | "language"> | null,
): string {
  if (value == null || value === "") return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  const months = profile?.language === "en" ? MONTH_EN : MONTH_ID;
  const mon = months[d.getMonth()];
  const fmt: DateFormatCode = (profile?.date_format as DateFormatCode) || "DD/MM/YYYY";
  switch (fmt) {
    case "MM/DD/YYYY":  return `${mm}/${dd}/${yyyy}`;
    case "YYYY-MM-DD":  return `${yyyy}-${mm}-${dd}`;
    case "DD MMM YYYY": return `${dd} ${mon} ${yyyy}`;
    case "DD/MM/YYYY":
    default:            return `${dd}/${mm}/${yyyy}`;
  }
}