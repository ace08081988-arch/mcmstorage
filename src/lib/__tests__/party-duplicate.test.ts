import { describe, it, expect } from "vitest";
import { findPartyDuplicate } from "../party-duplicate";

const rows = [
  { id: "1", name: "Budi", contact: "0812-3456-7890", email: null },
  { id: "2", name: "Siti", contact: null, email: "siti@gmail.com" },
  { id: "3", name: "Andi", contact: null, email: null },
];

describe("findPartyDuplicate — normalisasi nomor sebelum validasi", () => {
  for (const variant of [
    "+62 812 3456 7890",
    "62812 3456 7890",
    "0062-812-3456-7890",
    "(0812) 34567890",
    "81234567890",
    "0812 3456 7890",
  ]) {
    it(`menangkap duplikat untuk format "${variant}"`, () => {
      const hit = findPartyDuplicate({ rows, name: "Nama Lain", contact: variant });
      expect(hit?.field).toBe("contact");
      expect(hit?.row.id).toBe("1");
    });
  }

  it("nomor berbeda tetap lolos", () => {
    expect(findPartyDuplicate({ rows, name: "Budi", contact: "+62 813 0000 1111" })).toBeNull();
  });

  it("nama sama dengan nomor berbeda tetap boleh disimpan", () => {
    expect(findPartyDuplicate({ rows, name: "Budi", contact: "08999998888" })).toBeNull();
  });

  it("nama sama tanpa nomor & email diblokir", () => {
    expect(findPartyDuplicate({ rows, name: "  andi  " })?.field).toBe("name");
  });

  it("email varian gmail dengan titik/+tag tertangkap", () => {
    expect(findPartyDuplicate({ rows, name: "X", email: "S.I.T.I+promo@googlemail.com" })?.row.id).toBe("2");
  });

  it("mengabaikan baris yang sedang diedit", () => {
    expect(findPartyDuplicate({ rows, currentId: "1", name: "Budi", contact: "+6281234567890" })).toBeNull();
  });
});

/**
 * Regresi: email HARUS dinormalisasi (trim + lowercase + buang spasi) sebelum
 * dibandingkan, supaya "  SITI@Gmail.com " tidak lolos sebagai kontak baru
 * padahal database menolaknya lewat indeks unik `email_norm`.
 */
describe("findPartyDuplicate — email besar-kecil & spasi", () => {
  for (const variant of [
    "SITI@GMAIL.COM",
    "Siti@Gmail.Com",
    "  siti@gmail.com  ",
    "\tsiti@gmail.com\n",
    "siti @gmail.com",
    "siti@ gmail .com",
    " S I T I @gmail.com ",
    "  SITI@GoogleMail.COM  ",
    " s.i.t.i @ Gmail.com ",
  ]) {
    it(`menangkap duplikat email untuk varian ${JSON.stringify(variant)}`, () => {
      const hit = findPartyDuplicate({ rows, name: "Nama Lain", email: variant });
      expect(hit?.field).toBe("email");
      expect(hit?.row.id).toBe("2");
    });
  }

  it("email berbeda dengan kapitalisasi acak tetap lolos", () => {
    expect(findPartyDuplicate({ rows, name: "X", email: "  SiTi2@Gmail.com " })).toBeNull();
  });

  it("domain non-gmail tidak dianggap sama walau lokal-part mirip", () => {
    const local = [{ id: "9", name: "Rina", contact: null, email: "rina.k@mail.com" }];
    // Titik TIDAK dibuang untuk domain non-gmail → bukan duplikat.
    expect(findPartyDuplicate({ rows: local, name: "X", email: " RINAK@Mail.COM " })).toBeNull();
    // Sama persis (beda kapitalisasi/spasi) → tetap duplikat.
    expect(findPartyDuplicate({ rows: local, name: "X", email: " Rina.K@MAIL.com " })?.row.id).toBe("9");
  });

  it("email yang isinya hanya spasi tidak memicu duplikat", () => {
    expect(findPartyDuplicate({ rows, name: "Nama Baru", email: "   " })).toBeNull();
  });

  it("baris tersimpan yang menyimpan email berspasi/huruf besar tetap tertangkap", () => {
    const messy = [{ id: "7", name: "Dewi", contact: null, email: "  DEWI @Gmail.COM " }];
    expect(findPartyDuplicate({ rows: messy, name: "X", email: "dewi@gmail.com" })?.row.id).toBe("7");
  });
});
