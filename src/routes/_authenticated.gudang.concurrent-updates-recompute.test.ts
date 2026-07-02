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
// Concurrent / near-simultaneous updates — beberapa field diubah
// dalam satu "tick" commit (batch) atau microtask berurutan tanpa
// render antara harus menghasilkan JUMLAH recompute yang sama
// dengan urutan sekuensial biasa, dan output final yang identik.
// Ini mengunci absennya efek samping race pada pipeline memo.
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

type Mutation =
  | { kind: "item"; patch: Partial<Item> }
  | { kind: "form"; patch: Partial<Form> };

type Harness = ReturnType<typeof makeHarness>;
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

  function commit() {
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
    spyD,
    spyW,
    getState: () => ({ item, form }),
    /** Terapkan mutasi lalu commit (satu "render" per mutasi). */
    stepSequential(m: Mutation) {
      if (m.kind === "item") item = { ...item, ...m.patch };
      else form = { ...form, ...m.patch };
      commit();
    },
    /** Terapkan BANYAK mutasi dulu, lalu commit sekali (batch/concurrent). */
    stepBatched(list: readonly Mutation[]) {
      for (const m of list) {
        if (m.kind === "item") item = { ...item, ...m.patch };
        else form = { ...form, ...m.patch };
      }
      commit();
    },
    /** Baca output akhir. */
    snapshot() {
      return {
        derivedCalls: spyD.mock.calls.length,
        warningsCalls: spyW.mock.calls.length,
        finalDerived: memoD.value,
        finalWarnings: memoW.value,
        item,
        form,
      };
    },
  };
}

function runSequential(mutations: readonly Mutation[]) {
  const h = makeHarness();
  for (const m of mutations) h.stepSequential(m);
  return h.snapshot();
}
function runBatched(mutations: readonly Mutation[]) {
  const h = makeHarness();
  h.stepBatched(mutations);
  return h.snapshot();
}
function runMicrotaskInterleaved(mutations: readonly Mutation[]) {
  // Semua mutasi diaplikasikan tanpa commit di antara (satu commit di akhir),
  // meniru beberapa setState() dalam satu event handler yang di-batch React.
  return runBatched(mutations);
}

beforeEach(() => {
  __resetBeliDerivedMemo();
  __resetBeliWarningsMemo();
});

