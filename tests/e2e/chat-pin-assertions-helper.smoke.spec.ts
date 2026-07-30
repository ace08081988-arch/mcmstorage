import { test, expect } from "@playwright/test";
import {
  PHONE_ID_LIKE,
  PHONE_ID_TEL_URI,
  PHONE_ID_LIKE_ANY,
  containsRawIndoPhone,
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
      "PIN 0812-3456", // PIN 4-4 all-digit: hanya 6 digit lanjutan → bukan HP
      "Kontak",
      "Percakapan tidak ditemukan",
    ]) {
      expect(s).not.toMatch(PHONE_ID_LIKE);
      expect(containsRawIndoPhone(s), s).toBe(false);
    }
  });

  test("PHONE_ID_LIKE menangkap varian dengan separator ( -  . spasi )", () => {
    for (const s of [
      "0812-3456-7890",
      "0812 3456 7890",
      "0812.3456.7890",
      "+62 812-3456-7890",
      "+62-812-3456-7890",
      "62 812 3456 7890",
    ]) {
      expect(s, s).toMatch(PHONE_ID_LIKE);
      expect(containsRawIndoPhone(s), s).toBe(true);
    }
  });

  test("PHONE_ID_TEL_URI menangkap anchor tel: mentah", () => {
    for (const s of [
      "tel:081234567890",
      "tel:+6281234567890",
      "TEL: 081234567890",
    ]) {
      expect(s, s).toMatch(PHONE_ID_TEL_URI);
      expect(PHONE_ID_LIKE_ANY.test(s), s).toBe(true);
      expect(containsRawIndoPhone(s), s).toBe(true);
    }
  });

  test("containsRawIndoPhone menembus obfuscation zero-width / NBSP", () => {
    // Simulasi jaringan lambat: UI menyelipkan NBSP / zero-width
    // di tengah digit sehingga regex compact klasik miss, tapi user
    // tetap melihat nomor telp.
    const nbsp = "\u00A0";
    const zwsp = "\u200B";
    for (const s of [
      `0812${nbsp}3456${nbsp}7890`,
      `+62${zwsp}812${zwsp}3456${zwsp}7890`,
      `0${zwsp}8${zwsp}1${zwsp}2${zwsp}3${zwsp}4${zwsp}5${zwsp}6${zwsp}7${zwsp}8${zwsp}9`,
    ]) {
      expect(containsRawIndoPhone(s), s).toBe(true);
    }
    // Kontrol negatif: PIN dengan NBSP di dalamnya tidak boleh trigger.
    expect(
      containsRawIndoPhone(`PIN${nbsp}ABCD-1234`),
      "PIN dengan NBSP",
    ).toBe(false);
  });

  test("expectNoRawPhone menangkap varian separator & tel: & zero-width", () => {
    for (const s of [
      "hubungi 0812-3456-7890",
      "WA +62 812 3456 7890",
      "tel:081234567890",
      `0812\u200B3456\u200B7890`,
    ]) {
      expect(() => expectNoRawPhone(s, s), s).toThrow();
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
    const s = "Header: PIN ABCD-1234 · balasan dari PIN 0000-9999";
    expect(s).toMatch(PIN_ANY_TOKEN);
    expect(extractPinTokens(s)).toEqual(["PIN ABCD-1234", "PIN 0000-9999"]);
  });

  test("extractPinTokens — PIN ganda dalam satu baris", () => {
    // Dua PIN dipisah kata biasa dalam satu paragraf → dua token,
    // bukan satu blob yang menelan teks di antaranya.
    const s = "Kirim ke PIN ABCD-1234 dan PIN EFGH-5678 sekaligus.";
    expect(extractPinTokens(s)).toEqual([
      "PIN ABCD-1234",
      "PIN EFGH-5678",
    ]);
  });

  test("extractPinTokens — PIN ganda menempel tanpa spasi antar token", () => {
    // Regresi umum saat preview di layar sempit menyambung dua PIN.
    // Negative lookahead memutus token sebelum `PIN` berikutnya.
    const s = "PIN ABCD-1234PIN EFGH-5678";
    expect(extractPinTokens(s)).toEqual([
      "PIN ABCD-1234",
      "PIN EFGH-5678",
    ]);
  });

  test("extractPinTokens — PIN terpotong di akhir baris tetap ditangkap sebagai off-format", () => {
    // Word-wrap yang memecah PIN antar baris HARUS terlihat sebagai
    // pelanggaran, bukan disembunyikan. Token pertama sengaja off-
    // format supaya `expectPinFormat` bisa menandainya.
    const s = "Header PIN ABCD-\n1234 lanjut PIN EFGH-5678";
    const tokens = extractPinTokens(s);
    expect(tokens).toEqual(["PIN ABCD-", "PIN EFGH-5678"]);
    expect(tokens[0]).not.toMatch(PIN_MCM_FORMAT);
    expect(() => expectPinFormat(s, "wrapped")).toThrow();
  });

  test("extractPinTokens — punctuation trailing tidak ikut termakan", () => {
    // Titik/koma/tanda kurung di akhir kalimat tidak boleh mengubah
    // token valid menjadi off-format.
    for (const s of [
      "Silakan chat PIN ABCD-1234.",
      "Silakan chat PIN ABCD-1234,",
      "Silakan chat PIN ABCD-1234)",
      "Silakan chat PIN ABCD-1234!",
    ]) {
      expect(extractPinTokens(s), s).toEqual(["PIN ABCD-1234"]);
      expect(() => expectPinFormat(s, s)).not.toThrow();
    }
  });

  test("extractPinTokens — lowercase tetap diekstrak lalu ditolak PIN_MCM_FORMAT", () => {
    const s = "Diketik salah: PIN abcd-1234";
    expect(extractPinTokens(s)).toEqual(["PIN abcd-1234"]);
    expect(() => expectPinFormat(s, "lowercase")).toThrow();
  });

  test("extractPinTokens — kata mirip (SPIN, PINK, PINGGIR) tidak ikut match", () => {
    // Word-boundary di awal `\bPIN\s+` memastikan hanya kata `PIN`
    // yang berdiri sendiri (diikuti whitespace) yang jadi anchor token.
    for (const s of [
      "SPIN cepat",
      "warna PINK muda",
      "di PINGGIR jalan",
      "PINtu terbuka",
    ]) {
      expect(extractPinTokens(s), s).toEqual([]);
    }
  });

  test("extractPinTokens — multi-baris: satu PIN per baris tetap terpisah", () => {
    const s = "Baris 1: PIN ABCD-1234\nBaris 2: PIN EFGH-5678\nBaris 3: PIN IJKL-9012";
    expect(extractPinTokens(s)).toEqual([
      "PIN ABCD-1234",
      "PIN EFGH-5678",
      "PIN IJKL-9012",
    ]);
  });

  test("extractPinTokens — tanpa token PIN sama sekali menghasilkan array kosong", () => {
    for (const s of ["", "Kontak", "Halo dunia", "hubungi kami"]) {
      expect(extractPinTokens(s), s).toEqual([]);
    }
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
      expectPinBrandingClean("chat dengan 0812-3456-7890", "case"),
    ).toThrow();
    expect(() =>
      expectPinBrandingClean("chat dengan tel:+6281234567890", "case"),
    ).toThrow();
    expect(() =>
      expectPinBrandingClean("chat dengan PIN ABCD-1234", "case"),
    ).not.toThrow();
    expect(() =>
      expectPinBrandingClean("chat dengan PIN ABC-1234", "case"),
    ).toThrow();
  });
});
