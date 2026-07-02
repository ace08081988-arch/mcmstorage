import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeBeliDerived as realComputeDerived,
  __resetBeliDerivedMemo,
  type BeliDerivedInput,
} from "@/lib/beli-derived";
import {
  computeBeliWarnings as realComputeWarnings,
  __resetBeliWarningsMemo,
} from "@/lib/beli-warnings";

// ============================================================
// Conflicting concurrent updates — beberapa mutasi menyentuh
// field YANG SAMA (tumpang tindih) dalam satu batch commit.
// Harapan: hanya nilai TERAKHIR yang berlaku, dan pipeline hanya
// meningkat 1× per fungsi (tanpa double-recompute akibat konflik).
// Mengunci semantik "last-write-wins" pada batch tanpa efek samping
// intermediate pada memo derived/warnings.
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
const BASE_ITEM: Item = {
  id: "botol-500",
  package_type: "botol",
  package_size: 500,
  base_unit: "g",
  stock_base: 10_000,
  avg_cost_per_base: 20,
};

function inp(item: Item, form: Form): BeliDerivedInput {
  return {
    mode: "existing",
    selectedItem: item,
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
function warningsDeps(item: Item, form: Form, derived: unknown): readonly unknown[] {
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
    derived,
  ] as const;
}

type Mutation =
  | { kind: "item"; patch: Partial<Item> }
  | { kind: "form"; patch: Partial<Form> };

function makeHarness() {
  const spyD = vi.fn(realComputeDerived);
  const spyW = vi.fn(realComputeWarnings);
  let item: Item = { ...BASE_ITEM };
  let form: Form = { ...BASE_FORM };

  const memoD = createMemo({
    deps: derivedDeps(item, form),
    factory: () => spyD(inp(item, form)),
  });
  const memoW = createMemo({
    deps: warningsDeps(item, form, undefined),
    factory: () =>
      spyW({
        mode: "existing",
        selectedItem: item,
        derived: memoD.value,
        priceMode: form.priceMode,
        inputKarton: form.inputKarton,
      }),
  });

  const initialD = spyD.mock.calls.length;
  const initialW = spyW.mock.calls.length;

  function commit() {
    memoD.commit(derivedDeps(item, form), () => spyD(inp(item, form)));
    memoW.commit(warningsDeps(item, form, memoD.value), () =>
      spyW({
        mode: "existing",
        selectedItem: item,
        derived: memoD.value,
        priceMode: form.priceMode,
        inputKarton: form.inputKarton,
      }),
    );
  }

  function apply(m: Mutation) {
    if (m.kind === "item") item = { ...item, ...m.patch };
    else form = { ...form, ...m.patch };
  }

  return {
    stepBatched(list: readonly Mutation[]) {
      for (const m of list) apply(m);
      commit();
    },
    stepSequential(m: Mutation) {
      apply(m);
      commit();
    },
    snapshot() {
      return {
        derivedCallsSinceInit: spyD.mock.calls.length - initialD,
        warningsCallsSinceInit: spyW.mock.calls.length - initialW,
        finalDerived: memoD.value,
        finalWarnings: memoW.value,
        item,
        form,
      };
    },
  };
}

describe("conflicting concurrent updates — last-write-wins, tanpa double-recompute", () => {
  beforeEach(() => {
    __resetBeliDerivedMemo();
    __resetBeliWarningsMemo();
  });

  it("dua patch pada field derived yang sama (packageQty) dalam satu batch → 1 recompute derived", () => {
    const h = makeHarness();
    h.stepBatched([
      { kind: "form", patch: { packageQty: "5" } },
      { kind: "form", patch: { packageQty: "9" } },
      { kind: "form", patch: { packageQty: "12" } },
    ]);
    const s = h.snapshot();
    expect(s.form.packageQty).toBe("12");
    expect(s.derivedCallsSinceInit).toBe(1);
    expect(s.warningsCallsSinceInit).toBe(1);
  });

  it("tumpang tindih derived + warnings field (pricePerPackage + avg_cost_per_base) → 1 recompute masing-masing", () => {
    const h = makeHarness();
    h.stepBatched([
      { kind: "form", patch: { pricePerPackage: "20000" } },
      { kind: "item", patch: { avg_cost_per_base: 30 } },
      { kind: "form", patch: { pricePerPackage: "35000" } },
      { kind: "item", patch: { avg_cost_per_base: 45 } },
      { kind: "form", patch: { pricePerPackage: "50000" } },
      { kind: "item", patch: { avg_cost_per_base: 60 } },
    ]);
    const s = h.snapshot();
    expect(s.form.pricePerPackage).toBe("50000");
    expect(s.item.avg_cost_per_base).toBe(60);
    expect(s.derivedCallsSinceInit).toBe(1);
    expect(s.warningsCallsSinceInit).toBe(1);
  });

  it("konflik yang KEMBALI ke nilai awal → 0 recompute (no-op net change)", () => {
    const h = makeHarness();
    h.stepBatched([
      { kind: "form", patch: { packageQty: "5" } },
      { kind: "form", patch: { packageQty: "9" } },
      { kind: "form", patch: { packageQty: BASE_FORM.packageQty } },
    ]);
    const s = h.snapshot();
    expect(s.form.packageQty).toBe(BASE_FORM.packageQty);
    expect(s.derivedCallsSinceInit).toBe(0);
    expect(s.warningsCallsSinceInit).toBe(0);
  });

  it("konflik lintas kategori (derived + warnings-only) diselesaikan sekali commit → 1+1 recompute", () => {
    const h = makeHarness();
    h.stepBatched([
      { kind: "form", patch: { pricePerPackage: "12345" } },
      { kind: "item", patch: { stock_base: 500 } },
      { kind: "form", patch: { pricePerPackage: "22222" } },
      { kind: "item", patch: { stock_base: 250 } },
      { kind: "form", patch: { pricePerPackage: "33333" } },
      { kind: "item", patch: { stock_base: 125 } },
    ]);
    const s = h.snapshot();
    expect(s.form.pricePerPackage).toBe("33333");
    expect(s.item.stock_base).toBe(125);
    expect(s.derivedCallsSinceInit).toBe(1);
    expect(s.warningsCallsSinceInit).toBe(1);
  });

  it("batched conflicting ≡ sequential (nilai final terakhir) untuk output derived+warnings", () => {
    const mutations: Mutation[] = [
      { kind: "form", patch: { packageQty: "3" } },
      { kind: "form", patch: { pricePerPackage: "15000" } },
      { kind: "form", patch: { packageQty: "7" } },
      { kind: "item", patch: { avg_cost_per_base: 25 } },
      { kind: "form", patch: { pricePerPackage: "40000" } },
      { kind: "form", patch: { packageQty: "11" } },
      { kind: "item", patch: { avg_cost_per_base: 55 } },
      { kind: "form", patch: { priceMode: "base" } },
      { kind: "form", patch: { pricePerBase: "125" } },
      { kind: "form", patch: { priceMode: "package" } },
      { kind: "form", patch: { pricePerPackage: "77777" } },
    ];

    const seq = makeHarness();
    for (const m of mutations) seq.stepSequential(m);
    const sSeq = seq.snapshot();

    const bat = makeHarness();
    bat.stepBatched(mutations);
    const sBat = bat.snapshot();

    expect(sBat.item).toEqual(sSeq.item);
    expect(sBat.form).toEqual(sSeq.form);
    expect(sBat.finalDerived).toEqual(sSeq.finalDerived);
    expect(sBat.finalWarnings).toEqual(sSeq.finalWarnings);

    // Batched: tepat 1 recompute per fungsi walau ada banyak konflik.
    expect(sBat.derivedCallsSinceInit).toBe(1);
    expect(sBat.warningsCallsSinceInit).toBe(1);

    // Sequential: tidak melebihi jumlah mutasi.
    expect(sSeq.derivedCallsSinceInit).toBeLessThanOrEqual(mutations.length);
    expect(sSeq.warningsCallsSinceInit).toBeLessThanOrEqual(mutations.length);
  });

  it("konflik hanya di warnings-only field (stock_base) → 0 derived, 1 warnings", () => {
    const h = makeHarness();
    h.stepBatched([
      { kind: "item", patch: { stock_base: 1 } },
      { kind: "item", patch: { stock_base: 2 } },
      { kind: "item", patch: { stock_base: 3 } },
      { kind: "item", patch: { stock_base: 4 } },
    ]);
    const s = h.snapshot();
    expect(s.item.stock_base).toBe(4);
    expect(s.derivedCallsSinceInit).toBe(0);
    expect(s.warningsCallsSinceInit).toBe(1);
  });
});