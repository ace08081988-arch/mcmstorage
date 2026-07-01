import { describe, it, expect, beforeEach } from "vitest";
import {
  computeBeliDerived,
  __resetBeliDerivedMemo,
  type BeliDerivedInput,
} from "./beli-derived";
import {
  computeBeliWarnings,
  __resetBeliWarningsMemo,
} from "./beli-warnings";

const ITEM = {
  package_type: "botol",
  package_size: 500,
  base_unit: "g",
  stock_base: 10_000,
  avg_cost_per_base: 20,
  name: "Sirup",
};

function inp(overrides?: Partial<BeliDerivedInput>): BeliDerivedInput {
  return {
    mode: "existing",
    selectedItem: ITEM,
    newPackageType: "botol",
    newPackageSize: "500",
    packageQty: "2",
    pricePerPackage: "10000",
    priceMode: "package",
    pricePerBase: "",
    inputKarton: false,
    ...overrides,
  };
}

describe("computeBeliDerived — memo internal", () => {
  beforeEach(() => {
    __resetBeliDerivedMemo();
    __resetBeliWarningsMemo();
  });

  it("mengembalikan referensi objek yang SAMA untuk input yang secara konten identik", () => {
    const a = computeBeliDerived(inp());
    const b = computeBeliDerived(inp());
    expect(b).toBe(a);
  });

  it("tetap sama saat selectedItem direfetch (referensi baru, isi sama)", () => {
    const a = computeBeliDerived(inp({ selectedItem: { ...ITEM } }));
    const b = computeBeliDerived(inp({ selectedItem: { ...ITEM } }));
    const c = computeBeliDerived(inp({ selectedItem: { ...ITEM } }));
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("alokasi baru saat input berubah (kontrol negatif)", () => {
    const a = computeBeliDerived(inp());
    const b = computeBeliDerived(inp({ packageQty: "3" }));
    expect(b).not.toBe(a);
    expect(b.pkgQ).toBe(3);
  });
});

describe("computeBeliWarnings — memo internal", () => {
  beforeEach(() => {
    __resetBeliDerivedMemo();
    __resetBeliWarningsMemo();
  });

  it("mengembalikan array yang SAMA saat derived + input lain identik", () => {
    const d = computeBeliDerived(inp());
    const w1 = computeBeliWarnings({
      mode: "existing",
      selectedItem: ITEM,
      derived: d,
      priceMode: "package",
      inputKarton: false,
    });
    const w2 = computeBeliWarnings({
      mode: "existing",
      selectedItem: ITEM,
      derived: d,
      priceMode: "package",
      inputKarton: false,
    });
    expect(w2).toBe(w1);
  });

  it("stabil di lintas refetch: derived dari computeBeliDerived hit cache → warnings juga hit", () => {
    const d1 = computeBeliDerived(inp({ selectedItem: { ...ITEM } }));
    const w1 = computeBeliWarnings({
      mode: "existing",
      selectedItem: { ...ITEM },
      derived: d1,
      priceMode: "package",
      inputKarton: false,
    });
    const d2 = computeBeliDerived(inp({ selectedItem: { ...ITEM } }));
    const w2 = computeBeliWarnings({
      mode: "existing",
      selectedItem: { ...ITEM },
      derived: d2,
      priceMode: "package",
      inputKarton: false,
    });
    expect(d2).toBe(d1);
    expect(w2).toBe(w1);
  });

  it("alokasi baru saat input warnings berubah (mis. inputKarton)", () => {
    const d = computeBeliDerived(inp());
    const w1 = computeBeliWarnings({
      mode: "existing",
      selectedItem: ITEM,
      derived: d,
      priceMode: "package",
      inputKarton: false,
    });
    const w2 = computeBeliWarnings({
      mode: "existing",
      selectedItem: ITEM,
      derived: d,
      priceMode: "package",
      inputKarton: true,
    });
    expect(w2).not.toBe(w1);
  });
});