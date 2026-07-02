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
// Untuk setiap field yang di-mutasi, kami menyusun N nilai bertingkat
// (v0..vN-1). Nilai terakhir per field ("winner") HARUS menang tanpa
// peduli dalam urutan apa mutasi tersebut ditumpuk di dalam satu batch
// commit. Untuk mengetahui pemenang tanpa bergantung pada urutan input,
// setiap mutasi diberi `seq` monoton (0..K-1). Setelah dishuffle, tiap
// harness mengeksekusi mutasi APA ADANYA (urutan acak) tetapi hasil akhir
// diverifikasi terhadap referensi yang dihitung dari `seq` maksimal per
// field — jadi test mengunci: pipeline tidak boleh sensitif terhadap
// interleaving pesan mutasi dalam batch, hanya nilai akhir per field.
//
// Dua invariant yang diuji:
//   1) Semua permutasi (10+ seed shuffle × 5 skenario konflik) menghasilkan
//      finalDerived + finalWarnings + state form/item YANG SAMA persis.
//   2) Batched commit tepat 1 recompute derived + 1 recompute warnings
//      per skenario, terlepas dari jumlah mutasi konflik.
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

/**
 * Mutasi yang di-tag dengan `seq` — nomor urut logis. Urutan input boleh
 * dishuffle sesuka hati; pemenang tetap = seq terbesar per field.
 */
