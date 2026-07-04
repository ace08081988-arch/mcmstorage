import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeBeliDerived as realComputeDerived,
  __resetBeliDerivedMemo,
  type BeliDerivedInput,
} from "@/lib/beli-derived";
import { computeBeliWarnings as realComputeWarnings } from "@/lib/beli-warnings";

// ============================================================
// Verifikasi ASIMETRI kebalikan (pasangan warnings-only-recompute):
//   Field yang mempengaruhi DERIVED TAPI TIDAK mempengaruhi warnings
//   (scalar form: packageQty, pricePerPackage, pricePerBase, newPackageSize)
//   berubah →
//     • computeBeliDerived call count bertambah TEPAT 1
//     • computeBeliWarnings call count TIDAK bertambah (deps efektif sama)
//
// Ini mengunci kontrak: warnings di-key oleh (item.id, package_type/size,
// base_unit, stock_base, avg_cost_per_base, priceMode, inputKarton) — tidak
// termasuk field form scalar; sehingga refetch pada scalar form hanya me-
// recompute derived, warnings dilewati.
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

type Form = {
  newPackageType: BeliDerivedInput["newPackageType"];
  newPackageSize: string;
  packageQty: string;
  pricePerPackage: string;
  priceMode: "package" | "base";
  pricePerBase: string;
  inputKarton: boolean;
};

const BASE_FORM: Form = {
  newPackageType: "botol",
  newPackageSize: "500",
  packageQty: "2",
  pricePerPackage: "10000",
  priceMode: "package",
  pricePerBase: "",
  inputKarton: false,
};

function inp(selectedItem: Item, form: Form): BeliDerivedInput {
  return {
    mode: "existing",
    selectedItem,
    newPackageType: form.newPackageType,
    newPackageSize: form.newPackageSize,
    packageQty: form.packageQty,
    pricePerPackage: form.pricePerPackage,
    priceMode: form.priceMode,
    pricePerBase: form.pricePerBase,
    inputKarton: form.inputKarton,
  };
}

/** Deps derived: efektif item + seluruh scalar form. */
function derivedDeps(item: Item, form: Form): readonly unknown[] {
  return [
    "existing",
    item.id,
    item.package_type,
    item.package_size,
    item.base_unit,
    form.newPackageSize,
    form.packageQty,
    form.pricePerPackage,
    form.priceMode,
    form.pricePerBase,
    form.inputKarton,
  ] as const;
}

/** Deps warnings: efektif item + stock/avg + priceMode + inputKarton (TANPA form scalar lain). */
function warningsDeps(item: Item, form: Form): readonly unknown[] {
  return [
    "existing",
    item.id,
    item.package_type,
    item.package_size,
    item.base_unit,
    item.stock_base ?? 0,
    item.avg_cost_per_base ?? 0,
    form.priceMode,
    form.inputKarton,
  ] as const;
}

beforeEach(() => {
  __resetBeliDerivedMemo();
});

