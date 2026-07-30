import { describe, it, expect, vi } from "vitest";
import {
  computeBeliDerived as realComputeDerived,
  type BeliDerivedInput,
} from "@/lib/beli-derived";
import { computeBeliWarnings as realComputeWarnings } from "@/lib/beli-warnings";

// ============================================================
// Tes ini melengkapi `effective-fields-refetch`:
// di sini `selectedItem` di-refetch dengan **referensi objek BARU**
// setiap kali, TAPI field efektif (package_type, package_size,
// base_unit) tetap **deep-equal**. Field non-efektif boleh berubah
// (name, stock_base, avg_cost_per_base, updated_at, supplier_last).
//
// Kontrak yang diuji:
//   Memoization compute* di-key oleh field SCALAR yang diekstraksi
//   dari `selectedItem`, bukan oleh identitas objeknya. Maka:
//   - identitas berubah + field efektif deep-equal → 0 recompute
//   - identitas berubah + field efektif berubah beneran → recompute
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

/**
 * Membuat objek Item BARU dengan field efektif SAMA PERSIS (deep-equal)
 * tapi identitas objek pasti berbeda (`!==` dgn sebelumnya). Field
 * non-efektif digeser bebas — meniru payload refetch dari backend.
 */
function refetchClone(base: Item, tweak: Partial<Item>): Item {
  return {
    id: base.id,
    // Field EFEKTIF: dipertahankan bit-for-bit.
    package_type: base.package_type,
    package_size: base.package_size,
    base_unit: base.base_unit,
    // Field non-efektif: bebas.
    stock_base: base.stock_base,
    avg_cost_per_base: base.avg_cost_per_base,
    name: base.name,
    updated_at: base.updated_at,
    supplier_last: base.supplier_last ?? null,
    ...tweak,
  };
}

describe("refetch selectedItem — identitas BARU + field efektif deep-equal", () => {
  it("derived: 50 refetch identitas-baru, field efektif deep-equal → 1 panggilan", () => {
    const spy = vi.fn(realComputeDerived);

    let item: Item = {
      id: "botol-500",
      package_type: "botol",
      package_size: 500,
      base_unit: "g",
      stock_base: 10_000,
      avg_cost_per_base: 20,
      name: "awal",
      updated_at: "2026-01-01T00:00:00Z",
      supplier_last: null,
    };
    const mode = "existing" as const;
    const itemId = item.id;
    // Deps sengaja pakai SCALAR yang diekstraksi dari item, bukan `item`.
    const scalarDeps = () =>
      [
        mode,
        itemId,
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

    const memo = createMemo({
      deps: scalarDeps(),
      factory: () => spy(inp(item)),
    });
    expect(spy).toHaveBeenCalledTimes(1);

    const prevRefs = new Set<Item>([item]);
    for (let i = 1; i <= 50; i++) {
      // Identitas BARU (spread → objek baru), field efektif deep-equal.
      item = refetchClone(item, {
        stock_base: 10_000 + i,
        avg_cost_per_base: 20 + (i % 7),
        name: `n-${i}`,
        updated_at: `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`,
        supplier_last: i % 2 === 0 ? "PT A" : "PT B",
      });
      // Sanity: benar-benar objek baru setiap iterasi.
      expect(prevRefs.has(item)).toBe(false);
      prevRefs.add(item);

      memo.commit(scalarDeps(), () => spy(inp(item)));
    }

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("warnings: 50 refetch identitas-baru, field efektif deep-equal → 1 panggilan", () => {
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
    const scalarDeps = () =>
      [
        mode,
        itemId,
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

    const memo = createMemo({
      deps: scalarDeps(),
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

    for (let i = 1; i <= 50; i++) {
      item = refetchClone(item, {
        stock_base: 10_000 + i,
        avg_cost_per_base: 20 + (i % 5),
        name: `n-${i}`,
        updated_at: `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`,
      });
      memo.commit(scalarDeps(), () =>
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

  it("interleaved: refetch deep-equal ↔ refetch dgn bump non-efektif berbeda → tetap 1", () => {
    // Meniru pola sinkronisasi realtime: kadang backend push identitas baru
    // tanpa perubahan efektif; kadang mengubah beberapa non-efektif sekaligus.
    const spy = vi.fn(realComputeDerived);

    let item: Item = {
      id: "gram-1000",
      package_type: "gram",
      package_size: 1000,
      base_unit: "g",
      stock_base: 5_000,
    };
    const mode = "existing" as const;
    const itemId = item.id;
    const scalarDeps = () =>
      [
        mode,
        itemId,
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

    const memo = createMemo({
      deps: scalarDeps(),
      factory: () => spy(inp(item)),
    });
    expect(spy).toHaveBeenCalledTimes(1);

    for (let i = 1; i <= 100; i++) {
      const bump: Partial<Item> =
        i % 3 === 0
          ? {} // identitas baru murni, non-efektif juga sama
          : i % 3 === 1
            ? { stock_base: 5_000 + i }
            : { name: `n-${i}`, updated_at: `t-${i}` };
      item = refetchClone(item, bump);
      memo.commit(scalarDeps(), () => spy(inp(item)));
    }

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("kontrol positif A: field efektif package_size berubah → tepat 1 panggilan tambahan", () => {
    const spy = vi.fn(realComputeDerived);

    let item: Item = {
      id: "botol-500",
      package_type: "botol",
      package_size: 500,
      base_unit: "g",
    };
    const mode = "existing" as const;
    const itemId = item.id;
    const scalarDeps = () =>
      [
        mode,
        itemId,
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

    const memo = createMemo({
      deps: scalarDeps(),
      factory: () => spy(inp(item)),
    });
    expect(spy).toHaveBeenCalledTimes(1);

    // 20 refetch identitas-baru deep-equal — masih 1.
    for (let i = 1; i <= 20; i++) {
      item = refetchClone(item, { name: `n-${i}` });
      memo.commit(scalarDeps(), () => spy(inp(item)));
    }
    expect(spy).toHaveBeenCalledTimes(1);

    // Backend mengubah package_size (mis. koreksi master data) → recompute.
    item = refetchClone(item, {} as Partial<Item>);
    item = { ...item, package_size: 750 };
    memo.commit(scalarDeps(), () => spy(inp(item)));
    expect(spy).toHaveBeenCalledTimes(2);

    // Setelah recompute, refetch deep-equal berikutnya tidak menaikkan lagi.
    for (let i = 1; i <= 10; i++) {
      item = refetchClone(item, { name: `m-${i}` });
      memo.commit(scalarDeps(), () => spy(inp(item)));
    }
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("kontrol positif B: base_unit berubah pcs↔g → recompute", () => {
    const spy = vi.fn(realComputeDerived);

    let item: Item = {
      id: "pcs-1",
      package_type: "pcs",
      package_size: 1,
      base_unit: "pcs",
    };
    const mode = "existing" as const;
    const itemId = item.id;
    const scalarDeps = () =>
      [
        mode,
        itemId,
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

    const memo = createMemo({
      deps: scalarDeps(),
      factory: () => spy(inp(item)),
    });
    expect(spy).toHaveBeenCalledTimes(1);

    for (let i = 1; i <= 15; i++) {
      item = refetchClone(item, { name: `n-${i}` });
      memo.commit(scalarDeps(), () => spy(inp(item)));
    }
    expect(spy).toHaveBeenCalledTimes(1);

    // Ubah base_unit (bidang efektif).
    item = { ...refetchClone(item, {}), base_unit: "g" };
    memo.commit(scalarDeps(), () => spy(inp(item)));
    expect(spy).toHaveBeenCalledTimes(2);
  });
});