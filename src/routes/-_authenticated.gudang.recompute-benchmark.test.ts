import { describe, it, expect, vi } from "vitest";
import {
  computeBeliDerived as realComputeDerived,
  type BeliDerivedInput,
} from "@/lib/beli-derived";
import {
  computeBeliWarnings as realComputeWarnings,
} from "@/lib/beli-warnings";

// ============================================================
// Benchmark otomatis untuk regresi performa pipeline recompute.
//
// Bandingkan dua mode update pada set mutasi yang IDENTIK:
//
//   • sequential — tiap mutasi commit sendiri (render/microtask
//     diantara), memicu 1 recompute per transisi.
//   • batched    — sekumpulan mutasi digabung dalam SATU commit
//     (mirip React batching), memicu ≤1 recompute per batch.
//
// Kontrak yang dikunci:
//   1. Output final IDENTIK di kedua mode (determinisme).
//   2. Jumlah recompute batched ≤ sequential (batched menghemat).
//   3. Waktu eksekusi batched < ceiling relatif thd sequential
//      (envelope longgar agar tahan noise CI, tapi menangkap
//      regresi orde-magnitudo).
//   4. Waktu eksekusi absolut di bawah budget maksimum agar bila
//      ada regresi lambat drastis, langsung red.
//
// Envelope waktu sengaja LONGGAR — tujuannya bukan mengukur
// throughput mikro, melainkan mendeteksi regresi ordo besar
// (mis. hilangnya memoization → 10-100× lebih lambat).
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
  packageQty: string;
  pricePerPackage: string;
  priceMode: "package" | "base";
  pricePerBase: string;
};

function build(item: Item, f: Form): BeliDerivedInput {
  return {
    mode: "existing",
    selectedItem: item,
    newPackageType: "botol",
    newPackageSize: "500",
    packageQty: f.packageQty,
    pricePerPackage: f.pricePerPackage,
    priceMode: f.priceMode,
    pricePerBase: f.pricePerBase,
    inputKarton: false,
  };
}

function depsOf(item: Item, f: Form): Deps {
  return [
    "existing",
    item.id,
    item.package_type,
    item.package_size,
    item.base_unit,
    "500",
    f.packageQty,
    f.pricePerPackage,
    f.priceMode,
    f.pricePerBase,
    false,
  ] as const;
}

/**
 * Mutasi terkontrol — 400 langkah deterministik. Kombinasi 4 field
 * efektif berputar dgn pola berbeda supaya sequential ≠ batched
 * pada jumlah recompute-nya.
 */
type Mut = Partial<Form> & { itemPatch?: Partial<Item> };
function makeMutations(n: number): Mut[] {
  const out: Mut[] = [];
  for (let i = 1; i <= n; i++) {
    switch (i % 5) {
      case 0:
        out.push({ packageQty: String((i % 9) + 1) });
        break;
      case 1:
        out.push({ pricePerPackage: String(10_000 + i) });
        break;
      case 2:
        out.push({ priceMode: i % 10 < 5 ? "package" : "base" });
        break;
      case 3:
        out.push({ pricePerBase: i % 10 < 5 ? String(20 + i) : "" });
        break;
      default:
        out.push({ itemPatch: { package_size: 500 + (i % 7) } });
    }
  }
  return out;
}

const START_ITEM: Item = {
  id: "bench-1",
  package_type: "botol",
  package_size: 500,
  base_unit: "g",
  stock_base: 10_000,
  avg_cost_per_base: 20,
};
const START_FORM: Form = {
  packageQty: "2",
  pricePerPackage: "10000",
  priceMode: "package",
  pricePerBase: "",
};

function runSequential(muts: Mut[]) {
  const spyD = vi.fn(realComputeDerived);
  const spyW = vi.fn(realComputeWarnings);
  let item = { ...START_ITEM };
  let form = { ...START_FORM };

  const memoD = createMemo({
    deps: depsOf(item, form),
    factory: () => spyD(build(item, form)),
  });
  const memoW = createMemo({
    deps: [...depsOf(item, form), memoD.value] as const,
    factory: () =>
      spyW({
        mode: "existing",
        selectedItem: item,
        derived: memoD.value,
        priceMode: form.priceMode,
        inputKarton: false,
      }),
  });

  const t0 = performance.now();
  for (const m of muts) {
    if (m.itemPatch) item = { ...item, ...m.itemPatch };
    form = { ...form, ...m };
    memoD.commit(depsOf(item, form), () => spyD(build(item, form)));
    memoW.commit([...depsOf(item, form), memoD.value] as const, () =>
      spyW({
        mode: "existing",
        selectedItem: item,
        derived: memoD.value,
        priceMode: form.priceMode,
        inputKarton: false,
      }),
    );
  }
  const ms = performance.now() - t0;

  return {
    ms,
    derivedCalls: spyD.mock.calls.length,
    warningsCalls: spyW.mock.calls.length,
    finalDerived: memoD.value,
    finalWarnings: memoW.value,
    finalItem: item,
    finalForm: form,
  };
}

