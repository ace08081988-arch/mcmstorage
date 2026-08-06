/**
 * Regresi: dua kontak dengan NAMA SAMA tapi nomor/email berbeda harus SAH —
 * tombol Simpan tidak boleh diblokir (indeks unik nama di DB bersifat parsial).
 */
import { describe, expect, it } from "vitest";
import { findEditorDuplicate } from "../address-book-duplicate";
import type { AddressBookRow } from "../address-book.types";

const mk = (o: Partial<AddressBookRow> & { id: string; name: string }): AddressBookRow => ({
  user_id: "u1",
  phone: null,
  phone_norm: null,
  email: null,
  email_norm: null,
  source: "manual",
  device_contact_id: null,
  linked_user_id: null,
  note: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...o,
});

describe("findEditorDuplicate", () => {
  it("mengizinkan nama sama dengan nomor berbeda (kontak baru)", () => {
    const rows = [mk({ id: "a", name: "Budi", phone: "081234567890" })];
    expect(
      findEditorDuplicate({ rows, currentId: null, name: "Budi", phone: "089999888777", email: "" }),
    ).toBeNull();
  });

  it("mengizinkan nama sama dengan email berbeda", () => {
    const rows = [mk({ id: "a", name: "Budi", email: "budi@mail.com" })];
    expect(
      findEditorDuplicate({ rows, currentId: null, name: "budi ", phone: "", email: "budi2@mail.com" }),
    ).toBeNull();
  });

  it("mengizinkan edit kontak jadi nama sama selama nomor berbeda", () => {
    const rows = [
      mk({ id: "a", name: "Budi", phone: "081234567890" }),
      mk({ id: "b", name: "Budiman", phone: "081100002222" }),
    ];
    expect(
      findEditorDuplicate({ rows, currentId: "b", name: "Budi", phone: "081100002222", email: "" }),
    ).toBeNull();
  });

  it("tetap memblokir nomor sama walau formatnya beda", () => {
    const rows = [mk({ id: "a", name: "Budi", phone: "081234567890" })];
    const hit = findEditorDuplicate({
      rows,
      currentId: null,
      name: "Siti",
      phone: "+62 812-3456-7890",
      email: "",
    });
    expect(hit?.field).toBe("phone");
    expect(hit?.row.id).toBe("a");
  });

  it("tetap memblokir email sama (alias gmail)", () => {
    const rows = [mk({ id: "a", name: "Budi", email: "budi.k@gmail.com" })];
    expect(
      findEditorDuplicate({ rows, currentId: null, name: "Siti", phone: "", email: "BudiK+promo@googlemail.com" })
        ?.field,
    ).toBe("email");
  });

  it("memblokir nama sama hanya saat kedua kontak tanpa nomor & email", () => {
    const rows = [mk({ id: "a", name: "Budi" })];
    const hit = findEditorDuplicate({ rows, currentId: null, name: "BUDI", phone: "", email: "" });
    expect(hit?.field).toBe("name");
  });
});
