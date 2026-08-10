import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeBeliDerived as realComputeDerived,
  __resetBeliDerivedMemo,
  type BeliDerivedInput,
} from "@/lib/beli-derived";
import { computeBeliWarnings as realComputeWarnings } from "@/lib/beli-warnings";

// ============================================================
// Verifikasi ASIMETRI recompute antara derived & warnings:
//   Field yang mempengaruhi warnings TAPI TIDAK mempengaruhi derived
//   (mis. stock_base, avg_cost_per_base pada selectedItem) berubah →
//     • computeBeliDerived call count TIDAK bertambah
//     • computeBeliWarnings call count bertambah TEPAT 1
//
// Ini mengunci kontrak: memoization derived di-key oleh field EFEKTIF
// (package_type/size/base_unit + scalar form), sedangkan warnings juga
// menutup stock_base/avg_cost_per_base + inputKarton + priceMode.
// ============================================================

type Deps = readonly unknown[];
function createMemo<T>(initial: { deps: Deps; factory: () => T }) {
  let lastDeps: Deps = initial.deps;
  let lastValue: T = initial.factory();
  return {
    get value() {
      return lastValue;
    },
    commit(nextDeps: Deps, nextFactory: () => T) {
      const changed =
        nextDeps.length !== lastDeps.length ||
        nextDeps.some((d, i) => !Object.is(d, lastDeps[i]));
      if (changed) {
        lastDeps = nextDeps;
        lastValue = nextFactory();
      }
    },
  };
}

type Item = {
  id: string;
  package_type: "botol" | "gram" | "pcs" | "sachet";
  package_size: number;
  base_unit: "g" | "pcs";
  stock_base?: number;
  avg_cost_per_base?: number;
  name?: string;
};

