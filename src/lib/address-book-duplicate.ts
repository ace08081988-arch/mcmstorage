import { normalizePhone, normalizeEmail } from "./address-book";
import type { AddressBookRow } from "./address-book.types";

export type DuplicateHit = {
  row: AddressBookRow;
  field: "name" | "phone" | "email";
  label: string;
  value: string;
  reason: string;
};

export const normalizeContactName = (s: string) => s.trim().toLowerCase();

/**
 * Deteksi duplikat editor buku alamat — cermin indeks unik database.
 *
 * Indeks unik nama bersifat PARSIAL: hanya berlaku ketika phone_norm DAN
 * email_norm kosong. Jadi dua kontak dengan nama sama tapi nomor/email
 * berbeda itu SAH dan tombol Simpan harus tetap jalan.
 */
export function findEditorDuplicate(input: {
  rows: AddressBookRow[];
  currentId?: string | null;
  name: string;
  phone: string;
  email: string;
}): DuplicateHit | null {
  const others = input.rows.filter((r) => r.id !== input.currentId);
  const p = normalizePhone(input.phone);
  const e = normalizeEmail(input.email);
  const n = normalizeContactName(input.name);

  for (const r of others) {
    if (p && normalizePhone(r.phone) === p) {
      return {
        row: r,
        field: "phone",
        label: "Nomor telepon",
        value: input.phone.trim(),
        reason: `Nomor telepon ${input.phone.trim()} sudah dipakai kontak "${r.name}"`,
      };
    }
    if (e && normalizeEmail(r.email) === e) {
      return {
        row: r,
        field: "email",
        label: "Email",
        value: input.email.trim(),
        reason: `Email ${input.email.trim()} sudah dipakai kontak "${r.name}"`,
      };
    }
  }

  if (n && !p && !e) {
    const nameMatch = others.find(
      (r) =>
        normalizeContactName(r.name) === n &&
        !normalizePhone(r.phone) &&
        !normalizeEmail(r.email),
    );
    if (nameMatch)
      return {
        row: nameMatch,
        field: "name",
        label: "Nama",
        value: input.name.trim(),
        reason: `Nama "${nameMatch.name}" sudah ada di buku alamat`,
      };
  }
  return null;
}