type FormField = keyof Form;
type ItemField = keyof Item;
type TaggedMutation =
  | { seq: number; kind: "form"; field: FormField; value: Form[FormField] }
  | { seq: number; kind: "item"; field: ItemField; value: Item[ItemField] };

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

  function apply(m: TaggedMutation) {
    if (m.kind === "item") item = { ...item, [m.field]: m.value } as Item;
    else form = { ...form, [m.field]: m.value } as Form;
  }

  return {
    stepBatched(list: readonly TaggedMutation[]) {
      for (const m of list) apply(m);
      commit();
    },
    stepSequential(list: readonly TaggedMutation[]) {
      for (const m of list) {
        apply(m);
        commit();
      }
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

/**
 * Referensi "winner": untuk tiap (kind,field), ambil mutasi dengan `seq`
 * terbesar. Ini adalah hasil yang HARUS dicapai batch permutasi manapun.
 */
function resolveWinners(list: readonly TaggedMutation[]) {
  const winners = new Map<string, TaggedMutation>();
  for (const m of list) {
    const key = `${m.kind}:${m.field}`;
    const cur = winners.get(key);
    if (!cur || m.seq > cur.seq) winners.set(key, m);
  }
  // Terapkan hanya para winner ke state awal untuk mendapatkan referensi.
  let item: Item = { ...BASE_ITEM };
  let form: Form = { ...BASE_FORM };
  for (const m of winners.values()) {
    if (m.kind === "item") item = { ...item, [m.field]: m.value } as Item;
    else form = { ...form, [m.field]: m.value } as Form;
  }
  return { item, form };
}

/** Mulberry32 PRNG deterministik. */
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

type Scenario = {
  name: string;
  build: () => TaggedMutation[];
  expectDerivedRecomputes: 0 | 1;
  expectWarningsRecomputes: 0 | 1;
};

let seqCounter = 0;
const nextSeq = () => seqCounter++;

function form<K extends FormField>(field: K, value: Form[K]): TaggedMutation {
  return { seq: nextSeq(), kind: "form", field, value };
}
function item<K extends ItemField>(field: K, value: Item[K]): TaggedMutation {
  return { seq: nextSeq(), kind: "item", field, value };
}

const SCENARIOS: Scenario[] = [
  {
    name: "packageQty berulang — 1 winner derived",
    expectDerivedRecomputes: 1,
    expectWarningsRecomputes: 1,
    build: () => {
      seqCounter = 0;
      return [
        form("packageQty", "5"),
        form("packageQty", "9"),
        form("packageQty", "12"),
        form("packageQty", "20"),
      ];
    },
  },
  {
    name: "derived + warnings-only campur — kedua winner berlaku",
    expectDerivedRecomputes: 1,
    expectWarningsRecomputes: 1,
    build: () => {
      seqCounter = 0;
      return [
        form("pricePerPackage", "20000"),
        item("stock_base", 500),
        form("pricePerPackage", "35000"),
        item("stock_base", 250),
        form("pricePerPackage", "50000"),
        item("stock_base", 125),
        item("avg_cost_per_base", 30),
        item("avg_cost_per_base", 60),
      ];
    },
  },
  {
    name: "priceMode flip + pricePerBase — konflik enum + string",
    expectDerivedRecomputes: 1,
    expectWarningsRecomputes: 1,
    build: () => {
      seqCounter = 0;
      return [
        form("priceMode", "base"),
        form("pricePerBase", "50"),
        form("priceMode", "package"),
        form("pricePerBase", "125"),
        form("priceMode", "base"),
        form("pricePerBase", "300"),
      ];
    },
  },
  {
    name: "hanya warnings-only field (stock_base + avg_cost) — 0 derived, 1 warnings",
    expectDerivedRecomputes: 0,
    expectWarningsRecomputes: 1,
    build: () => {
      seqCounter = 0;
      return [
        item("stock_base", 1),
        item("avg_cost_per_base", 5),
        item("stock_base", 2),
        item("avg_cost_per_base", 10),
        item("stock_base", 3),
        item("avg_cost_per_base", 15),
      ];
    },
  },
  {
    name: "banyak field campur — derived+warnings winner independen dari urutan",
    expectDerivedRecomputes: 1,
    expectWarningsRecomputes: 1,
    build: () => {
      seqCounter = 0;
      return [
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
      ];
    },
  },
];

const SHUFFLE_SEEDS = [1, 2, 7, 13, 31, 42, 101, 257, 1024, 65535];

describe("conflicting updates + random ordering — hasil independen dari urutan batch", () => {
  beforeEach(() => {
    __resetBeliDerivedMemo();
    __resetBeliWarningsMemo();
  });

  for (const scenario of SCENARIOS) {
    it(`${scenario.name}: semua permutasi menghasilkan finalDerived+finalWarnings identik`, () => {
      const canonical = scenario.build();
      const winners = resolveWinners(canonical);

      // Baseline: eksekusi dalam urutan canonical (seq ascending) untuk
      // mendapatkan referensi finalDerived/finalWarnings yang benar.
      const baseH = makeHarness();
      baseH.stepBatched(canonical);
      const base = baseH.snapshot();

      // Sanity: state final HARUS cocok dengan pemenang berdasarkan seq.
      expect(base.item).toEqual(winners.item);
      expect(base.form).toEqual(winners.form);
      expect(base.derivedCallsSinceInit).toBe(scenario.expectDerivedRecomputes);
      expect(base.warningsCallsSinceInit).toBe(scenario.expectWarningsRecomputes);

      for (const seed of SHUFFLE_SEEDS) {
        const shuffled = shuffle(canonical, seed);
        // Guard: shuffling tidak mengubah himpunan mutasi.
        expect(shuffled).toHaveLength(canonical.length);

        const h = makeHarness();
        h.stepBatched(shuffled);
        const s = h.snapshot();

        try {
          expect(s.item).toEqual(base.item);
          expect(s.form).toEqual(base.form);
          expect(s.finalDerived).toEqual(base.finalDerived);
          expect(s.finalWarnings).toEqual(base.finalWarnings);
          // Batched selalu 1 (atau 0 untuk skenario derived-none) recompute
          // per fungsi, apapun urutan mutasi.
          expect(s.derivedCallsSinceInit).toBe(scenario.expectDerivedRecomputes);
          expect(s.warningsCallsSinceInit).toBe(scenario.expectWarningsRecomputes);
        } catch (err) {
          const file = writeStressDiagnosticArtifact({
            label: `conflict-random-${scenario.name}`,
            seed,
            burst: canonical.length,
            baseline: { name: "canonical", snapshot: base },
            others: [{ name: `shuffle-${seed}`, snapshot: s }],
            extra: {
              error: err instanceof Error ? err.message : String(err),
              scenario: scenario.name,
              order: shuffled.map((m) => `${m.kind}:${String(m.field)}=${String(m.value)}#${m.seq}`),
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

  it("sequential apply pada urutan acak tetap menghasilkan state akhir yang sama (winner-per-field)", () => {
    const canonical = SCENARIOS[SCENARIOS.length - 1]!.build();
    const winners = resolveWinners(canonical);

    for (const seed of SHUFFLE_SEEDS) {
      const shuffled = shuffle(canonical, seed);
      const h = makeHarness();
      h.stepSequential(shuffled);
      const s = h.snapshot();

      // Karena setiap field di-shuffle tetap ada, winner (seq terbesar
      // per field) sama. Namun urutan aplikasi berbeda, jadi state
      // MENENGAH berbeda — kami hanya menjamin state FINAL identik.
      expect(s.item).toEqual(winners.item);
      expect(s.form).toEqual(winners.form);

      // Sequential: jumlah recompute ≤ jumlah mutasi (tanpa memo bocor).
      expect(s.derivedCallsSinceInit).toBeLessThanOrEqual(shuffled.length);
      expect(s.warningsCallsSinceInit).toBeLessThanOrEqual(shuffled.length);
    }
  });
});