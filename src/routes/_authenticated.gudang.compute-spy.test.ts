import { describe, it, expect, vi } from "vitest";
import {
  computeBeliDerived as realComputeDerived,
  type BeliDerivedInput,
} from "@/lib/beli-derived";
import {
  computeBeliWarnings as realComputeWarnings,
} from "@/lib/beli-warnings";

// ============================================================
// Tes berbasis spionase (spy) untuk MEMBUKTIKAN bahwa layer
// memoization di komponen (mirror useMemo dari
// _authenticated.gudang.tsx dengan dep minimal `[mode, itemId,
// packageType, ...scalar]`) tidak memanggil `computeBeliDerived`
// / `computeBeliWarnings` ulang saat identitas `selectedItem`
// berubah tapi kunci tetap.
//
// Ini melengkapi tes memo internal (single-slot content-signature)
// di `src/lib/beli-memo.test.ts` — di sana kami memverifikasi
// referensi hasil stabil bahkan bila fungsi dipanggil ulang.
// Di sini kami memverifikasi fungsi TIDAK dipanggil sama sekali.
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

describe("compute-spy: refetch selectedItem tidak memanggil ulang compute*", () => {
  it("computeBeliDerived: 0 panggilan tambahan setelah 20 refetch dengan itemId/packageType tetap", () => {
    const spyDerived = vi.fn(realComputeDerived);

    let selectedItem: Item = {
      id: "botol-500",
      package_type: "botol",
      package_size: 500,
      base_unit: "g",
    };
    const mode = "existing" as const;
    const itemId = "botol-500";
    const packageType = "botol";
    const scalar = ["500", "2", "10000", "package", "", false] as const;

    // Meniru useMemo(derived, [mode, itemId, packageType, ...scalar])
    const memo = createMemo({
      deps: [mode, itemId, packageType, ...scalar],
      factory: () => spyDerived(baseInp({ selectedItem })),
    });
    expect(spyDerived).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 20; i++) {
      // Refetch: referensi baru, isi packaging identik, itemId tetap.
      selectedItem = {
        ...selectedItem,
        stock_base: 10_000 + i,
        avg_cost_per_base: 20,
      };
      memo.commit(
        [mode, itemId, packageType, ...scalar],
        () => spyDerived(baseInp({ selectedItem })),
      );
    }

    // KRITIS: tidak ada panggilan tambahan.
    expect(spyDerived).toHaveBeenCalledTimes(1);
    expect(memo.value).toBeTruthy();
  });

  it("computeBeliWarnings: 0 panggilan tambahan setelah 20 refetch dengan kunci tetap", () => {
    const spyWarn = vi.fn(realComputeWarnings);

    let selectedItem: Item = {
      id: "botol-500",
      package_type: "botol",
      package_size: 500,
      base_unit: "g",
      stock_base: 10_000,
      avg_cost_per_base: 20,
    };
    const mode = "existing" as const;
    const itemId = "botol-500";
    const packageType = "botol";
    const scalar = ["500", "2", "10000", "package", "", false] as const;

    const derived = realComputeDerived(baseInp({ selectedItem }));
    const memo = createMemo({
      deps: [mode, itemId, packageType, ...scalar],
      factory: () =>
        spyWarn({
          mode,
          selectedItem,
          derived,
          priceMode: "package",
          inputKarton: false,
        }),
    });
    expect(spyWarn).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 20; i++) {
      selectedItem = { ...selectedItem, stock_base: 10_000 + i };
      memo.commit(
        [mode, itemId, packageType, ...scalar],
        () =>
          spyWarn({
            mode,
            selectedItem,
            derived,
            priceMode: "package",
            inputKarton: false,
          }),
      );
    }

    expect(spyWarn).toHaveBeenCalledTimes(1);
  });

  it("kontrol positif: perubahan itemId MEMICU tepat 1 panggilan tambahan ke computeBeliDerived", () => {
    const spyDerived = vi.fn(realComputeDerived);
    let selectedItem: Item = {
      id: "botol-500",
      package_type: "botol",
      package_size: 500,
      base_unit: "g",
    };
    let itemId = "botol-500";
    const mode = "existing" as const;
    const packageType = "botol";
    const scalar = ["500", "2", "10000", "package", "", false] as const;

    const memo = createMemo({
      deps: [mode, itemId, packageType, ...scalar],
      factory: () => spyDerived(baseInp({ selectedItem })),
    });
    expect(spyDerived).toHaveBeenCalledTimes(1);

    // Refetch dulu 10× — 0 panggilan tambahan.
    for (let i = 0; i < 10; i++) {
      selectedItem = { ...selectedItem, stock_base: i };
      memo.commit(
        [mode, itemId, packageType, ...scalar],
        () => spyDerived(baseInp({ selectedItem })),
      );
    }
    expect(spyDerived).toHaveBeenCalledTimes(1);

    // Sekarang ganti itemId → tepat 1 panggilan tambahan.
    itemId = "gram-1000";
    selectedItem = {
      id: "gram-1000",
      package_type: "gram",
      package_size: 1000,
      base_unit: "g",
    };
    memo.commit(
      [mode, itemId, "gram", ...scalar],
      () => spyDerived(baseInp({ selectedItem, mode: "existing" })),
    );
    expect(spyDerived).toHaveBeenCalledTimes(2);
  });

  it("kontrol positif: perubahan packageType MEMICU tepat 1 panggilan tambahan ke computeBeliWarnings", () => {
    const spyWarn = vi.fn(realComputeWarnings);
    let selectedItem: Item = {
      id: "botol-500",
      package_type: "botol",
      package_size: 500,
      base_unit: "g",
      stock_base: 10_000,
      avg_cost_per_base: 20,
    };
    let packageType: "botol" | "gram" | "pcs" = "botol";
    const mode = "existing" as const;
    const itemId = "botol-500";
    const scalar = ["500", "2", "10000", "package", "", false] as const;

    const derivedRef = realComputeDerived(baseInp({ selectedItem }));
    const memo = createMemo({
      deps: [mode, itemId, packageType, ...scalar],
      factory: () =>
        spyWarn({
          mode,
          selectedItem,
          derived: derivedRef,
          priceMode: "package",
          inputKarton: false,
        }),
    });
    expect(spyWarn).toHaveBeenCalledTimes(1);

    // 15 refetch identity — 0 panggilan tambahan.
    for (let i = 0; i < 15; i++) {
      selectedItem = { ...selectedItem, avg_cost_per_base: 20 + (i % 3) };
      memo.commit(
        [mode, itemId, packageType, ...scalar],
        () =>
          spyWarn({
            mode,
            selectedItem,
            derived: derivedRef,
            priceMode: "package",
            inputKarton: false,
          }),
      );
    }
    expect(spyWarn).toHaveBeenCalledTimes(1);

    // Ganti packageType → tepat 1 panggilan tambahan.
    packageType = "gram";
    memo.commit(
      [mode, itemId, packageType, ...scalar],
      () =>
        spyWarn({
          mode,
          selectedItem,
          derived: derivedRef,
          priceMode: "package",
          inputKarton: false,
        }),
    );
    expect(spyWarn).toHaveBeenCalledTimes(2);
  });

  it("burst refetch interleave (derived + warnings bersamaan) → 0 panggilan tambahan untuk keduanya", () => {
    const spyDerived = vi.fn(realComputeDerived);
    const spyWarn = vi.fn(realComputeWarnings);
    let selectedItem: Item = {
      id: "botol-500",
      package_type: "botol",
      package_size: 500,
      base_unit: "g",
      stock_base: 10_000,
      avg_cost_per_base: 20,
    };
    const mode = "existing" as const;
    const itemId = "botol-500";
    const packageType = "botol";
    const scalar = ["500", "2", "10000", "package", "", false] as const;

    const memoDerived = createMemo({
      deps: [mode, itemId, packageType, ...scalar],
      factory: () => spyDerived(baseInp({ selectedItem })),
    });
    const memoWarn = createMemo({
      deps: [mode, itemId, packageType, ...scalar],
      factory: () =>
        spyWarn({
          mode,
          selectedItem,
          derived: memoDerived.value,
          priceMode: "package",
          inputKarton: false,
        }),
    });
    expect(spyDerived).toHaveBeenCalledTimes(1);
    expect(spyWarn).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 50; i++) {
      selectedItem = {
        ...selectedItem,
        stock_base: 10_000 + i,
        avg_cost_per_base: 20 + (i % 3),
        name: `n-${i}`,
      };
      memoDerived.commit(
        [mode, itemId, packageType, ...scalar],
        () => spyDerived(baseInp({ selectedItem })),
      );
      memoWarn.commit(
        [mode, itemId, packageType, ...scalar],
        () =>
          spyWarn({
            mode,
            selectedItem,
            derived: memoDerived.value,
            priceMode: "package",
            inputKarton: false,
          }),
      );
    }

    expect(spyDerived).toHaveBeenCalledTimes(1);
    expect(spyWarn).toHaveBeenCalledTimes(1);
  });
});