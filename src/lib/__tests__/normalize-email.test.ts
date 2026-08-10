/**
 * Regresi: `normalizeEmail` adalah cermin `public.normalize_email()`.
 * Variasi huruf besar-kecil dan spasi HARUS menghasilkan nilai yang sama,
 * supaya validasi duplikat di klien konsisten dengan indeks unik di DB.
 */
import { describe, expect, it } from "vitest";
import { normalizeEmail } from "../address-book";

describe("normalizeEmail — konsistensi kapitalisasi & spasi", () => {
  const canonical = "budi@mail.com";
  for (const variant of [
    "budi@mail.com",
    "BUDI@MAIL.COM",
    "Budi@Mail.Com",
    "  budi@mail.com  ",
    "\tbudi@mail.com\n",
    "budi @mail.com",
    "budi@ mail .com",
    " B U D I @Mail.COM ",
  ]) {
    it(`menormalkan ${JSON.stringify(variant)} → ${canonical}`, () => {
      expect(normalizeEmail(variant)).toBe(canonical);
    });
  }

  it("gmail: titik & +tag dibuang, googlemail disamakan", () => {
    expect(normalizeEmail(" S.I.T.I+promo@GoogleMail.COM ")).toBe("siti@gmail.com");
    expect(normalizeEmail("siti@gmail.com")).toBe("siti@gmail.com");
  });

  it("non-gmail: titik dipertahankan", () => {
    expect(normalizeEmail(" Rina.K@MAIL.com ")).toBe("rina.k@mail.com");
    expect(normalizeEmail(" RINAK@Mail.COM ")).toBe("rinak@mail.com");
  });

  it("kosong / hanya spasi / null → null", () => {
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });

  it("email berbeda tidak pernah bertabrakan", () => {
    expect(normalizeEmail(" BuDi2@Mail.com ")).not.toBe(canonical);
  });
});