function runBatched(muts: Mut[], batchSize: number) {
  const spyD = vi.fn(realComputeDerived);
  const spyW = vi.fn(realComputeWarnings);
  let item = { ...START_ITEM };
  let form = { ...START_FORM };

  const memoD = createMemo({
    deps: depsOf(item, form),
    factory: () => spyD(build(item, form)),
  });
  const memoW = createMemo({
    deps: [...depsOf(item, form), memoD.value] as const,
    factory: () =>
      spyW({
        mode: "existing",
        selectedItem: item,
        derived: memoD.value,
        priceMode: form.priceMode,
        inputKarton: false,
      }),
  });

  const t0 = performance.now();
  for (let i = 0; i < muts.length; i += batchSize) {
    // Terapkan seluruh mutasi batch tanpa commit di antara.
    for (let j = i; j < Math.min(i + batchSize, muts.length); j++) {
      const m = muts[j]!;
      if (m.itemPatch) item = { ...item, ...m.itemPatch };
      form = { ...form, ...m };
    }
    // Satu commit setelah batch selesai — meniru React batching.
    memoD.commit(depsOf(item, form), () => spyD(build(item, form)));
    memoW.commit([...depsOf(item, form), memoD.value] as const, () =>
      spyW({
        mode: "existing",
        selectedItem: item,
        derived: memoD.value,
        priceMode: form.priceMode,
        inputKarton: false,
      }),
    );
  }
  const ms = performance.now() - t0;

  return {
    ms,
    derivedCalls: spyD.mock.calls.length,
    warningsCalls: spyW.mock.calls.length,
    finalDerived: memoD.value,
    finalWarnings: memoW.value,
    finalItem: item,
    finalForm: form,
  };
}

/** Rata-rata durasi terbaik dari beberapa run untuk mengurangi noise. */
function bestOfN<T extends { ms: number }>(fn: () => T, n: number): T {
  let best: T | null = null;
  for (let i = 0; i < n; i++) {
    const r = fn();
    if (!best || r.ms < best.ms) best = r;
  }
  return best!;
}

// Envelope longgar; nilai kasar untuk menangkap regresi ordo-magnitudo.
const N_MUTATIONS = 400;
const MAX_MS_SEQUENTIAL = 200; // budget mutlak sequential (400 langkah).
const MAX_MS_BATCHED = 200; // budget mutlak batched.
const REGRESSION_RATIO = 8; // batched.ms ≤ sequential.ms * ratio.

describe("recompute benchmark — sequential vs batched", () => {
  it("kedua mode menghasilkan output final IDENTIK (determinisme)", () => {
    const muts = makeMutations(N_MUTATIONS);
    const seq = runSequential(muts);
    const bat = runBatched(muts, 16);

    expect(bat.finalItem).toEqual(seq.finalItem);
    expect(bat.finalForm).toEqual(seq.finalForm);
    expect(bat.finalDerived).toEqual(seq.finalDerived);
    expect(bat.finalWarnings).toEqual(seq.finalWarnings);
  });

  it("batched melakukan recompute LEBIH SEDIKIT atau sama dgn sequential", () => {
    const muts = makeMutations(N_MUTATIONS);
    const seq = runSequential(muts);
    const bat16 = runBatched(muts, 16);
    const bat64 = runBatched(muts, 64);

    // Sequential: 1 awal + ≤ N transisi (beberapa mutasi mungkin
    // no-op karena set ke nilai yg sama).
    expect(seq.derivedCalls).toBeGreaterThan(1);
    expect(seq.derivedCalls).toBeLessThanOrEqual(1 + N_MUTATIONS);

    // Batched ≤ sequential — batch besar harus menghemat lebih banyak.
    expect(bat16.derivedCalls).toBeLessThanOrEqual(seq.derivedCalls);
    expect(bat64.derivedCalls).toBeLessThanOrEqual(bat16.derivedCalls);

    // Batching harus benar-benar bikin beda (bukan sekedar sama).
    // Envelope: batch=64 harus < setengah sequential.
    expect(bat64.derivedCalls * 2).toBeLessThan(seq.derivedCalls);
  });

  it("regresi waktu: batched < sequential × ratio, keduanya di bawah budget", () => {
    const muts = makeMutations(N_MUTATIONS);
    // Best-of-3 utk redam GC/JIT noise.
    const seq = bestOfN(() => runSequential(muts), 3);
    const bat = bestOfN(() => runBatched(muts, 32), 3);

    // Budget mutlak — regresi drastis (mis. memo hilang) langsung red.
    expect(seq.ms).toBeLessThan(MAX_MS_SEQUENTIAL);
    expect(bat.ms).toBeLessThan(MAX_MS_BATCHED);

    // Rasio: batched tidak boleh jauh lebih lambat dari sequential.
    // (Umumnya batched LEBIH cepat; kita hanya menjaga plafon.)
    expect(bat.ms).toBeLessThan(seq.ms * REGRESSION_RATIO + 5);

    // Sanity log untuk debugging regresi CI (tidak diassert).
    // eslint-disable-next-line no-console
    console.info(
      `[bench] N=${N_MUTATIONS} sequential=${seq.ms.toFixed(2)}ms ` +
        `(D=${seq.derivedCalls},W=${seq.warningsCalls}) ` +
        `batched32=${bat.ms.toFixed(2)}ms ` +
        `(D=${bat.derivedCalls},W=${bat.warningsCalls})`,
    );
  });

  it("skalabilitas: 4× mutasi menaikkan waktu sub-linear-kuadratik", () => {
    // Memoization yang benar → skala mendekati O(n). Regresi tipikal
    // (memo hilang, deep-equal per commit) → skala O(n²)+. Kita hanya
    // menjaga plafon O(n² / 4) supaya toleran thd noise.
    const small = bestOfN(() => runSequential(makeMutations(100)), 3);
    const big = bestOfN(() => runSequential(makeMutations(400)), 3);

    // Plafon: big.ms ≤ 16 * small.ms (kuadratik penuh) — kalau kena
    // batas ini, pipeline sudah kuadratik, mesti diinvestigasi.
    const smallFloor = Math.max(small.ms, 1); // hindari /0 di mesin cepat.
    expect(big.ms).toBeLessThan(smallFloor * 16 + 20);
  });
});