describe("asimetri recompute — hanya derived yang bertambah", () => {
  it("packageQty berubah 1×: derived naik ke 2, warnings tetap 1", () => {
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
    let form: Form = { ...BASE_FORM };

    const memoD = createMemo({ deps: derivedDeps(item, form), factory: () => spyD(inp(item, form)) });
    const memoW = createMemo({
      deps: warningsDeps(item, form),
      factory: () =>
        spyW({ mode: "existing", selectedItem: item, derived: memoD.value, priceMode: form.priceMode, inputKarton: form.inputKarton }),
    });
    expect(spyD).toHaveBeenCalledTimes(1);
    expect(spyW).toHaveBeenCalledTimes(1);

    form = { ...form, packageQty: "5" };
    memoD.commit(derivedDeps(item, form), () => spyD(inp(item, form)));
    memoW.commit(warningsDeps(item, form), () =>
      spyW({ mode: "existing", selectedItem: item, derived: memoD.value, priceMode: form.priceMode, inputKarton: form.inputKarton }),
    );
    expect(spyD).toHaveBeenCalledTimes(2);
    expect(spyW).toHaveBeenCalledTimes(1);
  });

  it("pricePerPackage berubah 1×: derived naik ke 2, warnings tetap 1", () => {
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);

    const item: Item = {
      id: "gram-1000",
      package_type: "gram",
      package_size: 1000,
      base_unit: "g",
      stock_base: 5_000,
      avg_cost_per_base: 15,
    };
    let form: Form = { ...BASE_FORM, pricePerPackage: "12000" };

    const memoD = createMemo({ deps: derivedDeps(item, form), factory: () => spyD(inp(item, form)) });
    const memoW = createMemo({
      deps: warningsDeps(item, form),
      factory: () =>
        spyW({ mode: "existing", selectedItem: item, derived: memoD.value, priceMode: form.priceMode, inputKarton: form.inputKarton }),
    });
    expect(spyD).toHaveBeenCalledTimes(1);
    expect(spyW).toHaveBeenCalledTimes(1);

    form = { ...form, pricePerPackage: "18500" };
    memoD.commit(derivedDeps(item, form), () => spyD(inp(item, form)));
    memoW.commit(warningsDeps(item, form), () =>
      spyW({ mode: "existing", selectedItem: item, derived: memoD.value, priceMode: form.priceMode, inputKarton: form.inputKarton }),
    );
    expect(spyD).toHaveBeenCalledTimes(2);
    expect(spyW).toHaveBeenCalledTimes(1);
  });

  it("beruntun: 20 pergeseran packageQty → derived=21, warnings=1", () => {
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
    let form: Form = { ...BASE_FORM };

    const memoD = createMemo({ deps: derivedDeps(item, form), factory: () => spyD(inp(item, form)) });
    const memoW = createMemo({
      deps: warningsDeps(item, form),
      factory: () =>
        spyW({ mode: "existing", selectedItem: item, derived: memoD.value, priceMode: form.priceMode, inputKarton: form.inputKarton }),
    });

    for (let i = 1; i <= 20; i++) {
      form = { ...form, packageQty: String(2 + i) };
      memoD.commit(derivedDeps(item, form), () => spyD(inp(item, form)));
      memoW.commit(warningsDeps(item, form), () =>
        spyW({ mode: "existing", selectedItem: item, derived: memoD.value, priceMode: form.priceMode, inputKarton: form.inputKarton }),
      );
    }
    expect(spyD).toHaveBeenCalledTimes(1 + 20);
    expect(spyW).toHaveBeenCalledTimes(1);
  });

  it("newPackageSize + pricePerBase interleave: setiap perubahan menaikkan derived saja, warnings tetap 1", () => {
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);

    const item: Item = {
      id: "gram-1000",
      package_type: "gram",
      package_size: 1000,
      base_unit: "g",
      stock_base: 5_000,
      avg_cost_per_base: 15,
    };
    let form: Form = { ...BASE_FORM };

    const memoD = createMemo({ deps: derivedDeps(item, form), factory: () => spyD(inp(item, form)) });
    const memoW = createMemo({
      deps: warningsDeps(item, form),
      factory: () =>
        spyW({ mode: "existing", selectedItem: item, derived: memoD.value, priceMode: form.priceMode, inputKarton: form.inputKarton }),
    });

    // 5 pasang: newPackageSize lalu pricePerBase.
    let expectedD = 1;
    for (let i = 1; i <= 5; i++) {
      form = { ...form, newPackageSize: String(500 + i * 100) };
      memoD.commit(derivedDeps(item, form), () => spyD(inp(item, form)));
      memoW.commit(warningsDeps(item, form), () =>
        spyW({ mode: "existing", selectedItem: item, derived: memoD.value, priceMode: form.priceMode, inputKarton: form.inputKarton }),
      );
      expectedD++;
      form = { ...form, pricePerBase: String(i * 3) };
      memoD.commit(derivedDeps(item, form), () => spyD(inp(item, form)));
      memoW.commit(warningsDeps(item, form), () =>
        spyW({ mode: "existing", selectedItem: item, derived: memoD.value, priceMode: form.priceMode, inputKarton: form.inputKarton }),
      );
      expectedD++;
    }
    expect(spyD).toHaveBeenCalledTimes(expectedD);
    expect(spyW).toHaveBeenCalledTimes(1);
  });

  it("kontrol positif akhir: setelah derived burst, 1 perubahan stock_base → warnings naik ke 2, derived tidak", () => {
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
    let form: Form = { ...BASE_FORM };

    const memoD = createMemo({ deps: derivedDeps(item, form), factory: () => spyD(inp(item, form)) });
    const memoW = createMemo({
      deps: warningsDeps(item, form),
      factory: () =>
        spyW({ mode: "existing", selectedItem: item, derived: memoD.value, priceMode: form.priceMode, inputKarton: form.inputKarton }),
    });

    // 8 refetch: hanya scalar form (pricePerPackage) → derived saja yang naik.
    for (let i = 1; i <= 8; i++) {
      form = { ...form, pricePerPackage: String(10_000 + i * 250) };
      memoD.commit(derivedDeps(item, form), () => spyD(inp(item, form)));
      memoW.commit(warningsDeps(item, form), () =>
        spyW({ mode: "existing", selectedItem: item, derived: memoD.value, priceMode: form.priceMode, inputKarton: form.inputKarton }),
      );
    }
    expect(spyD).toHaveBeenCalledTimes(1 + 8);
    expect(spyW).toHaveBeenCalledTimes(1);

    // Ubah stock_base → efektif untuk warnings, tidak untuk derived.
    item = { ...item, stock_base: 22_000 };
    memoD.commit(derivedDeps(item, form), () => spyD(inp(item, form)));
    memoW.commit(warningsDeps(item, form), () =>
      spyW({ mode: "existing", selectedItem: item, derived: memoD.value, priceMode: form.priceMode, inputKarton: form.inputKarton }),
    );
    expect(spyD).toHaveBeenCalledTimes(1 + 8);
    expect(spyW).toHaveBeenCalledTimes(2);
  });
});