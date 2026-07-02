import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeBeliDerived as realComputeDerived,
  __resetBeliDerivedMemo,
  type BeliDerivedInput,
} from "@/lib/beli-derived";
import { computeBeliWarnings as realComputeWarnings } from "@/lib/beli-warnings";

// ============================================================
// Verifikasi SIMETRI recompute: field yang MEMENGARUHI KEDUANYA
// (item.id, package_type, package_size, base_unit, priceMode, inputKarton)
// berubah → BAIK computeBeliDerived MAUPUN computeBeliWarnings naik TEPAT +1
// per transisi. Mengunci sisi ketiga dari asimetri (derived-only,
// warnings-only) menjadi triad lengkap.
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
      spyW({ mode: "existing", selectedItem: item, derived: memoD.value, priceMode: form.priceMode, inputKarton: form.inputKarton }),
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

describe("simetri recompute — derived & warnings sama-sama naik pada field bersama", () => {
  const baseItem: Item = {
    id: "botol-500",
    package_type: "botol",
    package_size: 500,
    base_unit: "g",
    stock_base: 10_000,
    avg_cost_per_base: 20,
  };

  it("package_type berubah 1×: derived=2, warnings=2", () => {
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);
    let item = baseItem;
    const form = { ...BASE_FORM };
    const pair = makePair(item, form, spyD, spyW);
    expect(spyD).toHaveBeenCalledTimes(1);
    expect(spyW).toHaveBeenCalledTimes(1);

    item = { ...item, package_type: "gram" };
    pair.commit(item, form);
    expect(spyD).toHaveBeenCalledTimes(2);
    expect(spyW).toHaveBeenCalledTimes(2);
  });

  it("package_size berubah 1×: derived=2, warnings=2", () => {
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);
    let item = baseItem;
    const form = { ...BASE_FORM };
    const pair = makePair(item, form, spyD, spyW);

    item = { ...item, package_size: 750 };
    pair.commit(item, form);
    expect(spyD).toHaveBeenCalledTimes(2);
    expect(spyW).toHaveBeenCalledTimes(2);
  });

  it("base_unit berubah 1×: derived=2, warnings=2", () => {
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);
    let item = baseItem;
    const form = { ...BASE_FORM };
    const pair = makePair(item, form, spyD, spyW);

    item = { ...item, base_unit: "pcs" };
    pair.commit(item, form);
    expect(spyD).toHaveBeenCalledTimes(2);
    expect(spyW).toHaveBeenCalledTimes(2);
  });

  it("item.id berubah 1×: derived=2, warnings=2", () => {
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);
    let item = baseItem;
    const form = { ...BASE_FORM };
    const pair = makePair(item, form, spyD, spyW);

    item = { ...item, id: "botol-500-b" };
    pair.commit(item, form);
    expect(spyD).toHaveBeenCalledTimes(2);
    expect(spyW).toHaveBeenCalledTimes(2);
  });

  it("priceMode flip 1×: derived=2, warnings=2", () => {
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);
    const item = baseItem;
    let form = { ...BASE_FORM };
    const pair = makePair(item, form, spyD, spyW);

    form = { ...form, priceMode: "base" };
    pair.commit(item, form);
    expect(spyD).toHaveBeenCalledTimes(2);
    expect(spyW).toHaveBeenCalledTimes(2);
  });

  it("inputKarton flip 1×: derived=2, warnings=2", () => {
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);
    const item = baseItem;
    let form = { ...BASE_FORM };
    const pair = makePair(item, form, spyD, spyW);

    form = { ...form, inputKarton: true };
    pair.commit(item, form);
    expect(spyD).toHaveBeenCalledTimes(2);
    expect(spyW).toHaveBeenCalledTimes(2);
  });

  it("beruntun: 10 pergeseran package_size unik → derived=11, warnings=11", () => {
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);
    let item = baseItem;
    const form = { ...BASE_FORM };
    const pair = makePair(item, form, spyD, spyW);

    for (let i = 1; i <= 10; i++) {
      item = { ...item, package_size: 500 + i * 50 };
      pair.commit(item, form);
    }
    expect(spyD).toHaveBeenCalledTimes(11);
    expect(spyW).toHaveBeenCalledTimes(11);
  });

  it("interleave 4 field bersama: derived & warnings identik pada tiap langkah", () => {
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);
    let item = baseItem;
    let form = { ...BASE_FORM };
    const pair = makePair(item, form, spyD, spyW);

    const steps: Array<() => void> = [
      () => { item = { ...item, package_type: "gram" }; },
      () => { item = { ...item, package_size: 750 }; },
      () => { form = { ...form, priceMode: "base" }; },
      () => { form = { ...form, inputKarton: true }; },
      () => { item = { ...item, base_unit: "pcs" }; },
      () => { item = { ...item, id: "gram-750-b" }; },
      () => { form = { ...form, priceMode: "package" }; },
      () => { form = { ...form, inputKarton: false }; },
    ];
    for (const s of steps) {
      s();
      pair.commit(item, form);
      expect(spyD).toHaveBeenCalledTimes(spyW.mock.calls.length);
    }
    expect(spyD).toHaveBeenCalledTimes(1 + steps.length);
    expect(spyW).toHaveBeenCalledTimes(1 + steps.length);
  });

  it("no-op: commit ulang tanpa perubahan tidak menaikkan salah satu", () => {
    const spyD = vi.fn(realComputeDerived);
    const spyW = vi.fn(realComputeWarnings);
    const item = baseItem;
    const form = { ...BASE_FORM };
    const pair = makePair(item, form, spyD, spyW);
    for (let i = 0; i < 5; i++) pair.commit(item, form);
    expect(spyD).toHaveBeenCalledTimes(1);
    expect(spyW).toHaveBeenCalledTimes(1);
  });
});