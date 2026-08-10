import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeBeliDerived as realComputeDerived,
  __resetBeliDerivedMemo,
  type BeliDerivedInput,
} from "@/lib/beli-derived";
import { computeBeliWarnings as realComputeWarnings } from "@/lib/beli-warnings";

// ============================================================
// Fokus: mengunci perilaku "single shared field" — saat HANYA
// SATU field bersama diubah pada satu waktu, `computeBeliDerived`
// dan `computeBeliWarnings` sama-sama naik TEPAT +1 per transisi
// (dan tidak naik jika commit ulang tanpa perubahan).
//
// Melengkapi `shared-fields-recompute.test.ts` yang mencakup
// interleave/burst; di sini kami menguji setiap field bersama
// secara terisolasi melalui SERI beberapa transisi berturut-turut.
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

function makePair(
  item: Item,
  form: Form,
  spyD: (i: BeliDerivedInput) => ReturnType<typeof realComputeDerived>,
  spyW: (i: Parameters<typeof realComputeWarnings>[0]) => ReturnType<typeof realComputeWarnings>,
) {
  const memoD = createMemo({ deps: derivedDeps(item, form), factory: () => spyD(inp(item, form)) });
  const memoW = createMemo({
    deps: warningsDeps(item, form),
    factory: () =>
      spyW({
        mode: "existing",
        selectedItem: item,
        derived: memoD.value,
        priceMode: form.priceMode,
        inputKarton: form.inputKarton,
      }),
  });
  return {
    commit(nextItem: Item, nextForm: Form) {
      memoD.commit(derivedDeps(nextItem, nextForm), () => spyD(inp(nextItem, nextForm)));
      memoW.commit(warningsDeps(nextItem, nextForm), () =>
        spyW({
          mode: "existing",
          selectedItem: nextItem,
          derived: memoD.value,
          priceMode: nextForm.priceMode,
          inputKarton: nextForm.inputKarton,
        }),
      );
    },
  };
}

beforeEach(() => {
  __resetBeliDerivedMemo();
});

const BASE_ITEM: Item = {
  id: "botol-500",
  package_type: "botol",
  package_size: 500,
  base_unit: "g",
  stock_base: 10_000,
  avg_cost_per_base: 20,
};

describe("single-shared-field: derived & warnings sama-sama naik +1 per transisi terisolasi", () => {
  it("package_type: 3 transisi unik → derived=4, warnings=4", () => {
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);
    let item = BASE_ITEM;
    const form = { ...BASE_FORM };
    const pair = makePair(item, form, spyD, spyW);
    expect(spyD).toHaveBeenCalledTimes(1);
    expect(spyW).toHaveBeenCalledTimes(1);

    const seq: Item["package_type"][] = ["gram", "pcs", "sachet"];
    for (const pt of seq) {
      item = { ...item, package_type: pt };
      pair.commit(item, form);
    }
    expect(spyD).toHaveBeenCalledTimes(4);
    expect(spyW).toHaveBeenCalledTimes(4);
  });

  it("base_unit: 2 transisi unik (g↔pcs) → derived=3, warnings=3", () => {
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);
    let item = BASE_ITEM;
    const form = { ...BASE_FORM };
    const pair = makePair(item, form, spyD, spyW);

    item = { ...item, base_unit: "pcs" };
    pair.commit(item, form);
    item = { ...item, base_unit: "g" };
    pair.commit(item, form);

    expect(spyD).toHaveBeenCalledTimes(3);
    expect(spyW).toHaveBeenCalledTimes(3);
  });

  it("package_size: 5 transisi unik → derived=6, warnings=6", () => {
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);
    let item = BASE_ITEM;
    const form = { ...BASE_FORM };
    const pair = makePair(item, form, spyD, spyW);

    for (let i = 1; i <= 5; i++) {
      item = { ...item, package_size: 500 + i * 100 };
      pair.commit(item, form);
    }
    expect(spyD).toHaveBeenCalledTimes(6);
    expect(spyW).toHaveBeenCalledTimes(6);
  });

  it("item.id: 4 transisi unik → derived=5, warnings=5", () => {
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);
    let item = BASE_ITEM;
    const form = { ...BASE_FORM };
    const pair = makePair(item, form, spyD, spyW);

    for (let i = 1; i <= 4; i++) {
      item = { ...item, id: `botol-500-${i}` };
      pair.commit(item, form);
    }
    expect(spyD).toHaveBeenCalledTimes(5);
    expect(spyW).toHaveBeenCalledTimes(5);
  });

  it("priceMode: 3 flip berturut (package→base→package→base) → derived=4, warnings=4", () => {
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);
    const item = BASE_ITEM;
    let form = { ...BASE_FORM };
    const pair = makePair(item, form, spyD, spyW);

    const seq: Array<"package" | "base"> = ["base", "package", "base"];
    for (const pm of seq) {
      form = { ...form, priceMode: pm };
      pair.commit(item, form);
    }
    expect(spyD).toHaveBeenCalledTimes(4);
    expect(spyW).toHaveBeenCalledTimes(4);
  });

  it("inputKarton: 2 flip (false→true→false) → derived=3, warnings=3", () => {
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);
    const item = BASE_ITEM;
    let form = { ...BASE_FORM };
    const pair = makePair(item, form, spyD, spyW);

    form = { ...form, inputKarton: true };
    pair.commit(item, form);
    form = { ...form, inputKarton: false };
    pair.commit(item, form);

    expect(spyD).toHaveBeenCalledTimes(3);
    expect(spyW).toHaveBeenCalledTimes(3);
  });

  it("commit ulang dengan nilai identik di antara transisi tidak menaikkan hitungan", () => {
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);
    let item = BASE_ITEM;
    const form = { ...BASE_FORM };
    const pair = makePair(item, form, spyD, spyW);

    // Transisi 1: package_type
    item = { ...item, package_type: "gram" };
    pair.commit(item, form);
    // 3 no-op commit
    for (let i = 0; i < 3; i++) pair.commit(item, form);
    // Transisi 2: package_size
    item = { ...item, package_size: 750 };
    pair.commit(item, form);
    // 3 no-op commit
    for (let i = 0; i < 3; i++) pair.commit(item, form);

    // 1 (initial) + 2 transisi unik = 3
    expect(spyD).toHaveBeenCalledTimes(3);
    expect(spyW).toHaveBeenCalledTimes(3);
  });

  it("set field bersama ke nilainya sendiri (no-op semantik) tidak menaikkan hitungan", () => {
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);
    let item = BASE_ITEM;
    let form = { ...BASE_FORM };
    const pair = makePair(item, form, spyD, spyW);

    // Object baru tapi nilai scalar identik → deps tetap Object.is-equal.
    item = { ...item, package_type: item.package_type, package_size: item.package_size };
    form = { ...form, priceMode: form.priceMode, inputKarton: form.inputKarton };
    pair.commit(item, form);

    expect(spyD).toHaveBeenCalledTimes(1);
    expect(spyW).toHaveBeenCalledTimes(1);
  });
});