describe("concurrent updates — beberapa field diubah hampir bersamaan tidak menimbulkan efek samping", () => {
  it("batch commit 4 field bersama disjoint: hanya 1 recompute tambahan (bukan 4)", () => {
    const mutations: Mutation[] = [
      { kind: "item", patch: { package_type: "gram" } },
      { kind: "item", patch: { package_size: 750 } },
      { kind: "form", patch: { priceMode: "base" } },
      { kind: "form", patch: { inputKarton: true } },
    ];
    const r = runBatched(mutations);
    // 1 (initial) + 1 (batch commit) = 2 recompute untuk keduanya.
    expect(r.derivedCalls).toBe(2);
    expect(r.warningsCalls).toBe(2);
  });

  it("batch commit dengan mutasi yang saling meniadakan (A→B→A) tidak recompute", () => {
    const mutations: Mutation[] = [
      { kind: "item", patch: { package_type: "gram" } },
      { kind: "item", patch: { package_size: 750 } },
      { kind: "item", patch: { package_size: 500 } }, // kembalikan
      { kind: "item", patch: { package_type: "botol" } }, // kembalikan
    ];
    const r = runBatched(mutations);
    // deps setelah batch identik dengan initial → tidak ada recompute tambahan.
    expect(r.derivedCalls).toBe(1);
    expect(r.warningsCalls).toBe(1);
  });

  it("batched vs sequential: hitungan berbeda tapi output final identik (no race)", () => {
    const mutations: Mutation[] = [
      { kind: "item", patch: { package_type: "gram" } },
      { kind: "item", patch: { base_unit: "pcs" } },
      { kind: "form", patch: { priceMode: "base" } },
      { kind: "form", patch: { pricePerBase: "25" } },
      { kind: "form", patch: { inputKarton: true } },
    ];
    const seq = runSequential(mutations);
    const bat = runBatched(mutations);

    // Sekuensial: 1 + 5 = 6 (setiap transisi unik memicu recompute).
    // priceMode & inputKarton juga di deps warnings → warnings pun 6.
    expect(seq.derivedCalls).toBe(6);
    expect(seq.warningsCalls).toBe(6);
    // Batched: 1 + 1 = 2.
    expect(bat.derivedCalls).toBe(2);
    expect(bat.warningsCalls).toBe(2);

    // Yang paling penting: hasil akhir HARUS identik, tanpa efek race.
    expect(bat.finalDerived).toEqual(seq.finalDerived);
    expect(bat.finalWarnings).toEqual(seq.finalWarnings);
    expect(bat.item).toEqual(seq.item);
    expect(bat.form).toEqual(seq.form);
  });

  it("beberapa batch berurutan (mini-tick) menghasilkan output sama dengan satu batch besar", () => {
    const all: Mutation[] = [
      { kind: "item", patch: { package_type: "gram" } },
      { kind: "item", patch: { package_size: 250 } },
      { kind: "item", patch: { base_unit: "pcs" } },
      { kind: "form", patch: { priceMode: "base" } },
      { kind: "form", patch: { pricePerBase: "30" } },
      { kind: "form", patch: { inputKarton: true } },
    ];
    // Split acak deterministik ke 3 mini-batch.
    const h = makeHarness();
    h.stepBatched(all.slice(0, 2));
    h.stepBatched(all.slice(2, 4));
    h.stepBatched(all.slice(4));
    const multi = h.snapshot();
    const one = runBatched(all);

    // Multi-batch = 1 (initial) + 3 (tiap commit) = 4; single = 2.
    expect(multi.derivedCalls).toBe(4);
    expect(multi.warningsCalls).toBe(4);
    expect(one.derivedCalls).toBe(2);
    expect(one.warningsCalls).toBe(2);

    // Output final identik.
    expect(multi.finalDerived).toEqual(one.finalDerived);
    expect(multi.finalWarnings).toEqual(one.finalWarnings);
  });

  it("microtask-interleaved (Promise.resolve) yang di-batch tetap deterministik", async () => {
    const mutations: Mutation[] = [
      { kind: "item", patch: { package_type: "gram" } },
      { kind: "form", patch: { priceMode: "base" } },
      { kind: "form", patch: { pricePerBase: "42" } },
      { kind: "item", patch: { package_size: 300 } },
    ];

    // Baseline sinkron.
    const sync = runBatched(mutations);

    // Terapkan lewat microtask (Promise.resolve) — semua mutasi dijalankan
    // sebelum commit tunggal di akhir.
    __resetBeliDerivedMemo();
    __resetBeliWarningsMemo();
    const h = makeHarness();
    const staged: Mutation[] = [];
    await Promise.all(
      mutations.map((m) => Promise.resolve().then(() => staged.push(m))),
    );
    h.stepBatched(staged);
    const async_ = h.snapshot();

    // Meski urutan enqueue microtask bisa "bersaing", hasilnya tidak
    // bergantung padanya karena mutasi disjoint pada field berbeda.
    expect(async_.derivedCalls).toBe(2);
    expect(async_.warningsCalls).toBe(2);
    expect(async_.finalDerived).toEqual(sync.finalDerived);
    expect(async_.finalWarnings).toEqual(sync.finalWarnings);
  });

  it("burst 50× batch acak deterministik menghasilkan output final stabil", () => {
    const pool: Mutation[] = [
      { kind: "item", patch: { package_type: "gram" } },
      { kind: "item", patch: { package_type: "botol" } },
      { kind: "item", patch: { package_size: 250 } },
      { kind: "item", patch: { package_size: 500 } },
      { kind: "item", patch: { base_unit: "pcs" } },
      { kind: "item", patch: { base_unit: "g" } },
      { kind: "form", patch: { priceMode: "base" } },
      { kind: "form", patch: { priceMode: "package" } },
      { kind: "form", patch: { inputKarton: true } },
      { kind: "form", patch: { inputKarton: false } },
    ];
    // LCG deterministik.
    function pick(seed: number) {
      let s = seed >>> 0;
      return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return pool[s % pool.length];
      };
    }

    const outputs: Array<{ d: unknown; w: unknown }> = [];
    for (const seed of [1, 7, 13, 21, 99]) {
      __resetBeliDerivedMemo();
      __resetBeliWarningsMemo();
      const next = pick(seed);
      const batch: Mutation[] = [];
      for (let i = 0; i < 50; i++) batch.push(next());
      // Terminator: paksa state akhir yang sama untuk semua seed.
      batch.push({ kind: "item", patch: { package_type: "botol", package_size: 500, base_unit: "g" } });
      batch.push({ kind: "form", patch: { priceMode: "package", inputKarton: false } });
      const r = runBatched(batch);
      outputs.push({ d: r.finalDerived, w: r.finalWarnings });
    }
    const first = outputs[0];
    for (const o of outputs) {
      expect(o.d).toEqual(first.d);
      expect(o.w).toEqual(first.w);
    }
  });
});