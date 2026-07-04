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
// Konflik "lebar" — SEMUA field yang menjadi dep pipeline dimutasi
// beberapa kali dalam satu batch commit, mencampur:
//   • derived-only fields: newPackageSize, packageQty, pricePerPackage,
//     priceMode, pricePerBase, inputKarton, newPackageType (+ item id/type
//     /size/base_unit via switch item).
//   • warnings-only fields: stock_base, avg_cost_per_base.
//
// Harapan (batched):
//   - computeBeliDerived dipanggil TEPAT 1× (di luar init factory)
//   - computeBeliWarnings dipanggil TEPAT 1× (di luar init factory)
//   apapun jumlah/urutan mutasi konflik yang ditumpuk.
//
// Sequential:
//   - masing-masing ≤ jumlah mutasi (tidak ada double-recompute per commit).
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
    form.newPackageType,
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
    deps: warningsDeps(item, form, memoD.value),
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

/** Kembalikan mutasi konflik untuk SEMUA field derived + warnings. */
function buildWideConflict(rounds: number): Mutation[] {
  const list: Mutation[] = [];
  for (let r = 1; r <= rounds; r++) {
    // Derived-only fields (form).
    list.push({ kind: "form", patch: { newPackageSize: String(100 + r * 50) } });
    list.push({ kind: "form", patch: { packageQty: String(1 + r) } });
    list.push({ kind: "form", patch: { pricePerPackage: String(1000 * r) } });
    list.push({ kind: "form", patch: { priceMode: r % 2 === 0 ? "package" : "base" } });
    list.push({ kind: "form", patch: { pricePerBase: String(10 * r) } });
    list.push({ kind: "form", patch: { inputKarton: r % 2 === 0 } });
    list.push({
      kind: "form",
      patch: { newPackageType: (["botol", "gram", "pcs", "sachet"] as const)[r % 4]! },
    });
    // Derived-affecting item switch (id, package_type, package_size, base_unit).
    if (r % 2 === 0) {
      list.push({
        kind: "item",
        patch: {
          id: `gram-${r}`,
          package_type: "gram",
          package_size: 100 * r,
          base_unit: "g",
        },
      });
    } else {
      list.push({
        kind: "item",
        patch: {
          id: `pcs-${r}`,
          package_type: "pcs",
          package_size: r,
          base_unit: "pcs",
        },
      });
    }
    // Warnings-only fields.
    list.push({ kind: "item", patch: { stock_base: 500 * r } });
    list.push({ kind: "item", patch: { avg_cost_per_base: 7 * r } });
  }
  return list;
}

