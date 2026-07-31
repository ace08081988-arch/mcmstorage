import { describe, it, expect, beforeEach } from "vitest";
import {
  computeBeliDerived,
  __resetBeliDerivedMemo,
  type BeliDerivedInput,
} from "@/lib/beli-derived";
import { computeBeliWarnings } from "@/lib/beli-warnings";

// ============================================================
// Selectivity: `computeBeliDerived` dan `computeBeliWarnings`
// hanya boleh menghasilkan output baru (referensi baru) saat
// field EFEKTIF berubah — tidak saat field pendukung berubah
// meski referensi input-nya baru.
//
// Field efektif per fungsi:
//   - derived : mode, selectedItem.{package_type,package_size,base_unit},
//               newPackageType, newPackageSize, packageQty,
//               pricePerPackage, priceMode, pricePerBase, inputKarton
//   - warnings: field derived di atas + selectedItem.{stock_base,
//               avg_cost_per_base}, priceMode, inputKarton
//
// Field pendukung yang TIDAK boleh memicu recompute:
//   selectedItem.{id, name, updated_at, supplier_last, image_url},
//   dan segala field ekstra di luar signature.
// ============================================================

type PT = "botol" | "gram" | "pcs";
type Item = {
  id: string;
  package_type: PT;
  package_size: number;
  base_unit: "g" | "pcs";
  stock_base: number;
  avg_cost_per_base: number;
  name?: string;
  updated_at?: string;
  supplier_last?: string | null;
  image_url?: string | null;
};

const BASE_ITEM: Item = {
  id: "botol-500",
  package_type: "botol",
  package_size: 500,
  base_unit: "g",
  stock_base: 10_000,
  avg_cost_per_base: 20,
  name: "Air 500",
  updated_at: "2026-01-01T00:00:00Z",
  supplier_last: null,
  image_url: null,
};

function inp(item: Item, over: Partial<BeliDerivedInput> = {}): BeliDerivedInput {
  return {
    mode: "existing",
    selectedItem: item,
    newPackageType: "botol",
    newPackageSize: "500",
    packageQty: "2",
    pricePerPackage: "10000",
    priceMode: "package",
    pricePerBase: "",
    inputKarton: false,
    ...over,
  };
}

beforeEach(() => {
  __resetBeliDerivedMemo();
});

describe("selectivity: field pendukung baru → output stabil (referensi sama)", () => {
  it("derived: 20 mutasi field pendukung (name/updated_at/supplier_last/image_url) → referensi hasil identik", () => {
    const first = computeBeliDerived(inp(BASE_ITEM));
    let item = BASE_ITEM;
    for (let i = 0; i < 20; i++) {
      item = {
        ...item,
        name: `Air 500 v${i}`,
        updated_at: `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`,
        supplier_last: i % 2 === 0 ? "PT A" : "PT B",
        image_url: `https://example.test/img-${i}.jpg`,
      };
      const next = computeBeliDerived(inp(item));
      expect(Object.is(next, first)).toBe(true);
    }
  });

  it("warnings: mutasi field pendukung (name/updated_at/image_url) → referensi hasil identik", () => {
    const d = computeBeliDerived(inp(BASE_ITEM));
    const first = computeBeliWarnings({
      mode: "existing",
      selectedItem: BASE_ITEM,
      derived: d,
      priceMode: "package",
      inputKarton: false,
    });

    let item = BASE_ITEM;
    for (let i = 0; i < 20; i++) {
      item = {
        ...item,
        name: `Air 500 v${i}`,
        updated_at: `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`,
        image_url: `https://example.test/img-${i}.jpg`,
        supplier_last: i % 2 === 0 ? "PT A" : "PT B",
      };
      const next = computeBeliWarnings({
        mode: "existing",
        selectedItem: item,
        derived: d,
        priceMode: "package",
        inputKarton: false,
      });
      expect(Object.is(next, first)).toBe(true);
    }
  });
});

