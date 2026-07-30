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
import { writeStressDiagnosticArtifact } from "@/lib/stress-diagnostic";

// ============================================================
// Konflik + urutan acak.
//
// Test ini mengunci DUA properti pipeline saat mutasi konflik ditumpuk
// ke dalam satu batch commit dengan urutan yang di-shuffle:
//
//   (A) Non-conflicting shuffles (mutasi menyentuh field-field BERBEDA):
//       urutan tidak boleh memengaruhi hasil sama sekali. Semua permutasi
//       menghasilkan state final + finalDerived + finalWarnings YANG SAMA.
//
//   (B) Conflicting shuffles (banyak mutasi menyentuh field SAMA):
//       pipeline mengikuti "last-write-wins by input order". Untuk tiap
//       permutasi, output pipeline HARUS konsisten dengan referensi yang
//       dihitung ulang dari state akhir permutasi tersebut (via pemanggilan
//       langsung ke computeBeliDerived/Warnings tanpa memo). Ini menjamin:
//       • memo TIDAK bocor dari shuffle sebelumnya
//       • recompute batch tetap tepat 1× per fungsi, tidak peduli seberapa
//         banyak mutasi konflik yang ditumpuk
//       • pipeline tidak bergantung pada urutan internal batch selain
//         semantik last-write-wins yang eksplisit.
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

type FormField = keyof Form;
type ItemField = keyof Item;
type Mutation =
  | { kind: "form"; field: FormField; value: Form[FormField] }
  | { kind: "item"; field: ItemField; value: Item[ItemField] };

function applyAll(list: readonly Mutation[]) {
  let item: Item = { ...BASE_ITEM };
  let form: Form = { ...BASE_FORM };
  for (const m of list) {
    if (m.kind === "item") item = { ...item, [m.field]: m.value } as Item;
    else form = { ...form, [m.field]: m.value } as Form;
  }
  return { item, form };
}

