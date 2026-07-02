import { describe, it, expect } from "vitest";
import {
  computeBeliDerived,
  computeBeliDerived as realComputeDerived,
  type BeliDerivedInput,
} from "@/lib/beli-derived";
import { computeBeliWarnings } from "@/lib/beli-warnings";
import {
  createStrictDerivedSpy,
  createStrictWarningsSpy,
} from "./_authenticated.gudang.strict-compute-spy";

// ============================================================
// Memastikan matcher strict-compute-spy:
//   1) hanya menghitung panggilan pipeline (via `.call`).
//   2) mengabaikan pemanggilan compute yang berasal dari helper
//      fixture / kontrol positif / snapshot builder — sehingga
//      tidak muncul false positive.
//   3) menolak (throw) bila input tidak sesuai shape pipeline.
//   4) ekspektasi tetap deterministik walau tercampur helper.
// ============================================================

type Item = {
  id: string;
  package_type: "botol" | "gram" | "pcs" | "sachet";
  package_size: number;
  base_unit: "g" | "pcs";
  stock_base?: number;
  avg_cost_per_base?: number;
};

function baseInp(over: Partial<BeliDerivedInput> = {}): BeliDerivedInput {
  return {
    mode: "existing",
    selectedItem: null,
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

const ITEM: Item = {
  id: "botol-500",
  package_type: "botol",
  package_size: 500,
  base_unit: "g",
  stock_base: 10_000,
  avg_cost_per_base: 20,
};

describe("strict-compute-spy: matcher hanya menghitung panggilan pipeline", () => {
  it("panggilan via `.call` menaikkan pipelineCalls; panggilan real langsung tidak", () => {
    const spy = createStrictDerivedSpy();

    // Helper luar pipeline — memakai fungsi asli, TIDAK terkait spy.
    for (let i = 0; i < 50; i++) {
      const withStock: Item = { ...ITEM, stock_base: i };
      realComputeDerived(baseInp({ selectedItem: withStock }));
    }

    expect(spy.pipelineCalls).toBe(0);
    expect(spy.mock).not.toHaveBeenCalled();

    // Panggilan pipeline yang sesungguhnya.
    spy.call(baseInp({ selectedItem: ITEM }));
    spy.call(baseInp({ selectedItem: ITEM, packageQty: "3" }));

    expect(spy.pipelineCalls).toBe(2);
    expect(spy.mock).toHaveBeenCalledTimes(2);
    expect(spy.invalidCalls).toBe(0);
  });

  it("warnings: pipelineCalls stabil walau helper snapshot ikut memanggil compute asli", () => {
    const spyW = createStrictWarningsSpy();
    const derived = computeBeliDerived(baseInp({ selectedItem: ITEM }));

    // Snapshot fixture — panggil ratusan kali di luar pipeline.
    for (let i = 0; i < 200; i++) {
      computeBeliWarnings({
        mode: "existing",
        selectedItem: { ...ITEM, avg_cost_per_base: 20 + (i % 5) },
        derived,
        priceMode: "package",
        inputKarton: false,
      });
    }

    // Pipeline sungguhan: 1 kali.
    spyW.call({
      mode: "existing",
      selectedItem: ITEM,
      derived,
      priceMode: "package",
      inputKarton: false,
    });

    expect(spyW.pipelineCalls).toBe(1);
    expect(spyW.mock).toHaveBeenCalledTimes(1);
  });

  it("input yang bentuknya salah untuk pipeline melempar error dan menaikkan invalidCalls", () => {
    const spy = createStrictDerivedSpy();
    expect(() =>
      (spy.call as unknown as (x: unknown) => unknown)({ mode: "existing" }),
    ).toThrow(/computeBeliDerived: field '/);
    expect(spy.invalidCalls).toBe(1);
    expect(spy.pipelineCalls).toBe(0);
  });

  it("reset() mengembalikan counter dan mock ke nol", () => {
    const spy = createStrictDerivedSpy();
    spy.call(baseInp({ selectedItem: ITEM }));
    spy.call(baseInp({ selectedItem: ITEM, packageQty: "5" }));
    expect(spy.pipelineCalls).toBe(2);
    spy.reset();
    expect(spy.pipelineCalls).toBe(0);
    expect(spy.mock).toHaveBeenCalledTimes(0);
  });

  it("stabilitas ekspektasi: 500 helper-calls + 3 pipeline-calls → tetap 3", () => {
    const spy = createStrictDerivedSpy();
    for (let i = 0; i < 500; i++) {
      const withStock: Item = { ...ITEM, stock_base: i };
      realComputeDerived(baseInp({ selectedItem: withStock }));
    }
    spy.call(baseInp({ selectedItem: ITEM }));
    for (let i = 0; i < 250; i++) {
      const withStock: Item = { ...ITEM, stock_base: i };
      realComputeDerived(baseInp({ selectedItem: withStock }));
    }
    spy.call(baseInp({ selectedItem: ITEM, packageQty: "3" }));
    spy.call(baseInp({ selectedItem: ITEM, packageQty: "4" }));
    for (let i = 0; i < 250; i++) {
      const withStock: Item = { ...ITEM, stock_base: i };
      realComputeDerived(baseInp({ selectedItem: withStock }));
    }
    expect(spy.pipelineCalls).toBe(3);
    expect(spy.invalidCalls).toBe(0);
  });
});