describe("selectivity: field efektif berubah → output BEDA (referensi baru)", () => {
  it("derived: setiap perubahan field efektif menghasilkan referensi berbeda", () => {
    const base = computeBeliDerived(inp(BASE_ITEM));

    // Ubah packageQty
    const dQty = computeBeliDerived(inp(BASE_ITEM, { packageQty: "3" }));
    expect(Object.is(dQty, base)).toBe(false);
    expect(dQty.pkgQ).toBe(3);

    // Ubah pricePerPackage
    const dPrice = computeBeliDerived(inp(BASE_ITEM, { pricePerPackage: "20000" }));
    expect(Object.is(dPrice, base)).toBe(false);

    // Ubah inputKarton (efektif untuk botol)
    const dKarton = computeBeliDerived(inp(BASE_ITEM, { inputKarton: true }));
    expect(Object.is(dKarton, base)).toBe(false);
    expect(dKarton.kartonActive).toBe(true);

    // Ubah priceMode
    const dMode = computeBeliDerived(
      inp(BASE_ITEM, { priceMode: "base", pricePerBase: "25" }),
    );
    expect(Object.is(dMode, base)).toBe(false);

    // Ubah package_size pada item (efektif via selectedItem)
    const dSize = computeBeliDerived(
      inp({ ...BASE_ITEM, package_size: 750 }),
    );
    expect(Object.is(dSize, base)).toBe(false);
    expect(dSize.effectivePkgSize).toBe(750);

    // Ubah package_type pada item
    const dType = computeBeliDerived(
      inp({ ...BASE_ITEM, package_type: "gram", base_unit: "g" }),
    );
    expect(Object.is(dType, base)).toBe(false);
    expect(dType.effPackageType).toBe("gram");
  });

  it("warnings: perubahan avg_cost_per_base atau stock_base menghasilkan referensi berbeda", () => {
    const d = computeBeliDerived(inp(BASE_ITEM));
    const first = computeBeliWarnings({
      mode: "existing",
      selectedItem: BASE_ITEM,
      derived: d,
      priceMode: "package",
      inputKarton: false,
    });

    // Ubah avg_cost_per_base drastis → memicu PRICE_PER_BASE_*.
    const wAvg = computeBeliWarnings({
      mode: "existing",
      selectedItem: { ...BASE_ITEM, avg_cost_per_base: 5 },
      derived: d,
      priceMode: "package",
      inputKarton: false,
    });
    expect(Object.is(wAvg, first)).toBe(false);

    // Ubah stock_base menjadi 0 → BASE_ADDED_HUGE relatif ratio.
    const wStock = computeBeliWarnings({
      mode: "existing",
      selectedItem: { ...BASE_ITEM, stock_base: 0 },
      derived: d,
      priceMode: "package",
      inputKarton: false,
    });
    expect(Object.is(wStock, first)).toBe(false);
  });
});

describe("selectivity: interleave — pendukung stabil, efektif memicu recompute tepat sekali per perubahan", () => {
  it("derived: 5 mutasi pendukung diselingi 1 perubahan efektif → tepat 2 referensi unik total", () => {
    let item = BASE_ITEM;
    const seen = new Set<object>();
    seen.add(computeBeliDerived(inp(item)));

    // Fase A: 5 mutasi pendukung — set tidak boleh tumbuh.
    for (let i = 0; i < 5; i++) {
      item = { ...item, name: `n-${i}`, updated_at: `t-${i}` };
      seen.add(computeBeliDerived(inp(item)));
    }
    expect(seen.size).toBe(1);

    // Fase B: 1 perubahan efektif (packageQty) — set tumbuh 1.
    seen.add(computeBeliDerived(inp(item, { packageQty: "3" })));
    expect(seen.size).toBe(2);

    // Fase C: 5 mutasi pendukung lagi (dengan packageQty efektif tetap "3")
    // — set tidak boleh tumbuh.
    for (let i = 0; i < 5; i++) {
      item = { ...item, name: `n-B-${i}`, image_url: `img-${i}` };
      seen.add(computeBeliDerived(inp(item, { packageQty: "3" })));
    }
    expect(seen.size).toBe(2);
  });
});