/** Referensi pipeline TANPA memo — panggil langsung compute functions. */
function referenceOutput(list: readonly Mutation[]) {
  const { item, form } = applyAll(list);
  const derived = realComputeDerived(inp(item, form));
  const warnings = realComputeWarnings({
    mode: "existing",
    selectedItem: item,
    derived,
    priceMode: form.priceMode,
    inputKarton: form.inputKarton,
  });
  return { item, form, derived, warnings };
}

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
    if (m.kind === "item") item = { ...item, [m.field]: m.value } as Item;
    else form = { ...form, [m.field]: m.value } as Form;
  }

  return {
    stepBatched(list: readonly Mutation[]) {
      for (const m of list) apply(m);
      commit();
    },
    snapshot() {
      return {
        derivedCalls: spyD.mock.calls.length,
        warningsCalls: spyW.mock.calls.length,
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

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(list: readonly T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

function form<K extends FormField>(field: K, value: Form[K]): Mutation {
  return { kind: "form", field, value };
}
function item<K extends ItemField>(field: K, value: Item[K]): Mutation {
  return { kind: "item", field, value };
}

const SHUFFLE_SEEDS = [1, 2, 7, 13, 31, 42, 101, 257, 1024, 65535];

// ---------- (A) NON-CONFLICTING: hasil harus IDENTIK di semua shuffle ----------

const NON_CONFLICTING: Mutation[] = [
  form("packageQty", "9"),
  form("pricePerPackage", "45000"),
  form("newPackageSize", "750"),
  form("priceMode", "base"),
  form("pricePerBase", "125"),
  form("inputKarton", true),
  item("stock_base", 4321),
  item("avg_cost_per_base", 77),
];

// ---------- (B) CONFLICTING: banyak mutasi field yang sama ----------

const CONFLICT_SCENARIOS: { name: string; build: () => Mutation[]; expectDerivedRecomputes: 0 | 1; expectWarningsRecomputes: 0 | 1 }[] = [
  {
    name: "packageQty berulang",
    expectDerivedRecomputes: 1,
    expectWarningsRecomputes: 1,
    build: () => [
      form("packageQty", "5"),
      form("packageQty", "9"),
      form("packageQty", "12"),
      form("packageQty", "20"),
    ],
  },
  {
    name: "derived + warnings-only campur",
    expectDerivedRecomputes: 1,
    expectWarningsRecomputes: 1,
    build: () => [
      form("pricePerPackage", "20000"),
      item("stock_base", 500),
      form("pricePerPackage", "35000"),
      item("stock_base", 250),
      form("pricePerPackage", "50000"),
      item("avg_cost_per_base", 60),
      item("stock_base", 125),
    ],
  },
  {
    name: "priceMode flip + pricePerBase",
    expectDerivedRecomputes: 1,
    expectWarningsRecomputes: 1,
    build: () => [
      form("priceMode", "base"),
      form("pricePerBase", "50"),
      form("priceMode", "package"),
      form("pricePerBase", "125"),
      form("priceMode", "base"),
      form("pricePerBase", "300"),
    ],
  },
  {
    name: "hanya warnings-only (stock_base + avg_cost_per_base) — 0 derived",
    expectDerivedRecomputes: 0,
    expectWarningsRecomputes: 1,
    build: () => [
      item("stock_base", 1),
      item("avg_cost_per_base", 5),
      item("stock_base", 2),
      item("avg_cost_per_base", 10),
      item("stock_base", 3),
      item("avg_cost_per_base", 15),
    ],
  },
  {
    name: "banyak field campur + konflik lintas kategori",
    expectDerivedRecomputes: 1,
    expectWarningsRecomputes: 1,
    build: () => [
      form("packageQty", "3"),
      form("pricePerPackage", "15000"),
      item("stock_base", 900),
      form("packageQty", "7"),
      item("avg_cost_per_base", 25),
      form("pricePerPackage", "40000"),
      form("packageQty", "11"),
      item("stock_base", 400),
      item("avg_cost_per_base", 55),
      form("inputKarton", true),
      form("newPackageSize", "750"),
      form("pricePerPackage", "77777"),
    ],
  },
];

describe("conflicting updates + random ordering — pipeline tidak bergantung pada urutan batch", () => {
  beforeEach(() => {
    __resetBeliDerivedMemo();
    __resetBeliWarningsMemo();
  });

  it("(A) non-conflicting: semua shuffle menghasilkan finalDerived+finalWarnings IDENTIK", () => {
    // Referensi dihitung dari canonical order.
    const ref = referenceOutput(NON_CONFLICTING);

    for (const seed of SHUFFLE_SEEDS) {
      const shuffled = shuffle(NON_CONFLICTING, seed);
      const h = makeHarness();
      h.stepBatched(shuffled);
      const s = h.snapshot();

      try {
        // State akhir independen dari urutan (tidak ada field yang bertabrakan).
        expect(s.item).toEqual(ref.item);
        expect(s.form).toEqual(ref.form);
        expect(s.finalDerived).toEqual(ref.derived);
        expect(s.finalWarnings).toEqual(ref.warnings);
        // Batched: tepat 1 recompute per fungsi.
        expect(s.derivedCallsSinceInit).toBe(1);
        expect(s.warningsCallsSinceInit).toBe(1);
      } catch (err) {
        const file = writeStressDiagnosticArtifact({
          label: "conflict-random-noconflict",
          seed,
          burst: shuffled.length,
          baseline: {
            name: "reference",
            snapshot: {
              derivedCalls: 1,
              warningsCalls: 1,
              finalDerived: ref.derived,
              finalWarnings: ref.warnings,
              item: ref.item,
              form: ref.form,
            },
          },
          others: [{ name: `shuffle-${seed}`, snapshot: s }],
          extra: {
            error: err instanceof Error ? err.message : String(err),
            order: shuffled.map((m) => `${m.kind}:${String(m.field)}=${String(m.value)}`),
          },
        });
        if (file) {
          // eslint-disable-next-line no-console
          console.error(`[conflict-random-noconflict] wrote diagnostic artifact: ${file}`);
        }
        throw err;
      }
    }
  });

  for (const scenario of CONFLICT_SCENARIOS) {
    it(`(B) ${scenario.name}: setiap shuffle konsisten dengan last-write-wins-nya sendiri + recompute count stabil`, () => {
      const canonical = scenario.build();

      for (const seed of SHUFFLE_SEEDS) {
        const shuffled = shuffle(canonical, seed);
        // Guard: shuffle tidak menghilangkan/mengganda mutasi.
        expect(shuffled).toHaveLength(canonical.length);

        // Referensi dihitung ulang dari state akhir permutasi INI, tanpa memo.
        __resetBeliDerivedMemo();
        __resetBeliWarningsMemo();
        const ref = referenceOutput(shuffled);

        // Reset memo lagi supaya harness mulai dari kondisi bersih (sama
        // seperti render pertama komponen).
        __resetBeliDerivedMemo();
        __resetBeliWarningsMemo();
        const h = makeHarness();
        h.stepBatched(shuffled);
        const s = h.snapshot();

        try {
          // Pipeline HARUS mencerminkan last-write-wins pada shuffle ini.
          expect(s.item).toEqual(ref.item);
          expect(s.form).toEqual(ref.form);
          expect(s.finalDerived).toEqual(ref.derived);
          expect(s.finalWarnings).toEqual(ref.warnings);
          // Recompute count invariant terhadap ordering.
          expect(s.derivedCallsSinceInit).toBe(scenario.expectDerivedRecomputes);
          expect(s.warningsCallsSinceInit).toBe(scenario.expectWarningsRecomputes);
        } catch (err) {
          const file = writeStressDiagnosticArtifact({
            label: `conflict-random-${scenario.name}`,
            seed,
            burst: shuffled.length,
            baseline: {
              name: "reference",
              snapshot: {
                derivedCalls: scenario.expectDerivedRecomputes,
                warningsCalls: scenario.expectWarningsRecomputes,
                finalDerived: ref.derived,
                finalWarnings: ref.warnings,
                item: ref.item,
                form: ref.form,
              },
            },
            others: [{ name: `shuffle-${seed}`, snapshot: s }],
            extra: {
              error: err instanceof Error ? err.message : String(err),
              scenario: scenario.name,
              order: shuffled.map((m) => `${m.kind}:${String(m.field)}=${String(m.value)}`),
            },
          });
          if (file) {
            // eslint-disable-next-line no-console
            console.error(`[conflict-random] wrote diagnostic artifact: ${file}`);
          }
          throw err;
        }
      }
    });
  }

  it("(C) determinisme antar harness: shuffle seed sama → output pipeline sama persis", () => {
    const canonical = CONFLICT_SCENARIOS[CONFLICT_SCENARIOS.length - 1]!.build();
    for (const seed of SHUFFLE_SEEDS) {
      const shuffled = shuffle(canonical, seed);

      __resetBeliDerivedMemo();
      __resetBeliWarningsMemo();
      const a = makeHarness();
      a.stepBatched(shuffled);
      const sa = a.snapshot();

      __resetBeliDerivedMemo();
      __resetBeliWarningsMemo();
      const b = makeHarness();
      b.stepBatched(shuffled);
      const sb = b.snapshot();

      expect(sb.item).toEqual(sa.item);
      expect(sb.form).toEqual(sa.form);
      expect(sb.finalDerived).toEqual(sa.finalDerived);
      expect(sb.finalWarnings).toEqual(sa.finalWarnings);
      expect(sb.derivedCallsSinceInit).toBe(sa.derivedCallsSinceInit);
      expect(sb.warningsCallsSinceInit).toBe(sa.warningsCallsSinceInit);
    }
  });
});