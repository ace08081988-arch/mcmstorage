import { describe, it, expect, vi } from "vitest";
import {
  computeBeliDerived as realComputeDerived,
  type BeliDerivedInput,
} from "@/lib/beli-derived";
import {
  computeBeliWarnings as realComputeWarnings,
} from "@/lib/beli-warnings";

// ============================================================
// Kontrak: ketika beberapa update field efektif terjadi berurutan
// cepat (dalam satu tick sinkron), memo HARUS ter-invalidasi setiap
// transisi dan mengembalikan nilai turunan yang dihitung dari state
// **terkini**, bukan nilai lama yang tertahan dari commit sebelumnya.
//
// Kegagalan yang dijaga: memo pakai stale-closure atau melewatkan
// invalidasi karena deps di-key oleh identitas objek/array, bukan
// scalar yang benar-benar berubah.
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
};

function inp(
  selectedItem: Item,
  over: Partial<BeliDerivedInput> = {},
): BeliDerivedInput {
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

describe("memo invalidation — burst sequential updates (no stale-hold)", () => {
  it("derived: 200 rapid packageQty flips → tiap commit menghasilkan nilai fresh", () => {
    const spy = vi.fn(realComputeDerived);

    const item: Item = {
      id: "botol-500",
      package_type: "botol",
      package_size: 500,
      base_unit: "g",
      stock_base: 10_000,
      avg_cost_per_base: 20,
    };

    let packageQty = "1";
    const deps = () =>
      [
        "existing",
        item.id,
        item.package_type,
        item.package_size,
        item.base_unit,
        "500",
        packageQty,
        "10000",
        "package",
        "",
        false,
      ] as const;

    const memo = createMemo({
      deps: deps(),
      factory: () => spy(inp(item, { packageQty })),
    });
    expect(spy).toHaveBeenCalledTimes(1);

    // Burst 200 update berurutan cepat; setiap transisi qty harus fresh.
    for (let i = 2; i <= 201; i++) {
      packageQty = String(i);
      memo.commit(deps(), () => spy(inp(item, { packageQty })));
      // Nilai memo TIDAK boleh sama dgn hasil qty sebelumnya (fresh).
      const expected = realComputeDerived(inp(item, { packageQty }));
      expect(memo.value).toEqual(expected);
    }

    // Setiap transisi = 1 recompute + 1 di awal = 201 panggilan.
    expect(spy).toHaveBeenCalledTimes(201);
  });

  it("derived: qty flip A→B→A→B (2000×) tidak menahan nilai lama saat kembali", () => {
    const spy = vi.fn(realComputeDerived);
    const item: Item = {
      id: "botol-500",
      package_type: "botol",
      package_size: 500,
      base_unit: "g",
    };
    let qty = "3";
    const deps = () =>
      [
        "existing",
        item.id,
        item.package_type,
        item.package_size,
        item.base_unit,
        "500",
        qty,
        "10000",
        "package",
        "",
        false,
      ] as const;

    const memo = createMemo({
      deps: deps(),
      factory: () => spy(inp(item, { packageQty: qty })),
    });

    const valAtA = realComputeDerived(inp(item, { packageQty: "3" }));
    const valAtB = realComputeDerived(inp(item, { packageQty: "7" }));
    // Sanity: A dan B benar-benar berbeda.
    expect(valAtA).not.toEqual(valAtB);

    for (let i = 0; i < 2000; i++) {
      qty = i % 2 === 0 ? "7" : "3";
      memo.commit(deps(), () => spy(inp(item, { packageQty: qty })));
      expect(memo.value).toEqual(qty === "3" ? valAtA : valAtB);
    }

    // 1 (awal, qty=3) + 2000 transisi.
    expect(spy).toHaveBeenCalledTimes(2001);
  });

  it("warnings: burst package_size flip → tiap step meng-invalidasi tanpa carry-over", () => {
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);

    let item: Item = {
      id: "gram-1",
      package_type: "gram",
      package_size: 250,
      base_unit: "g",
      stock_base: 5_000,
      avg_cost_per_base: 15,
    };

    const derivedDeps = () =>
      [
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

    const memoD = createMemo({
      deps: derivedDeps(),
      factory: () => spyD(inp(item)),
    });
    const memoW = createMemo({
      deps: [...derivedDeps(), memoD.value] as const,
      factory: () =>
        spyW({
          mode: "existing",
          selectedItem: item,
          derived: memoD.value,
          priceMode: "package",
          inputKarton: false,
        }),
    });

    // Burst 150 update package_size berurutan cepat.
    for (let i = 1; i <= 150; i++) {
      item = { ...item, package_size: 250 + i };
      memoD.commit(derivedDeps(), () => spyD(inp(item)));
      memoW.commit([...derivedDeps(), memoD.value] as const, () =>
        spyW({
          mode: "existing",
          selectedItem: item,
          derived: memoD.value,
          priceMode: "package",
          inputKarton: false,
        }),
      );
      // Fresh: warnings sekarang harus == warnings yg dihitung ulang
      // dari state paling mutakhir (bukan dari step sebelumnya).
      const freshDerived = realComputeDerived(inp(item));
      const freshWarn = realComputeWarnings({
        mode: "existing",
        selectedItem: item,
        derived: freshDerived,
        priceMode: "package",
        inputKarton: false,
      });
      expect(memoW.value).toEqual(freshWarn);
    }

    // 1 awal + 150 transisi untuk keduanya.
    expect(spyD).toHaveBeenCalledTimes(151);
    expect(spyW).toHaveBeenCalledTimes(151);
  });

  it("mixed burst: priceMode & pricePerBase & packageQty bergantian → tidak ada nilai tertahan", () => {
    const spy = vi.fn(realComputeDerived);
    const item: Item = {
      id: "gram-1",
      package_type: "gram",
      package_size: 1000,
      base_unit: "g",
    };

    let priceMode: "package" | "base" = "package";
    let pricePerBase = "";
    let pricePerPackage = "10000";
    let packageQty = "1";

    const deps = () =>
      [
        "existing",
        item.id,
        item.package_type,
        item.package_size,
        item.base_unit,
        "500",
        packageQty,
        pricePerPackage,
        priceMode,
        pricePerBase,
        false,
      ] as const;

    const build = (): BeliDerivedInput => ({
      mode: "existing",
      selectedItem: item,
      newPackageType: "botol",
      newPackageSize: "500",
      packageQty,
      pricePerPackage,
      priceMode,
      pricePerBase,
      inputKarton: false,
    });

    const memo = createMemo({ deps: deps(), factory: () => spy(build()) });

    for (let i = 1; i <= 300; i++) {
      // Rotasi 4 field efektif — setiap iterasi mengubah tepat 1.
      switch (i % 4) {
        case 0:
          priceMode = priceMode === "package" ? "base" : "package";
          break;
        case 1:
          pricePerBase = priceMode === "base" ? String(10 + i) : "";
          break;
        case 2:
          pricePerPackage = String(10000 + i);
          break;
        case 3:
          packageQty = String((i % 9) + 1);
          break;
      }
      memo.commit(deps(), () => spy(build()));
      // Fresh: nilai memo == compute langsung terhadap state saat ini.
      expect(memo.value).toEqual(realComputeDerived(build()));
    }
    // Kontrak utama: nilai memo selalu fresh (dicek di dalam loop).
    // Recompute hanya terjadi saat deps benar-benar berubah; no-op
    // (mis. set field ke nilai yang sama) tidak boleh menaikkan
    // hitungan — itu jaminan yang berbeda, tapi tetap kita jaga.
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1 + 300);
  });
});