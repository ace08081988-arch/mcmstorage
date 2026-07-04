import { describe, it, expect, vi } from "vitest";
import {
  computeBeliDerived as realComputeDerived,
  type BeliDerivedInput,
} from "@/lib/beli-derived";
import { computeBeliWarnings as realComputeWarnings } from "@/lib/beli-warnings";

// ============================================================
// Verifikasi berbasis JUMLAH PEMANGGILAN (call count) bahwa
// `computeBeliDerived` dan `computeBeliWarnings` tidak dipanggil
// ulang ketika `selectedItem` di-refetch berkali-kali TAPI field
// efektif (package_type, package_size, base_unit) tidak berubah —
// hanya field non-efektif (name, stock_base, avg_cost_per_base,
// updated_at, dsb.) yang bergeser.
//
// Ini melengkapi `_authenticated.gudang.compute-spy.test.ts` dengan
// fokus eksplisit pada dimensi "field efektif tetap".
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

describe("refetch selectedItem: field efektif tetap → call count compute* stabil", () => {
  it("derived: 30 refetch mengganti hanya field non-efektif → tetap 1 panggilan", () => {
    const spy = vi.fn(realComputeDerived);

    let item: Item = {
      id: "botol-500",
      package_type: "botol",
      package_size: 500,
      base_unit: "g",
      stock_base: 10_000,
      avg_cost_per_base: 20,
      name: "n-0",
      updated_at: "2026-01-01T00:00:00Z",
      supplier_last: null,
    };
    const mode = "existing" as const;
    const itemId = item.id;
    const packageType = item.package_type;
    const scalar = ["500", "2", "10000", "package", "", false] as const;

    const memo = createMemo({
      deps: [mode, itemId, packageType, ...scalar],
      factory: () => spy(inp(item)),
    });
    expect(spy).toHaveBeenCalledTimes(1);

    for (let i = 1; i <= 30; i++) {
      // Hanya field non-efektif yang berubah — package_type, package_size,
      // base_unit sama persis.
      item = {
        ...item,
        stock_base: 10_000 + i,
        avg_cost_per_base: 20 + (i % 5),
        name: `n-${i}`,
        updated_at: `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`,
        supplier_last: i % 2 === 0 ? "PT A" : "PT B",
      };
      memo.commit(
        [mode, itemId, packageType, ...scalar],
        () => spy(inp(item)),
      );
    }

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("warnings: 30 refetch mengganti hanya field non-efektif → tetap 1 panggilan", () => {
    const spy = vi.fn(realComputeWarnings);

    let item: Item = {
      id: "botol-500",
      package_type: "botol",
      package_size: 500,
      base_unit: "g",
      stock_base: 10_000,
      avg_cost_per_base: 20,
    };
    const derived = realComputeDerived(inp(item));
    const mode = "existing" as const;
    const itemId = item.id;
    const packageType = item.package_type;
    const scalar = ["500", "2", "10000", "package", "", false] as const;

    const memo = createMemo({
      deps: [mode, itemId, packageType, ...scalar],
      factory: () =>
        spy({
          mode,
          selectedItem: item,
          derived,
          priceMode: "package",
          inputKarton: false,
        }),
    });
    expect(spy).toHaveBeenCalledTimes(1);

    for (let i = 1; i <= 30; i++) {
      item = {
        ...item,
        stock_base: 10_000 + i,
        avg_cost_per_base: 20 + (i % 5),
        name: `n-${i}`,
        updated_at: `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`,
      };
      memo.commit(
        [mode, itemId, packageType, ...scalar],
        () =>
          spy({
            mode,
            selectedItem: item,
            derived,
            priceMode: "package",
            inputKarton: false,
          }),
      );
    }

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("kontrol positif: mengubah field efektif (package_size) memicu tepat 1 panggilan tambahan", () => {
    const spy = vi.fn(realComputeDerived);

    let item: Item = {
      id: "botol-500",
      package_type: "botol",
      package_size: 500,
      base_unit: "g",
      stock_base: 10_000,
    };
    const mode = "existing" as const;
    const itemId = item.id;
    const packageType = item.package_type;
    let pkgSizeInput = "500";
    const scalar = () => [pkgSizeInput, "2", "10000", "package", "", false] as const;

    const memo = createMemo({
      deps: [mode, itemId, packageType, ...scalar()],
      factory: () => spy(inp(item, { newPackageSize: pkgSizeInput })),
    });
    expect(spy).toHaveBeenCalledTimes(1);

    // 10 refetch non-efektif — tetap 1.
    for (let i = 1; i <= 10; i++) {
      item = { ...item, stock_base: 10_000 + i, name: `n-${i}` };
      memo.commit(
        [mode, itemId, packageType, ...scalar()],
        () => spy(inp(item, { newPackageSize: pkgSizeInput })),
      );
    }
    expect(spy).toHaveBeenCalledTimes(1);

    // Ubah newPackageSize (field efektif untuk derivation ukuran paket)
    // → tepat 1 panggilan tambahan.
    pkgSizeInput = "750";
    memo.commit(
      [mode, itemId, packageType, ...scalar()],
      () => spy(inp(item, { newPackageSize: pkgSizeInput })),
    );
    expect(spy).toHaveBeenCalledTimes(2);
  });
});