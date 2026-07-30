import { vi } from "vitest";
import {
  computeBeliDerived,
  type BeliDerivedInput,
  type BeliDerivedOutput,
} from "@/lib/beli-derived";
import {
  computeBeliWarnings,
  type BeliWarnInput,
  type BeliWarning,
} from "@/lib/beli-warnings";

/**
 * Strict matcher untuk spy pipeline compute*.
 *
 * Motivasi: `vi.fn(realComputeDerived)` menghitung SEMUA panggilan, termasuk
 * helper lain (fixture builder, snapshot builder, kontrol positif setup) yang
 * kebetulan memanggil fungsi yang sama. Ini menghasilkan false-positive saat
 * pipeline memoization sebenarnya sudah menahan recompute — tapi helper di
 * pinggir test bumping counter.
 *
 * Kontrak strict-spy:
 *   • hanya panggilan dengan bentuk input yang benar-benar sesuai (validasi
 *     runtime + tag) yang menaikkan `pipelineCalls`.
 *   • panggilan yang tidak menyertakan tag (helper diluar pipeline) TIDAK
 *     memodifikasi counter, tetap mengembalikan output nyata.
 *   • panggilan dengan tag yang bentuknya invalid = error keras (fail test).
 *
 * Cara pakai:
 *   const s = createStrictDerivedSpy();
 *   const memo = createMemo({
 *     factory: () => s.call(input),          // dihitung
 *   });
 *   realComputeDerived(fixtureInput);        // TIDAK dihitung (bukan .call)
 *
 *   expect(s.pipelineCalls).toBe(1);
 */

const DERIVED_KEYS: readonly (keyof BeliDerivedInput)[] = [
  "mode",
  "selectedItem",
  "newPackageType",
  "newPackageSize",
  "packageQty",
  "pricePerPackage",
  "priceMode",
  "pricePerBase",
  "inputKarton",
];

const WARN_KEYS: readonly (keyof BeliWarnInput)[] = [
  "mode",
  "selectedItem",
  "derived",
  "priceMode",
  "inputKarton",
];

function assertShape<T extends object>(
  input: unknown,
  keys: readonly (keyof T)[],
  label: string,
): asserts input is T {
  if (!input || typeof input !== "object") {
    throw new Error(`[strict-spy] ${label}: input bukan object (${typeof input})`);
  }
  const rec = input as Record<string, unknown>;
  for (const k of keys) {
    if (!(k in rec)) {
      throw new Error(`[strict-spy] ${label}: field '${String(k)}' hilang`);
    }
  }
}

export type StrictDerivedSpy = {
  /** Panggilan pipeline — dihitung. */
  call: (input: BeliDerivedInput) => BeliDerivedOutput;
  /** Mock vitest dari `call` — cocok untuk `.toHaveBeenCalledTimes(...)`. */
  readonly mock: ReturnType<typeof vi.fn>;
  /** Jumlah panggilan pipeline yang sah (validasi shape lolos). */
  readonly pipelineCalls: number;
  /** Jumlah panggilan pipeline yang GAGAL validasi (harus 0 di test hijau). */
  readonly invalidCalls: number;
  /**
   * Rekaman berurutan setiap panggilan pipeline yang sah, dalam urutan
   * observasi. Bentuknya ORDER-INDEPENDENT di sisi ekspektasi: gunakan
   * `sortedPayloads()` bila hanya multiset payload yang penting; gunakan
   * `payloads` bila urutan juga bagian dari kontrak.
   */
  readonly payloads: readonly BeliDerivedInput[];
  /** Payload di-hash-kan lalu diurutkan — stabil di bawah interleaving. */
  sortedPayloads(): readonly string[];
  reset(): void;
};

export type StrictWarningsSpy = {
  call: (input: BeliWarnInput) => BeliWarning[];
  readonly mock: ReturnType<typeof vi.fn>;
  readonly pipelineCalls: number;
  readonly invalidCalls: number;
  readonly payloads: readonly BeliWarnInput[];
  sortedPayloads(): readonly string[];
  reset(): void;
};

/**
 * Payload-hash kanonik. Order-independent secara isi:
 * dua payload dengan field yang sama menghasilkan hash sama walau
 * referensi objeknya berbeda (mis. setelah refetch).
 */
function hashDerived(i: BeliDerivedInput): string {
  const it = i.selectedItem
    ? `${i.selectedItem.package_type}|${i.selectedItem.package_size}|${i.selectedItem.base_unit}`
    : "-";
  return [
    i.mode,
    it,
    i.newPackageType,
    String(i.newPackageSize),
    String(i.packageQty),
    String(i.pricePerPackage),
    i.priceMode,
    String(i.pricePerBase),
    i.inputKarton ? "1" : "0",
  ].join("::");
}

function hashWarn(i: BeliWarnInput): string {
  const it = i.selectedItem
    ? `${i.selectedItem.package_type}|${i.selectedItem.package_size}|${i.selectedItem.base_unit}|${i.selectedItem.stock_base ?? 0}|${i.selectedItem.avg_cost_per_base ?? 0}`
    : "-";
  const d = i.derived;
  return [
    i.mode,
    it,
    i.priceMode,
    i.inputKarton ? "1" : "0",
    d.effPackageType,
    d.effBaseUnit,
    d.effectivePkgSize,
    d.pkgQ,
    d.price,
    d.baseAdded,
    d.totalCost,
    d.kartonActive ? "1" : "0",
  ].join("::");
}

export function createStrictDerivedSpy(): StrictDerivedSpy {
  let valid = 0;
  let invalid = 0;
  const payloads: BeliDerivedInput[] = [];
  const impl = (input: BeliDerivedInput) => {
    try {
      assertShape<BeliDerivedInput>(input, DERIVED_KEYS, "computeBeliDerived");
      valid++;
      // Simpan snapshot dangkal untuk urutan/payload check. Kita menyalin
      // supaya mutasi kemudian terhadap objek input tidak mengubah rekam.
      payloads.push({ ...input });
    } catch (e) {
      invalid++;
      throw e;
    }
    return computeBeliDerived(input);
  };
  const mock = vi.fn(impl);
  return {
    call: mock as unknown as (i: BeliDerivedInput) => BeliDerivedOutput,
    mock,
    get pipelineCalls() {
      return valid;
    },
    get invalidCalls() {
      return invalid;
    },
    get payloads() {
      return payloads;
    },
    sortedPayloads() {
      return payloads.map(hashDerived).slice().sort();
    },
    reset() {
      valid = 0;
      invalid = 0;
      payloads.length = 0;
      mock.mockClear();
    },
  };
}

export function createStrictWarningsSpy(): StrictWarningsSpy {
  let valid = 0;
  let invalid = 0;
  const payloads: BeliWarnInput[] = [];
  const impl = (input: BeliWarnInput) => {
    try {
      assertShape<BeliWarnInput>(input, WARN_KEYS, "computeBeliWarnings");
      valid++;
      payloads.push({ ...input });
    } catch (e) {
      invalid++;
      throw e;
    }
    return computeBeliWarnings(input);
  };
  const mock = vi.fn(impl);
  return {
    call: mock as unknown as (i: BeliWarnInput) => BeliWarning[],
    mock,
    get pipelineCalls() {
      return valid;
    },
    get invalidCalls() {
      return invalid;
    },
    get payloads() {
      return payloads;
    },
    sortedPayloads() {
      return payloads.map(hashWarn).slice().sort();
    },
    reset() {
      valid = 0;
      invalid = 0;
      payloads.length = 0;
      mock.mockClear();
    },
  };
}