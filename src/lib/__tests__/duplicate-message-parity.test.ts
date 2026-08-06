import { describe, it, expect } from "vitest";
import { findEditorDuplicate } from "../address-book-duplicate";
import { findPartyDuplicate } from "../party-duplicate";
import type { AddressBookRow } from "../address-book.types";

const mkRow = (o: Partial<AddressBookRow> & { id: string; name: string }): AddressBookRow => ({
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

const VARIANTS = ["Budi@Mail.com", "  budi@mail.com  ", "BUDI@MAIL.COM"];

describe("parity pesan duplikat email", () => {
  for (const email of VARIANTS) {
    it(`sama untuk varian "${email}"`, () => {
      const ab = findEditorDuplicate({
        rows: [mkRow({ id: "1", name: "Budi", email: "budi@mail.com" })],
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