describe("konflik lebar — banyak field derived+warnings sekaligus, no double-recompute", () => {
  beforeEach(() => {
    __resetBeliDerivedMemo();
    __resetBeliWarningsMemo();
  });

  for (const rounds of [1, 3, 5, 10] as const) {
    it(`${rounds} ronde × 10 field per ronde (batched) → 1 derived + 1 warnings recompute`, () => {
      const mutations = buildWideConflict(rounds);
      const h = makeHarness();
      h.stepBatched(mutations);
      const s = h.snapshot();

      // Terlepas dari berapa banyak konflik ditumpuk, batched hanya menghasilkan
      // 1 recompute per fungsi (deps memo berubah 1× → commit factory 1×).
      expect(s.derivedCallsSinceInit).toBe(1);
      expect(s.warningsCallsSinceInit).toBe(1);

      // Pastikan last-write-wins berlaku pada beberapa field kunci.
      const last = mutations[mutations.length - 1]!;
      expect(last.kind).toBe("item");
      if (last.kind === "item") {
        expect(s.item.avg_cost_per_base).toBe(7 * rounds);
      }
      expect(s.item.stock_base).toBe(500 * rounds);
      expect(s.form.packageQty).toBe(String(1 + rounds));
      expect(s.form.pricePerPackage).toBe(String(1000 * rounds));
    });
  }

  it("batched ≡ sequential untuk output (item/form/finalDerived/finalWarnings) di seluruh field", () => {
    const rounds = 5;
    const mutations = buildWideConflict(rounds);

    const seq = makeHarness();
    for (const m of mutations) seq.stepSequential(m);
    const sSeq = seq.snapshot();

    __resetBeliDerivedMemo();
    __resetBeliWarningsMemo();

    const bat = makeHarness();
    bat.stepBatched(mutations);
    const sBat = bat.snapshot();

    expect(sBat.item).toEqual(sSeq.item);
    expect(sBat.form).toEqual(sSeq.form);
    expect(sBat.finalDerived).toEqual(sSeq.finalDerived);
    expect(sBat.finalWarnings).toEqual(sSeq.finalWarnings);

    // Batched: 1 recompute per fungsi walau lebar mutasi konflik.
    expect(sBat.derivedCallsSinceInit).toBe(1);
    expect(sBat.warningsCallsSinceInit).toBe(1);

    // Sequential: recompute count ≤ jumlah mutasi total, tanpa double di step manapun.
    expect(sSeq.derivedCallsSinceInit).toBeLessThanOrEqual(mutations.length);
    expect(sSeq.warningsCallsSinceInit).toBeLessThanOrEqual(mutations.length);
  });

  it("konflik lebar yang KEMBALI ke BASE (semua field di-reset) → 0 recompute di batch", () => {
    // Terapkan mutasi luas, lalu di akhir batch kembalikan setiap field ke BASE.
    const mutations: Mutation[] = [
      ...buildWideConflict(2),
      // Reset kembali ke BASE_FORM + BASE_ITEM di akhir batch.
      { kind: "form", patch: { ...BASE_FORM } },
      {
        kind: "item",
        patch: {
          id: BASE_ITEM.id,
          package_type: BASE_ITEM.package_type,
          package_size: BASE_ITEM.package_size,
          base_unit: BASE_ITEM.base_unit,
          stock_base: BASE_ITEM.stock_base,
          avg_cost_per_base: BASE_ITEM.avg_cost_per_base,
        },
      },
    ];

    const h = makeHarness();
    h.stepBatched(mutations);
    const s = h.snapshot();

    // Net change = 0 → deps identik → commit no-op untuk kedua memo.
    expect(s.derivedCallsSinceInit).toBe(0);
    expect(s.warningsCallsSinceInit).toBe(0);
    expect(s.item).toEqual(BASE_ITEM);
    expect(s.form).toEqual(BASE_FORM);
  });

  it("konflik lebar dengan warnings-only reset (derived tetap berubah) → 1 derived, 1 warnings", () => {
    // Semua derived field berubah, tapi warnings-only field (stock_base,
    // avg_cost_per_base) kembali ke BASE di akhir batch.
    const mutations: Mutation[] = [
      { kind: "form", patch: { pricePerPackage: "12345" } },
      { kind: "form", patch: { packageQty: "9" } },
      { kind: "item", patch: { stock_base: 999 } },
      { kind: "item", patch: { avg_cost_per_base: 111 } },
      { kind: "form", patch: { pricePerPackage: "67890" } },
      { kind: "item", patch: { stock_base: BASE_ITEM.stock_base } },
      { kind: "item", patch: { avg_cost_per_base: BASE_ITEM.avg_cost_per_base } },
    ];

    const h = makeHarness();
    h.stepBatched(mutations);
    const s = h.snapshot();

    // Derived deps berubah (pricePerPackage & packageQty), warnings deps
    // berubah karena `derived` berubah (dep-nya memo derived), tapi
    // stock_base/avg_cost kembali ke BASE — tetap dihitung 1×.
    expect(s.derivedCallsSinceInit).toBe(1);
    expect(s.warningsCallsSinceInit).toBe(1);
    expect(s.form.pricePerPackage).toBe("67890");
    expect(s.form.packageQty).toBe("9");
    expect(s.item.stock_base).toBe(BASE_ITEM.stock_base);
    expect(s.item.avg_cost_per_base).toBe(BASE_ITEM.avg_cost_per_base);
  });
});