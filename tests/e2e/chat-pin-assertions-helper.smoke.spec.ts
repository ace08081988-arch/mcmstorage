import { test, expect } from "@playwright/test";
import {
  PHONE_ID_LIKE,
  PIN_MCM_FORMAT,
  PIN_ANY_TOKEN,
  extractPinTokens,
  expectNoRawPhone,
  expectPinFormat,
  expectPinBrandingClean,
} from "./_helpers/chat-pin-assertions";

/**
 * Smoke test murni untuk helper `chat-pin-assertions.ts`. Tidak butuh
 * browser/preview — dijalankan cepat untuk mencegah regresi kontrak
 * regex yang dipakai seluruh suite `chat-pin-mcm-*`.
 */

test.describe("chat-pin-assertions — kontrak regex", () => {
  test("PHONE_ID_LIKE menangkap format HP Indonesia mentah", () => {
    for (const s of [
      "081234567890",
      "+6281234567890",
      "6281234567890",
      "Halo 0812-3456-7890", // strip terlebih dulu di caller kalau perlu;
      // tanpa strip, "0812" saja tak lulus (butuh 08 + >=7 digit), tapi
      // "081234567890" pasti lulus.
    ]) {
      expect(s).toMatch(PHONE_ID_LIKE);
    }
  });

  test("PHONE_ID_LIKE tidak false-positive terhadap PIN xxxx-xxxx", () => {
    for (const s of [
      "PIN ABCD-1234",
      "PIN 0812-XXXX", // bukan HP karena diikuti non-digit setelah 0812
      "Kontak",
      "Percakapan tidak ditemukan",
    ]) {
      expect(s).not.toMatch(PHONE_ID_LIKE);
    }
  });

  test("PIN_MCM_FORMAT hanya menerima 4-4 alfanumerik uppercase", () => {
    expect("PIN ABCD-1234").toMatch(PIN_MCM_FORMAT);
    expect("PIN 0000-9999").toMatch(PIN_MCM_FORMAT);
    expect("PIN abcd-1234").not.toMatch(PIN_MCM_FORMAT);
    expect("PIN ABC-1234").not.toMatch(PIN_MCM_FORMAT);
    expect("PIN ABCD1234").not.toMatch(PIN_MCM_FORMAT);
  });

  test("PIN_ANY_TOKEN & extractPinTokens", () => {
    const s = "Header: PIN ABCD-1234 · balasan dari PIN 0000-9999.";
    expect(s).toMatch(PIN_ANY_TOKEN);
    expect(extractPinTokens(s)).toEqual(["PIN", "PIN"].map((_, i) => ["PIN ABCD-1234", "PIN 0000-9999."][i]));
  });

  test("expectNoRawPhone melempar untuk phone mentah, lolos untuk PIN", () => {
    expect(() => expectNoRawPhone("hubungi 081234567890", "case")).toThrow();
    expect(() => expectNoRawPhone("hubungi PIN ABCD-1234", "case")).not.toThrow();
  });

  test("expectPinFormat lolos saat tidak ada token PIN sama sekali", () => {
    expect(() => expectPinFormat("Kontak", "case")).not.toThrow();
    expect(() => expectPinFormat("Percakapan pribadi", "case")).not.toThrow();
  });

  test("expectPinFormat melempar saat token PIN tidak sesuai xxxx-xxxx", () => {
    expect(() => expectPinFormat("PIN ABC-1234", "case")).toThrow();
    expect(() => expectPinFormat("PIN ABCD1234", "case")).toThrow();
    expect(() => expectPinFormat("PIN ABCD-1234", "case")).not.toThrow();
  });

  test("expectPinBrandingClean gabungan: phone gagal, PIN valid lolos", () => {
    expect(() =>
      expectPinBrandingClean("chat dengan 081234567890", "case"),
    ).toThrow();
    expect(() =>
      expectPinBrandingClean("chat dengan PIN ABCD-1234", "case"),
    ).not.toThrow();
    expect(() =>
      expectPinBrandingClean("chat dengan PIN ABC-1234", "case"),
    ).toThrow();
  });
});
