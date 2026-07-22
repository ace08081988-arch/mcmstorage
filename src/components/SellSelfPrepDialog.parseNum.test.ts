import { describe, it, expect } from "vitest";
import { parseNum } from "./SellSelfPrepDialog";

/**
 * Regresi bug "Subtotal 10× lipat" (screenshot 21-Jul-2026):
 *   Gram 0,9 × Harga/g 900.000  → dulu terbaca 9 × 900.000 = 8.100.000
 *   karena parser lama membuang titik sebagai pemisah ribuan id-ID
 *   padahal `NumericTextField` sudah mengeluarkan canonical string
 *   ("0.9") dengan titik sebagai pemisah DESIMAL.
 *
 * Kontrak `parseNum`:
 *   - Canonical (dari NumericTextField): titik = desimal, tanpa ribuan.
 *   - Fallback (sumber lama / paste manual dari UI id-ID):
 *     titik = ribuan, koma = desimal (via parsePaymentAmountInput).
 *   - String kosong / null / non-numerik → 0 (jangan NaN, biar subtotal
 *     tidak "meledak" saat field belum diisi).
 */
describe("SellSelfPrepDialog · parseNum (canonical dari NumericTextField)", () => {
  it("baca desimal canonical apa adanya (bug 10× lipat tidak boleh kembali)", () => {
    expect(parseNum("0.9")).toBe(0.9);
    expect(parseNum("1.5")).toBe(1.5);
    expect(parseNum("0.001")).toBe(0.001);
    expect(parseNum("12.345")).toBe(12.345);
  });

  it("baca integer polos (harga per gram, jumlah bayar)", () => {
    expect(parseNum("0")).toBe(0);
    expect(parseNum("1")).toBe(1);
    expect(parseNum("900000")).toBe(900_000);
    expect(parseNum("15000000")).toBe(15_000_000);
  });

  it("baca desimal negatif & angka besar tanpa kehilangan presisi wajar", () => {
    expect(parseNum("1234567.89")).toBeCloseTo(1_234_567.89, 6);
    // Nilai negatif tidak digunakan di UI, tapi kontrak Number() tetap konsisten.
    expect(parseNum("-2.5")).toBe(-2.5);
  });

  it("kosong / null / whitespace → 0 (bukan NaN)", () => {
    expect(parseNum("")).toBe(0);
    // @ts-expect-error — deliberate: guard untuk state undefined dari form.
    expect(parseNum(undefined)).toBe(0);
    // @ts-expect-error — deliberate: guard untuk state null dari form.
    expect(parseNum(null)).toBe(0);
  });
});

describe("SellSelfPrepDialog · parseNum (fallback display id-ID)", () => {
  it("fallback: koma sebagai desimal (paste dari UI id-ID)", () => {
    // Number("1,5") → NaN → jatuh ke parsePaymentAmountInput → 1.5
    expect(parseNum("1,5")).toBe(1.5);
    expect(parseNum("0,9")).toBe(0.9);
  });

  it("fallback: titik sebagai ribuan bila kombinasi TIDAK valid Number()", () => {
    // "10.000,50" — Number() gagal, parser id-ID → 10_000.5
    expect(parseNum("10.000,50")).toBe(10_000.5);
    // "Rp 900.000" — Number() gagal → 900_000
    expect(parseNum("Rp 900.000")).toBe(900_000);
  });

  it("input non-numerik total → 0 (subtotal tidak meledak)", () => {
    expect(parseNum("abc")).toBe(0);
    expect(parseNum("--")).toBe(0);
  });
});

/**
 * Skenario end-to-end konsistensi subtotal:
 *   subtotal(baris) = parseNum(gramsStr) × parseNum(priceStr)
 *   total(dialog)   = Σ subtotal
 * Test ini mengunci hasil dari bug 10× lipat serta beberapa
 * kombinasi umum lain (gram bulat, harga kecil, banyak baris).
 */
describe("SellSelfPrepDialog · konsistensi subtotal & total", () => {
  const subtotal = (gramsStr: string, priceStr: string) =>
    parseNum(gramsStr) * parseNum(priceStr);

  it("bug 21-Jul-2026: 0,9 × 900.000 = 810.000 (BUKAN 8.100.000)", () => {
    // Canonical dari NumericTextField.
    expect(subtotal("0.9", "900000")).toBe(810_000);
  });

  it("kombinasi umum lain tetap benar", () => {
    expect(subtotal("1", "10000")).toBe(10_000);
    expect(subtotal("2.5", "20000")).toBe(50_000);
    expect(subtotal("0.05", "1500000")).toBe(75_000);
    // Kosong × harga → 0
    expect(subtotal("", "900000")).toBe(0);
    // Gram × kosong → 0
    expect(subtotal("0.9", "")).toBe(0);
  });

  it("total multi-baris = penjumlahan subtotal (tanpa pembulatan liar)", () => {
    const lines = [
      { g: "0.9", p: "900000" }, // 810_000
      { g: "1.5", p: "20000" }, //  30_000
      { g: "0.25", p: "40000" }, //  10_000
    ];
    const total = lines.reduce((s, l) => s + subtotal(l.g, l.p), 0);
    expect(total).toBe(850_000);
  });

  it("fallback id-ID untuk gram & harga tetap konsisten dengan canonical", () => {
    // Nilai yang sama, ditulis dua cara berbeda, harus menghasilkan subtotal identik.
    expect(subtotal("0,9", "900.000")).toBe(subtotal("0.9", "900000"));
  });
});