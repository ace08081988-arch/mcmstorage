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
