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
// Stress test: 10 seed berbeda × 200 mutasi burst per seed.
// Untuk tiap seed, susun rangkaian mutasi acak-deterministik lalu
// jalankan lewat 3 mode:
//   - sequential (commit per mutasi)
//   - batched    (semua mutasi → 1 commit)
//   - microtask  (mutasi dijadwal di microtask, commit setelah semua drain)
// Final derived + warnings HARUS identik antar mode. Ini mengunci:
//   • determinisme output pipeline
//   • absennya race di memo internal (single-slot content-signature)
//   • batch commit menghasilkan STATE final yang sama, apapun urutan
//     antar-microtask, selama urutan mutasi input sama.
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
    spyD,
    spyW,
    stepSequential(m: Mutation) {
      apply(m);
      commit();
    },
    stepBatched(list: readonly Mutation[]) {
      for (const m of list) apply(m);
      commit();
    },
    async stepMicrotask(list: readonly Mutation[]) {
      for (const m of list) {
        await Promise.resolve();
        apply(m);
      }
      await Promise.resolve();
      commit();
    },
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

/** Mulberry32 PRNG — deterministik dan cukup untuk stress test. */
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

const PKG_TYPES: Item["package_type"][] = ["botol", "gram", "pcs", "sachet"];
const ITEM_POOL: Item[] = [
  BASE_ITEM,
  { id: "gram-1000", package_type: "gram", package_size: 1000, base_unit: "g", stock_base: 5000, avg_cost_per_base: 15 },
  { id: "pcs-1", package_type: "pcs", package_size: 1, base_unit: "pcs", stock_base: 200, avg_cost_per_base: 500 },
  { id: "sachet-10", package_type: "sachet", package_size: 10, base_unit: "g", stock_base: 800, avg_cost_per_base: 50 },
];

function generateMutations(seed: number, count: number): Mutation[] {
  const rng = mulberry32(seed);
  const out: Mutation[] = [];
  for (let i = 0; i < count; i++) {
    const r = rng();
    if (r < 0.2) {
      const it = ITEM_POOL[Math.floor(rng() * ITEM_POOL.length)]!;
      out.push({ kind: "item", patch: { ...it } });
    } else if (r < 0.35) {
      out.push({ kind: "item", patch: { stock_base: Math.floor(rng() * 20_000) } });
    } else if (r < 0.5) {
      out.push({ kind: "item", patch: { avg_cost_per_base: Math.floor(rng() * 100) + 1 } });
    } else if (r < 0.62) {
      out.push({ kind: "form", patch: { packageQty: String(1 + Math.floor(rng() * 20)) } });
    } else if (r < 0.74) {
      out.push({ kind: "form", patch: { pricePerPackage: String(1000 + Math.floor(rng() * 90_000)) } });
    } else if (r < 0.82) {
      out.push({ kind: "form", patch: { pricePerBase: String(Math.floor(rng() * 500)) } });
    } else if (r < 0.88) {
      out.push({ kind: "form", patch: { priceMode: rng() < 0.5 ? "package" : "base" } });
    } else if (r < 0.94) {
      out.push({ kind: "form", patch: { inputKarton: rng() < 0.5 } });
    } else if (r < 0.98) {
      out.push({ kind: "form", patch: { newPackageSize: String(100 + Math.floor(rng() * 2000)) } });
    } else {
      out.push({ kind: "form", patch: { newPackageType: PKG_TYPES[Math.floor(rng() * PKG_TYPES.length)]! } });
    }
  }
  return out;
}

const SEEDS = [1, 7, 17, 42, 101, 314, 999, 2718, 31337, 65535];
const BURST = 200;

describe("stress burst: 10 seed × 200 mutasi → output deterministik lintas mode commit", () => {
  beforeEach(() => {
    __resetBeliDerivedMemo();
    __resetBeliWarningsMemo();
  });

  for (const seed of SEEDS) {
    it(`seed ${seed}: sequential ≡ batched ≡ microtask (final derived+warnings identik)`, async () => {
      const mutations = generateMutations(seed, BURST);

      // Sequential — commit per mutasi (baseline).
      const seqH = makeHarness();
      for (const m of mutations) seqH.stepSequential(m);
      const seq = seqH.snapshot();

      // Batched — semua mutasi ditumpuk, satu commit di akhir.
      const batH = makeHarness();
      batH.stepBatched(mutations);
      const bat = batH.snapshot();

      // Microtask interleaved — mutasi diselipkan lewat microtask.
      const mtH = makeHarness();
      await mtH.stepMicrotask(mutations);
      const mt = mtH.snapshot();

      // KRITIS: state final identik → tidak ada race/side-effect antar mode.
      expect(bat.item).toEqual(seq.item);
      expect(bat.form).toEqual(seq.form);
      expect(mt.item).toEqual(seq.item);
      expect(mt.form).toEqual(seq.form);

      // Output pipeline identik lintas mode.
      expect(bat.finalDerived).toEqual(seq.finalDerived);
      expect(mt.finalDerived).toEqual(seq.finalDerived);
      expect(bat.finalWarnings).toEqual(seq.finalWarnings);
      expect(mt.finalWarnings).toEqual(seq.finalWarnings);

      // Batched dan microtask hanya commit sekali → tepat 1 recompute per
      // fungsi (di luar 1 kali inisialisasi factory saat memo dibuat).
      expect(bat.derivedCalls).toBeLessThanOrEqual(2);
      expect(bat.warningsCalls).toBeLessThanOrEqual(2);
      expect(mt.derivedCalls).toBeLessThanOrEqual(2);
      expect(mt.warningsCalls).toBeLessThanOrEqual(2);

      // Sequential recompute count TIDAK boleh melebihi jumlah mutasi + init.
      expect(seq.derivedCalls).toBeLessThanOrEqual(BURST + 1);
      expect(seq.warningsCalls).toBeLessThanOrEqual(BURST + 1);
    });
  }

  it("determinisme lintas run: seed sama menghasilkan output final yang sama", () => {
    for (const seed of SEEDS) {
      const mutations = generateMutations(seed, BURST);
      const a = makeHarness();
      for (const m of mutations) a.stepSequential(m);
      const b = makeHarness();
      for (const m of mutations) b.stepSequential(m);
      const sa = a.snapshot();
      const sb = b.snapshot();
      expect(sb.finalDerived).toEqual(sa.finalDerived);
      expect(sb.finalWarnings).toEqual(sa.finalWarnings);
      expect(sb.item).toEqual(sa.item);
      expect(sb.form).toEqual(sa.form);
    }
  });
});