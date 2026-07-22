import { describe, it, expect } from "vitest";
import { displayFromCanonicalString } from "./NumericDraftInput";

/**
 * Kontrak: apa yang TAMPIL di NumericTextField harus SAMA PERSIS dengan
 * canonical string yang dipakai parent untuk hitung total.
 *
 * Sebelum perbaikan ini:
 *   ketik "0,10"  → display "0,10"  → canonical "0.1"
 *                                  ↓ blur / rehydrate
 *                    display "0,1"   ← inkonsisten (angka "hilang" 0)
 *
 * Sesudah:
 *   canonical mempertahankan digit desimal literal ("0.10"), dan
 *   `displayFromCanonicalString` memformat dengan
 *   `min = max = jumlah digit desimal canonical`, sehingga round-trip
 *   canonical → display identik dengan apa yang diketik.
 */
describe("NumericTextField · display ↔ canonical parity", () => {
  const D = (v: string, maxDecimals = 2) =>
    displayFromCanonicalString(v, true, maxDecimals);
  const I = (v: string) => displayFromCanonicalString(v, false, 0);

  it("trailing zero desimal DIPERTAHANKAN di display", () => {
    expect(D("0.10")).toBe("0,10");
    expect(D("1.50")).toBe("1,50");
    expect(D("1500.50")).toBe("1.500,50");
  });

  it("tanpa trailing zero: display sama persis pendeknya", () => {
    expect(D("0.1")).toBe("0,1");
    expect(D("1.5")).toBe("1,5");
    expect(D("1500.5")).toBe("1.500,5");
  });

  it("integer canonical → display tanpa koma", () => {
    expect(D("0")).toBe("0");
    expect(D("900000")).toBe("900.000");
    expect(D("15000000")).toBe("15.000.000");
  });

  it("mode integer (decimal=false): titik ribuan, tidak ada koma", () => {
    expect(I("900000")).toBe("900.000");
    expect(I("0")).toBe("0");
    // Nilai desimal dipotong (truncate, bukan round) di mode integer —
    // konsisten dengan `formatIntegerID` (Math.trunc).
    expect(I("1500.9")).toBe("1.500");
  });

  it("kosong / null / non-numerik → string kosong (bukan NaN atau '0')", () => {
    expect(D("")).toBe("");
    // @ts-expect-error — deliberate: guard state undefined dari form.
    expect(D(undefined)).toBe("");
    // @ts-expect-error — deliberate: guard state null dari form.
    expect(D(null)).toBe("");
    expect(D("abc")).toBe("");
  });

  it("maxDecimals membatasi digit desimal tanpa mengubah canonical yang lebih pendek", () => {
    // Canonical lebih pendek dari maxDecimals → apa adanya (tanpa dipadatkan).
    expect(displayFromCanonicalString("0.5", true, 4)).toBe("0,5");
    // Canonical melebihi maxDecimals → dipotong ke maxDecimals digit.
    expect(displayFromCanonicalString("0.123456", true, 2)).toBe("0,12");
  });
});

/**
 * Round-trip parity: nilai canonical yang dipakai untuk hitung total
 * (`Number(canonical) * priceNumber`) harus selalu setara dengan yang
 * terlihat user di kolom input. Tes ini mengunci kombinasi umum di form
 * jual (gram × harga/g) dan mencegah regresi 10× lipat.
 */
describe("NumericTextField · konsistensi canonical vs total", () => {
  it("subtotal dari canonical == subtotal yang dipersepsikan dari display", () => {
    const cases: Array<{ g: string; p: string; display: [string, string]; total: number }> = [
      { g: "0.9",  p: "900000", display: ["0,9",  "900.000"], total: 810_000 },
      { g: "0.10", p: "900000", display: ["0,10", "900.000"], total: 90_000 },
      { g: "1.50", p: "20000",  display: ["1,50", "20.000"],  total: 30_000 },
      { g: "2.5",  p: "40000",  display: ["2,5",  "40.000"],  total: 100_000 },
    ];
    for (const c of cases) {
      // Display cocok persis dengan tampilan yang diharapkan.
      expect(displayFromCanonicalString(c.g, true, 2)).toBe(c.display[0]);
      expect(displayFromCanonicalString(c.p, false, 0)).toBe(c.display[1]);
      // Nilai numerik canonical konsisten dengan total.
      expect(Number(c.g) * Number(c.p)).toBe(c.total);
    }
  });
});