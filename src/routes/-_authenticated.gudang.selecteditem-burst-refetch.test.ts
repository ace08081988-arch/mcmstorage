import { describe, it, expect, vi } from "vitest";
import {
  computeBeliDerived as realComputeDerived,
  type BeliDerivedInput,
} from "@/lib/beli-derived";
import { computeBeliWarnings as realComputeWarnings } from "@/lib/beli-warnings";

// ============================================================
// BURST refetch selectedItem — banyak refetch beruntun (mis. realtime
// subscription menembak berkali-kali dalam satu tick, atau invalidate
// query berturut-turut) TANPA perubahan field efektif. Verifikasi
// bahwa jumlah panggilan computeBeliDerived & computeBeliWarnings
// TIDAK bertambah dari 1.
//
// Melengkapi:
//   - effective-fields-refetch (30 refetch, field non-efektif berubah)
//   - effective-fields-deepequal-refetch (identitas baru, deep-equal)
//   - resetkey-burst-refetch (fokus reset-key, bukan compute count)
// Fokus di sini: SCALE + RAPID + churn ganda (identitas & non-efektif).
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
  updated_at?: string;
  supplier_last?: string | null;
  rev?: number;
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

function scalarDeps(item: Item): readonly unknown[] {
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

const BASE: Item = {
  id: "botol-500",
  package_type: "botol",
  package_size: 500,
  base_unit: "g",
  stock_base: 10_000,
  avg_cost_per_base: 20,
  name: "awal",
  updated_at: "2026-01-01T00:00:00Z",
  supplier_last: null,
  rev: 0,
};

describe("burst refetch selectedItem — field efektif tetap → call count compute* = 1", () => {
  it("derived: 500 refetch cepat beruntun (identitas baru tiap kali) → 1 panggilan", () => {
    const spy = vi.fn(realComputeDerived);
    let item: Item = { ...BASE };
    const memo = createMemo({ deps: scalarDeps(item), factory: () => spy(inp(item)) });
    expect(spy).toHaveBeenCalledTimes(1);

    for (let i = 1; i <= 500; i++) {
      // Setiap iterasi = objek BARU (spread), tapi field efektif tetap.
      item = { ...item, rev: i, updated_at: `t-${i}` };
      memo.commit(scalarDeps(item), () => spy(inp(item)));
    }
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("warnings: 500 refetch cepat beruntun → 1 panggilan", () => {
    const spy = vi.fn(realComputeWarnings);
    let item: Item = { ...BASE };
    const derived = realComputeDerived(inp(item));
    const memo = createMemo({
      deps: scalarDeps(item),
      factory: () =>
        spy({ mode: "existing", selectedItem: item, derived, priceMode: "package", inputKarton: false }),
    });
    expect(spy).toHaveBeenCalledTimes(1);

    for (let i = 1; i <= 500; i++) {
      item = { ...item, rev: i, stock_base: (item.stock_base ?? 0) + 1, name: `n-${i}` };
      memo.commit(scalarDeps(item), () =>
        spy({ mode: "existing", selectedItem: item, derived, priceMode: "package", inputKarton: false }),
      );
    }
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("burst mikro-batch (10 gelombang × 100 refetch tanpa jeda) → 1 panggilan derived, 1 panggilan warnings", () => {
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);
    let item: Item = { ...BASE };
    const derived = realComputeDerived(inp(item));

    const memoD = createMemo({ deps: scalarDeps(item), factory: () => spyD(inp(item)) });
    const memoW = createMemo({
      deps: scalarDeps(item),
      factory: () =>
        spyW({ mode: "existing", selectedItem: item, derived, priceMode: "package", inputKarton: false }),
    });
    expect(spyD).toHaveBeenCalledTimes(1);
    expect(spyW).toHaveBeenCalledTimes(1);

    for (let wave = 0; wave < 10; wave++) {
      for (let i = 0; i < 100; i++) {
        const idx = wave * 100 + i;
        item = {
          ...item,
          rev: idx,
          stock_base: 10_000 + (idx % 500),
          avg_cost_per_base: 20 + (idx % 11),
          name: `w${wave}-i${i}`,
          updated_at: `2026-01-01T00:${String(wave).padStart(2, "0")}:${String(i).padStart(2, "0")}Z`,
          supplier_last: idx % 2 === 0 ? "PT A" : "PT B",
        };
        memoD.commit(scalarDeps(item), () => spyD(inp(item)));
        memoW.commit(scalarDeps(item), () =>
          spyW({ mode: "existing", selectedItem: item, derived, priceMode: "package", inputKarton: false }),
        );
      }
    }
    expect(spyD).toHaveBeenCalledTimes(1);
    expect(spyW).toHaveBeenCalledTimes(1);
  });

  it("burst dengan nilai bolak-balik pada non-efektif (thrash) → 1 panggilan", () => {
    // stock_base bolak-balik A↔B, name berputar di siklus 3 — masih 1 karena
    // deps SCALAR yang dipantau tidak menyertakan mereka.
    const spy = vi.fn(realComputeDerived);
    let item: Item = { ...BASE };
    const memo = createMemo({ deps: scalarDeps(item), factory: () => spy(inp(item)) });
    expect(spy).toHaveBeenCalledTimes(1);

    const rotName = ["a", "b", "c"] as const;
    for (let i = 1; i <= 300; i++) {
      item = {
        ...item,
        stock_base: i % 2 === 0 ? 10_000 : 10_001,
        name: rotName[i % 3],
        supplier_last: i % 2 === 0 ? "PT A" : "PT B",
      };
      memo.commit(scalarDeps(item), () => spy(inp(item)));
    }
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("kontrol positif: setelah 500 burst, 1 perubahan efektif (package_size) → tepat 2 total", () => {
    const spy = vi.fn(realComputeDerived);
    let item: Item = { ...BASE };
    const memo = createMemo({ deps: scalarDeps(item), factory: () => spy(inp(item)) });
    expect(spy).toHaveBeenCalledTimes(1);

    for (let i = 1; i <= 500; i++) {
      item = { ...item, rev: i, name: `n-${i}` };
      memo.commit(scalarDeps(item), () => spy(inp(item)));
    }
    expect(spy).toHaveBeenCalledTimes(1);

    item = { ...item, package_size: 750 };
    memo.commit(scalarDeps(item), () => spy(inp(item)));
    expect(spy).toHaveBeenCalledTimes(2);

    // 200 burst deep-equal lanjutan → tidak bertambah.
    for (let i = 1; i <= 200; i++) {
      item = { ...item, rev: 1000 + i, name: `m-${i}` };
      memo.commit(scalarDeps(item), () => spy(inp(item)));
    }
    expect(spy).toHaveBeenCalledTimes(2);
  });
});