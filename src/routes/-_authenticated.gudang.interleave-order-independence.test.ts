import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeBeliDerived as realComputeDerived,
  __resetBeliDerivedMemo,
  type BeliDerivedInput,
} from "@/lib/beli-derived";
import { computeBeliWarnings as realComputeWarnings } from "@/lib/beli-warnings";

// ============================================================
// Order-independence: interleave dengan urutan berbeda pada SET
// perubahan yang SAMA harus menghasilkan jumlah recompute yang
// sama untuk `computeBeliDerived` dan `computeBeliWarnings`, serta
// output akhir yang deterministik (deep-equal). Mengunci absennya
// efek samping urutan pada pipeline memo.
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

type Mutation = { kind: "item"; patch: Partial<Item> } | { kind: "form"; patch: Partial<Form> };

function runSequence(mutations: readonly Mutation[]) {
  const spyD = vi.fn(realComputeDerived);
  const spyW = vi.fn(realComputeWarnings);
  let item: Item = { ...BASE_ITEM };
  let form: Form = { ...BASE_FORM };

  const memoD = createMemo({
    deps: derivedDeps(item, form),
    factory: () => spyD(inp(item, form)),
  });
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

  for (const m of mutations) {
    if (m.kind === "item") item = { ...item, ...m.patch };
    else form = { ...form, ...m.patch };
    memoD.commit(derivedDeps(item, form), () => spyD(inp(item, form)));
    memoW.commit(warningsDeps(item, form), () =>
      spyW({
        mode: "existing",
        selectedItem: item,
        derived: memoD.value,
        priceMode: form.priceMode,
        inputKarton: form.inputKarton,
      }),
    );
  }

  return {
    derivedCalls: spyD.mock.calls.length,
    warningsCalls: spyW.mock.calls.length,
    finalDerived: memoD.value,
    finalWarnings: memoW.value,
    finalItem: item,
    finalForm: form,
  };
}

function permute<T>(arr: readonly T[]): T[][] {
  if (arr.length <= 1) return [arr.slice()];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permute(rest)) out.push([arr[i], ...p]);
  }
  return out;
}

beforeEach(() => {
  __resetBeliDerivedMemo();
});

describe("interleave order-independence — hitungan & output tidak bergantung urutan", () => {
  it("4 mutasi unik disjoint (item+form): semua 24 permutasi menghasilkan hitungan & output identik", () => {
    const mutations: Mutation[] = [
      { kind: "item", patch: { package_type: "gram" } },
      { kind: "item", patch: { package_size: 750 } },
      { kind: "form", patch: { priceMode: "base" } },
      { kind: "form", patch: { inputKarton: true } },
    ];
    const permutations = permute(mutations);
    expect(permutations).toHaveLength(24);

    const results = permutations.map(runSequence);
    const first = results[0];
    // 1 (initial) + 4 mutasi unik = 5 recompute untuk keduanya.
    expect(first.derivedCalls).toBe(5);
    expect(first.warningsCalls).toBe(5);
    for (const r of results) {
      expect(r.derivedCalls).toBe(first.derivedCalls);
      expect(r.warningsCalls).toBe(first.warningsCalls);
      expect(r.finalDerived).toEqual(first.finalDerived);
      expect(r.finalWarnings).toEqual(first.finalWarnings);
      expect(r.finalItem).toEqual(first.finalItem);
      expect(r.finalForm).toEqual(first.finalForm);
    }
  });

  it("5 mutasi termasuk field warnings-only (stock_base): semua 120 permutasi konsisten", () => {
    const mutations: Mutation[] = [
      { kind: "item", patch: { package_type: "gram" } },
      { kind: "item", patch: { base_unit: "pcs" } },
      { kind: "item", patch: { stock_base: 20_000 } }, // warnings-only
      { kind: "form", patch: { priceMode: "base" } },
      { kind: "form", patch: { inputKarton: true } },
    ];
    const permutations = permute(mutations);
    expect(permutations).toHaveLength(120);

    const results = permutations.map(runSequence);
    const first = results[0];
    // derived: 1 + 4 (bersama; stock_base tak memengaruhi) = 5
    // warnings: 1 + 5 = 6
    expect(first.derivedCalls).toBe(5);
    expect(first.warningsCalls).toBe(6);
    for (const r of results) {
      expect(r.derivedCalls).toBe(first.derivedCalls);
      expect(r.warningsCalls).toBe(first.warningsCalls);
      expect(r.finalDerived).toEqual(first.finalDerived);
      expect(r.finalWarnings).toEqual(first.finalWarnings);
    }
  });

  it("duplikat semantik di tengah tidak menaikkan hitungan meski posisinya berbeda", () => {
    // A: gram → botol → gram (kembali). B: gram → gram → botol. Keduanya
    // memiliki set transisi unik yang berbeda; kami memakai dua sekuens
    // dengan JUMLAH transisi efektif yang sama untuk membandingkan.
    const seqA: Mutation[] = [
      { kind: "item", patch: { package_type: "gram" } },
      { kind: "item", patch: { package_type: "gram" } }, // no-op semantik
      { kind: "item", patch: { package_type: "botol" } },
    ];
    const seqB: Mutation[] = [
      { kind: "item", patch: { package_type: "gram" } },
      { kind: "item", patch: { package_type: "botol" } },
      { kind: "item", patch: { package_type: "botol" } }, // no-op semantik
    ];
    const a = runSequence(seqA);
    const b = runSequence(seqB);
    // 1 (initial) + 2 transisi efektif = 3 untuk keduanya.
    expect(a.derivedCalls).toBe(3);
    expect(a.warningsCalls).toBe(3);
    expect(b.derivedCalls).toBe(3);
    expect(b.warningsCalls).toBe(3);
    expect(a.finalDerived).toEqual(b.finalDerived);
    expect(a.finalWarnings).toEqual(b.finalWarnings);
  });

  it("shuffle acak deterministik 3 seed × 6 mutasi: hitungan & output final tetap sama", () => {
    const mutations: Mutation[] = [
      { kind: "item", patch: { id: "botol-500-b" } },
      { kind: "item", patch: { package_type: "sachet" } },
      { kind: "item", patch: { package_size: 250 } },
      { kind: "item", patch: { base_unit: "pcs" } },
      { kind: "form", patch: { priceMode: "base" } },
      { kind: "form", patch: { inputKarton: true } },
    ];
    // LCG PRNG deterministik.
    function shuffle<T>(arr: readonly T[], seed: number): T[] {
      const a = arr.slice();
      let s = seed;
      for (let i = a.length - 1; i > 0; i--) {
        s = (s * 1664525 + 1013904223) >>> 0;
        const j = s % (i + 1);
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    const seeds = [1, 42, 9999];
    const results = seeds.map((s) => runSequence(shuffle(mutations, s)));
    const first = results[0];
    // 1 + 6 unik = 7 untuk keduanya.
    expect(first.derivedCalls).toBe(7);
    expect(first.warningsCalls).toBe(7);
    for (const r of results) {
      expect(r.derivedCalls).toBe(first.derivedCalls);
      expect(r.warningsCalls).toBe(first.warningsCalls);
      expect(r.finalDerived).toEqual(first.finalDerived);
      expect(r.finalWarnings).toEqual(first.finalWarnings);
      expect(r.finalItem).toEqual(first.finalItem);
      expect(r.finalForm).toEqual(first.finalForm);
    }
  });
});