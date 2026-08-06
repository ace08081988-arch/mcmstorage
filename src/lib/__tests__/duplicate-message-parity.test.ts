import { describe, it, expect } from "vitest";
import { findAddressBookDuplicate } from "../address-book-duplicate";
import { findPartyDuplicate } from "../party-duplicate";

const VARIANTS = ["Budi@Mail.com", "  budi@mail.com  ", "BUDI@MAIL.COM"];

describe("parity pesan duplikat email", () => {
  for (const email of VARIANTS) {
    it(`sama untuk varian "${email}"`, () => {
      const ab = findAddressBookDuplicate({
        rows: [{ id: "1", name: "Budi", phone: "", email: "budi@mail.com" }],
        name: "Budi Baru",
        phone: "",
        email,
      });
      const party = findPartyDuplicate({
        rows: [{ id: "1", name: "Budi", contact: "", email: "budi@mail.com" }],
        name: "Budi Baru",
        contact: "",
        email,
      });
      expect(ab?.field).toBe("email");
      expect(party?.field).toBe("email");
      expect(party?.reason).toBe(ab?.reason);
      expect(ab?.reason).toBe(`Email ${email.trim()} sudah dipakai kontak "Budi"`);
    });
  }
});
