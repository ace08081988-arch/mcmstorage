import { normalizePhone, normalizeEmail } from "./address-book";

/**
 * Deteksi duplikat pelanggan / supplier.
 *
 * Nomor telepon SELALU dinormalisasi dulu (lewat `normalizePhone`, cermin dari
 * `public.normalize_phone()`), sehingga semua varian penulisan yang merujuk ke
 * nomor yang sama tertangkap sebagai duplikat:
 *
 *   0812-3456-7890 · +62 812 3456 7890 · 62 812 3456 7890 ·
 *   0062 812 3456 7890 · (0812) 34567890 · 81234567890
 *
 * Aturan:
 *  - Nomor sama  → duplikat, walau namanya berbeda.
 *  - Email sama  → duplikat.
 *  - Nama sama   → duplikat HANYA bila kedua sisi tidak punya nomor/email.
 *    Dua orang bernama sama dengan nomor berbeda itu sah.
 */
export type PartyLike = {
  id: string;
  name: string;
  contact?: string | null;
  email?: string | null;
};

export type PartyDuplicateHit = {
  row: PartyLike;
  field: "contact" | "email" | "name";
  label: string;
  reason: string;
};

export const normalizePartyName = (s: string | null | undefined) =>
  (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export function findPartyDuplicate(input: {
  rows: PartyLike[];
  currentId?: string | null;
  name: string;
  contact?: string | null;
  email?: string | null;
}): PartyDuplicateHit | null {
  const others = input.rows.filter((r) => r.id !== input.currentId);
  const phone = normalizePhone(input.contact ?? "");
  const email = normalizeEmail(input.email ?? "");
  const name = normalizePartyName(input.name);

  for (const r of others) {
    if (phone && normalizePhone(r.contact ?? "") === phone) {
      return {
        row: r,
        field: "contact",
        label: "Nomor kontak",
        reason: `Nomor ${(input.contact ?? "").trim()} sudah dipakai "${r.name}"`,
      };
    }
    if (email && normalizeEmail(r.email ?? "") === email) {
      return {
        row: r,
        field: "email",
        label: "Email",
        reason: `Email ${(input.email ?? "").trim()} sudah dipakai kontak "${r.name}"`,
      };
    }
  }

  if (name && !phone && !email) {
    const hit = others.find(
      (r) =>
        normalizePartyName(r.name) === name &&
        !normalizePhone(r.contact ?? "") &&
        !normalizeEmail(r.email ?? ""),
    );
    if (hit)
      return {
        row: hit,
        field: "name",
        label: "Nama",
        reason: `"${hit.name}" sudah terdaftar tanpa nomor kontak`,
      };
  }
  return null;
}
