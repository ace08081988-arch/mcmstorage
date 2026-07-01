import { describe, it, expect } from "vitest";
import { computeBeliDerived } from "./beli-derived";
import { computeBeliWarnings } from "./beli-warnings";

const gsBotol = {
  package_type: "botol",
  package_size: 100,
  base_unit: "g",
  stock_base: 500,
  avg_cost_per_base: 50, // 50 IDR / g
  name: "GS",
};

function run(overrides: Partial<Parameters<typeof computeBeliDerived>[0]> = {}) {
  const derived = computeBeliDerived({
    mode: "existing",
    selectedItem: gsBotol,
    newPackageType: "gram",
    newPackageSize: "999",
    packageQty: "10",
    pricePerPackage: String(50 * 100), // sesuai rata-rata: 5000/botol
    priceMode: "package",
    pricePerBase: "0",
    inputKarton: false,
    ...overrides,
  });
  return {
    derived,
    warnings: computeBeliWarnings({
      mode: overrides.mode ?? "existing",
      selectedItem: overrides.selectedItem ?? gsBotol,
      derived,
      priceMode: overrides.priceMode ?? "package",
      inputKarton: overrides.inputKarton ?? false,
    }),
  };
}

describe("computeBeliWarnings", () => {
  it("tidak mengeluh saat harga & qty sesuai rata-rata item", () => {
    const { warnings } = run();
    expect(warnings.filter((w) => w.level !== "error")).toEqual([]);
  });

  it("menandai qty=0 dan harga=0 sebagai error", () => {
    const { warnings } = run({ packageQty: "0", pricePerPackage: "0" });
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("QTY_ZERO");
    expect(codes).toContain("PRICE_ZERO");
  });

  it("menandai harga per base unit terlalu tinggi (>50% dari rata-rata)", () => {
    // 20_000/botol → 200/g vs avg 50/g → 4×
    const { warnings } = run({ pricePerPackage: "20000" });
    expect(warnings.some((w) => w.code === "PRICE_PER_BASE_HIGH")).toBe(true);
  });

  it("menandai harga per base unit terlalu rendah (<50% dari rata-rata)", () => {
    // 1000/botol → 10/g vs 50/g → -80%
    const { warnings } = run({ pricePerPackage: "1000" });
    expect(warnings.some((w) => w.code === "PRICE_PER_BASE_LOW")).toBe(true);
  });

  it("menandai tambahan stok yang sangat besar dibanding stok saat ini", () => {
    // stock 500 g, kalau beli 1000 botol × 100 g = 100_000 g > 500×100
    const { warnings } = run({ packageQty: "1000" });
    expect(warnings.some((w) => w.code === "BASE_ADDED_HUGE")).toBe(true);
  });

  it("menandai mode karton aktif tapi item bukan botol", () => {
    const gram = { ...gsBotol, package_type: "gram" };
    const { warnings } = run({ selectedItem: gram, inputKarton: true });
    // karton otomatis mati di derived (bukan botol), jadi warning muncul dari input
    // "inputKarton && effPackageType !== 'botol'"
    expect(warnings.some((w) => w.code === "KARTON_ON_NON_BOTOL")).toBe(true);
  });

  it("menandai harga per kemasan untuk item pcs", () => {
    const pcs = { ...gsBotol, package_type: "pcs", package_size: 1, base_unit: "pcs", avg_cost_per_base: 0 };
    const { warnings } = run({ selectedItem: pcs, priceMode: "package" });
    expect(warnings.some((w) => w.code === "PCS_PACKAGE_PRICE")).toBe(true);
  });

  it("mode 'new' tidak memeriksa konsistensi terhadap item terpilih", () => {
    const { warnings } = run({
      mode: "new",
      selectedItem: null,
      newPackageType: "gram",
      newPackageSize: "250",
      packageQty: "2",
      pricePerPackage: "3000",
    });
    expect(warnings.filter((w) => w.level !== "error")).toEqual([]);
  });

  it("tidak menandai deviasi harga bila item belum punya avg_cost_per_base", () => {
    const fresh = { ...gsBotol, avg_cost_per_base: 0 };
    const { warnings } = run({ selectedItem: fresh, pricePerPackage: "999999" });
    expect(warnings.some((w) => w.code === "PRICE_PER_BASE_HIGH")).toBe(false);
    expect(warnings.some((w) => w.code === "PRICE_PER_BASE_LOW")).toBe(false);
  });
});