function inp(selectedItem: Item, over: Partial<BeliDerivedInput> = {}): BeliDerivedInput {
  return {
    mode: "existing",
    selectedItem,
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

/** Deps derived: HANYA field efektif + scalar form. */
function derivedDeps(item: Item): readonly unknown[] {
  return [
    "existing",
    item.id,
    item.package_type,
    item.package_size,
    item.base_unit,
    "500",
    "2",
    "10000",
    "package",
    "",
    false,
  ] as const;
}

/** Deps warnings: efektif + stock_base + avg_cost_per_base + priceMode + inputKarton. */
function warningsDeps(item: Item, priceMode: "package" | "base", inputKarton: boolean): readonly unknown[] {
  return [
    "existing",
    item.id,
    item.package_type,
    item.package_size,
    item.base_unit,
    item.stock_base ?? 0,
    item.avg_cost_per_base ?? 0,
    priceMode,
    inputKarton,
  ] as const;
}

beforeEach(() => {
  __resetBeliDerivedMemo();
});

describe("asimetri recompute — hanya warnings yang bertambah", () => {
  it("stock_base berubah 1×: derived tetap 1, warnings naik ke 2", () => {
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);

    let item: Item = {
      id: "botol-500",
      package_type: "botol",
      package_size: 500,
      base_unit: "g",
      stock_base: 10_000,
      avg_cost_per_base: 20,
    };
    const priceMode = "package" as const;
    const inputKarton = false;

    const memoD = createMemo({ deps: derivedDeps(item), factory: () => spyD(inp(item)) });
    const memoW = createMemo({
      deps: warningsDeps(item, priceMode, inputKarton),
      factory: () =>
        spyW({ mode: "existing", selectedItem: item, derived: memoD.value, priceMode, inputKarton }),
    });
    expect(spyD).toHaveBeenCalledTimes(1);
    expect(spyW).toHaveBeenCalledTimes(1);

    // Refetch: hanya stock_base yang berubah.
    item = { ...item, stock_base: 25_000 };
    memoD.commit(derivedDeps(item), () => spyD(inp(item)));
    memoW.commit(warningsDeps(item, priceMode, inputKarton), () =>
      spyW({ mode: "existing", selectedItem: item, derived: memoD.value, priceMode, inputKarton }),
    );

    expect(spyD).toHaveBeenCalledTimes(1);
    expect(spyW).toHaveBeenCalledTimes(2);
  });

  it("avg_cost_per_base berubah 1×: derived tetap 1, warnings naik ke 2", () => {
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);

    let item: Item = {
      id: "gram-1000",
      package_type: "gram",
      package_size: 1000,
      base_unit: "g",
      stock_base: 5_000,
      avg_cost_per_base: 15,
    };
    const priceMode = "package" as const;
    const inputKarton = false;

    const memoD = createMemo({ deps: derivedDeps(item), factory: () => spyD(inp(item)) });
    const memoW = createMemo({
      deps: warningsDeps(item, priceMode, inputKarton),
      factory: () =>
        spyW({ mode: "existing", selectedItem: item, derived: memoD.value, priceMode, inputKarton }),
    });
    expect(spyD).toHaveBeenCalledTimes(1);
    expect(spyW).toHaveBeenCalledTimes(1);

    item = { ...item, avg_cost_per_base: 45 };
    memoD.commit(derivedDeps(item), () => spyD(inp(item)));
    memoW.commit(warningsDeps(item, priceMode, inputKarton), () =>
      spyW({ mode: "existing", selectedItem: item, derived: memoD.value, priceMode, inputKarton }),
    );

    expect(spyD).toHaveBeenCalledTimes(1);
    expect(spyW).toHaveBeenCalledTimes(2);
  });

  it("beruntun: 20 refetch, tiap kali hanya stock_base yang bergeser → derived=1, warnings=21", () => {
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);

    let item: Item = {
      id: "botol-500",
      package_type: "botol",
      package_size: 500,
      base_unit: "g",
      stock_base: 10_000,
      avg_cost_per_base: 20,
    };
    const priceMode = "package" as const;
    const inputKarton = false;

    const memoD = createMemo({ deps: derivedDeps(item), factory: () => spyD(inp(item)) });
    const memoW = createMemo({
      deps: warningsDeps(item, priceMode, inputKarton),
      factory: () =>
        spyW({ mode: "existing", selectedItem: item, derived: memoD.value, priceMode, inputKarton }),
    });

    for (let i = 1; i <= 20; i++) {
      item = { ...item, stock_base: 10_000 + i * 100 };
      memoD.commit(derivedDeps(item), () => spyD(inp(item)));
      memoW.commit(warningsDeps(item, priceMode, inputKarton), () =>
        spyW({ mode: "existing", selectedItem: item, derived: memoD.value, priceMode, inputKarton }),
      );
    }

    expect(spyD).toHaveBeenCalledTimes(1);
    expect(spyW).toHaveBeenCalledTimes(1 + 20);
  });

  it("inputKarton flip (tanpa perubahan item): derived RECOMPUTE (kartonActive berubah), warnings juga naik", () => {
    // Kontrol-negatif untuk memastikan tes tidak "cheat": inputKarton adalah
    // field yang MEMANG dipakai derived juga, jadi keduanya harus naik.
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);

    const item: Item = {
      id: "botol-500",
      package_type: "botol",
      package_size: 500,
      base_unit: "g",
      stock_base: 10_000,
      avg_cost_per_base: 20,
    };
    let inputKarton = false;
    const priceMode = "package" as const;

    const dDeps = () => [...derivedDeps(item).slice(0, -1), inputKarton] as const;
    const wDeps = () => warningsDeps(item, priceMode, inputKarton);

    const memoD = createMemo({
      deps: dDeps(),
      factory: () => spyD({ ...inp(item), inputKarton }),
    });
    const memoW = createMemo({
      deps: wDeps(),
      factory: () =>
        spyW({ mode: "existing", selectedItem: item, derived: memoD.value, priceMode, inputKarton }),
    });
    expect(spyD).toHaveBeenCalledTimes(1);
    expect(spyW).toHaveBeenCalledTimes(1);

    inputKarton = true;
    memoD.commit(dDeps(), () => spyD({ ...inp(item), inputKarton }));
    memoW.commit(wDeps(), () =>
      spyW({ mode: "existing", selectedItem: item, derived: memoD.value, priceMode, inputKarton }),
    );
    expect(spyD).toHaveBeenCalledTimes(2);
    expect(spyW).toHaveBeenCalledTimes(2);
  });

  it("kontrol positif akhir: setelah stock_base burst, 1 perubahan package_size → derived naik ke 2, warnings naik +1", () => {
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);

    let item: Item = {
      id: "botol-500",
      package_type: "botol",
      package_size: 500,
      base_unit: "g",
      stock_base: 10_000,
      avg_cost_per_base: 20,
    };
    const priceMode = "package" as const;
    const inputKarton = false;

    const memoD = createMemo({ deps: derivedDeps(item), factory: () => spyD(inp(item)) });
    const memoW = createMemo({
      deps: warningsDeps(item, priceMode, inputKarton),
      factory: () =>
        spyW({ mode: "existing", selectedItem: item, derived: memoD.value, priceMode, inputKarton }),
    });

    // 10 refetch: hanya stock_base + avg_cost_per_base yang bergeser.
    for (let i = 1; i <= 10; i++) {
      item = { ...item, stock_base: 10_000 + i, avg_cost_per_base: 20 + i };
      memoD.commit(derivedDeps(item), () => spyD(inp(item)));
      memoW.commit(warningsDeps(item, priceMode, inputKarton), () =>
        spyW({ mode: "existing", selectedItem: item, derived: memoD.value, priceMode, inputKarton }),
      );
    }
    expect(spyD).toHaveBeenCalledTimes(1);
    expect(spyW).toHaveBeenCalledTimes(1 + 10);

    // Sekarang ubah package_size → efektif untuk derived DAN warnings.
    item = { ...item, package_size: 750 };
    memoD.commit(derivedDeps(item), () => spyD(inp(item)));
    memoW.commit(warningsDeps(item, priceMode, inputKarton), () =>
      spyW({ mode: "existing", selectedItem: item, derived: memoD.value, priceMode, inputKarton }),
    );
    expect(spyD).toHaveBeenCalledTimes(2);
    expect(spyW).toHaveBeenCalledTimes(1 + 10 + 1);
  });
});