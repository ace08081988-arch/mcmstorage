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
  reset(): void;
};

export type StrictWarningsSpy = {
  call: (input: BeliWarnInput) => BeliWarning[];
  readonly mock: ReturnType<typeof vi.fn>;
  readonly pipelineCalls: number;
  readonly invalidCalls: number;
  reset(): void;
};

export function createStrictDerivedSpy(): StrictDerivedSpy {
  let valid = 0;
  let invalid = 0;
  const impl = (input: BeliDerivedInput) => {
    try {
      assertShape<BeliDerivedInput>(input, DERIVED_KEYS, "computeBeliDerived");
      valid++;
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
    reset() {
      valid = 0;
      invalid = 0;
      mock.mockClear();
    },
  };
}

export function createStrictWarningsSpy(): StrictWarningsSpy {
  let valid = 0;
  let invalid = 0;
  const impl = (input: BeliWarnInput) => {
    try {
      assertShape<BeliWarnInput>(input, WARN_KEYS, "computeBeliWarnings");
      valid++;
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
    reset() {
      valid = 0;
      invalid = 0;
      mock.mockClear();
    },
  };
}