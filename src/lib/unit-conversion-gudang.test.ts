import { describe, it, expect } from "vitest";
import { fmtBase, fmtQtyDual, fmtItemQty } from "./stock-format";
import {
  parseWeightToGrams,
  formatGramsSmart,
  gramsToOns,
  onsToGrams,
} from "./weight-parse";

// Suite integrasi untuk memastikan konversi satuan (g, gram, ons) di halaman
// gudang KONSISTEN antara parser input, formatter tampilan, dan formatter stok
// item. Setiap kasus di sini pernah menjadi sumber mismatch label/perhitungan.

describe("Konversi satuan gudang — ons ↔ gram ↔ kg", () => {
  it("aturan aritmetika: 1 ons = 100 gram, 1 gram = 0,01 ons", () => {
    expect(onsToGrams(1)).toBe(100);
    expect(onsToGrams(2.5)).toBe(250);
    expect(gramsToOns(100)).toBe(1);
    expect(gramsToOns(1)).toBeCloseTo(0.01, 5);
    expect(gramsToOns(550)).toBeCloseTo(5.5, 5);
  });

  it("parser menerima g / gr / gram / ons / kg secara ekuivalen", () => {
    expect(parseWeightToGrams("1 ons")).toBe(100);
    expect(parseWeightToGrams("5 ons")).toBe(500);
    expect(parseWeightToGrams("500 g")).toBe(500);
    expect(parseWeightToGrams("500 gr")).toBe(500);
    expect(parseWeightToGrams("500 gram")).toBe(500);
    expect(parseWeightToGrams("0,5 kg")).toBe(500);
    // Semua di atas ekuivalen dengan 5 ons.
    expect(parseWeightToGrams("5 ons")).toBe(parseWeightToGrams("500 gram"));
  });

  it("formatGramsSmart default menampilkan ons untuk kelipatan 100", () => {
    expect(formatGramsSmart(100)).toBe("1 ons");
    expect(formatGramsSmart(500)).toBe("5 ons");
    expect(formatGramsSmart(900)).toBe("9 ons");
    // 250 bukan kelipatan 100 → tetap gr.
    expect(formatGramsSmart(250)).toBe("250 gr");
    // ≥1000 → kg.
    expect(formatGramsSmart(1000)).toBe("1 kg");
    expect(formatGramsSmart(2500)).toBe("2,5 kg");
  });

  it("fmtBase(g) memakai ons untuk kelipatan 100 di [100..900]", () => {
    expect(fmtBase(100, "g")).toBe("1 ons");
    expect(fmtBase(500, "g")).toBe("5 ons");
    expect(fmtBase(900, "g")).toBe("9 ons");
    expect(fmtBase(1000, "g")).toBe("1 kg");
    expect(fmtBase(1500, "g")).toBe("1,5 kg");
    expect(fmtBase(250, "g")).toBe("250 g");
    expect(fmtBase(0.5, "g")).toBe("500 mg");
  });

  it("pcs tidak terpengaruh aturan ons", () => {
    expect(fmtBase(100, "pcs")).toBe("100 pcs");
    expect(fmtBase(500, "pcs")).toBe("500 pcs");
  });
});

describe("Konversi satuan gudang — item berbasis gram", () => {
  it("item gram dengan package_type gram/kg TIDAK memunculkan dual label", () => {
    // Kasus yang pernah bug: package_type="gram" size=1000 base_unit="g".
    // Harus mendelegasikan ke fmtBase (tanpa "1 gram (= 1 kg)").
    const item = {
      name: "Pasir",
      base_unit: "g" as const,
      package_type: "gram",
      package_size: 1000,
    };
    expect(fmtItemQty(1000, item)).toBe("1 kg");
    expect(fmtItemQty(500, item)).toBe("5 ons");
    expect(fmtItemQty(250, item)).toBe("250 g");
  });

  it("fmtQtyDual mode base = mode package untuk item gram/gram", () => {
    const a = fmtQtyDual(500, "g", "gram", 1000, "base");
    const b = fmtQtyDual(500, "g", "gram", 1000, "package");
    expect(a).toBe(b);
    expect(a).toBe("5 ons");
  });

  it("item ons (package_size=100, base=g) tampil natural", () => {
    const item = {
      name: "Kristal A",
      base_unit: "g" as const,
      package_type: "ons",
      package_size: 100,
    };
    // 300 g = 3 ons — dual label tetap muncul untuk kemasan non-berat murni.
    // Format-nya "3 ons (= 3 ons)" akan redundan, tapi karena package_type="ons"
    // tidak masuk ke shortcut baseUnit=="g" && pt in {g,gr,gram,kg}, dual tetap.
    // Namun stok base akan diformat via fmtBase → "3 ons".
    const out = fmtItemQty(300, item);
    expect(out).toContain("3 ons");
  });

  it("roundtrip: parse('5 ons') → fmtBase = '5 ons'", () => {
    const g = parseWeightToGrams("5 ons")!;
    expect(g).toBe(500);
    expect(fmtBase(g, "g")).toBe("5 ons");
  });

  it("roundtrip: parse('1,5 kg') → fmtBase = '1,5 kg'", () => {
    const g = parseWeightToGrams("1,5 kg")!;
    expect(g).toBe(1500);
    expect(fmtBase(g, "g")).toBe("1,5 kg");
  });

  it("roundtrip: parse('250 gram') → fmtBase = '250 g'", () => {
    const g = parseWeightToGrams("250 gram")!;
    expect(g).toBe(250);
    expect(fmtBase(g, "g")).toBe("250 g");
  });
});