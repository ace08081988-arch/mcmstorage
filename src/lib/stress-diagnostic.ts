// Helper diagnostik untuk stress test pipeline gudang.
//
// Saat perbandingan snapshot antar-mode (sequential / batched / microtask)
// gagal, kita menulis artefak JSON ke `test-artifacts/` berisi:
//   - snapshot lengkap tiap mode (finalDerived, finalWarnings, item, form)
//   - diff kunci-per-kunci (finalDerived, finalWarnings, item, form) antara
//     mode baseline (sequential) vs mode lain
//   - metadata seed + jumlah mutasi
//
// File ini diunggah sebagai artefak CI sehingga saat stress test gagal,
// perbedaan langsung terlihat tanpa harus mereproduksi ulang secara lokal.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type StressSnapshot = {
  derivedCalls: number;
  warningsCalls: number;
  finalDerived: unknown;
  finalWarnings: unknown;
  item: unknown;
  form: unknown;
};

type NamedSnapshot = { name: string; snapshot: StressSnapshot };

function diffObject(
  baseline: unknown,
  candidate: unknown,
): Record<string, { baseline: unknown; candidate: unknown }> | "equal" {
  if (Object.is(baseline, candidate)) return "equal";
  const bJson = safeStringify(baseline);
  const cJson = safeStringify(candidate);
  if (bJson === cJson) return "equal";
  const out: Record<string, { baseline: unknown; candidate: unknown }> = {};
  const bObj = (baseline ?? {}) as Record<string, unknown>;
  const cObj = (candidate ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(bObj), ...Object.keys(cObj)]);
  for (const k of keys) {
    const bv = bObj[k];
    const cv = cObj[k];
    if (safeStringify(bv) !== safeStringify(cv)) {
      out[k] = { baseline: bv, candidate: cv };
    }
  }
  // Bila keduanya non-object tapi tidak sama, laporkan sebagai nilai penuh.
  if (Object.keys(out).length === 0) {
    out["<value>"] = { baseline, candidate };
  }
  return out;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Tulis artefak diff bila diperlukan. Return true jika file ditulis.
 * Dipanggil di catch/finally dari test agar CI menerima file yang bermakna
 * bahkan bila hanya sebagian mode yang menyimpang.
 */
export function writeStressDiagnosticArtifact(params: {
  label: string; // dipakai sebagai nama file (di-slugify)
  seed: number;
  burst: number;
  baseline: NamedSnapshot;
  others: readonly NamedSnapshot[];
  extra?: Record<string, unknown>;
}): string | null {
  const diffs: Record<
    string,
    Record<string, ReturnType<typeof diffObject>> | "equal"
  > = {};
  let anyDiff = false;
  for (const other of params.others) {
    const fields: Record<string, ReturnType<typeof diffObject>> = {
      finalDerived: diffObject(
        params.baseline.snapshot.finalDerived,
        other.snapshot.finalDerived,
      ),
      finalWarnings: diffObject(
        params.baseline.snapshot.finalWarnings,
        other.snapshot.finalWarnings,
      ),
      item: diffObject(params.baseline.snapshot.item, other.snapshot.item),
      form: diffObject(params.baseline.snapshot.form, other.snapshot.form),
    };
    const allEqual = Object.values(fields).every((v) => v === "equal");
    diffs[other.name] = allEqual ? "equal" : fields;
    if (!allEqual) anyDiff = true;
  }

  // Selalu tulis snapshot lengkap; diff kosong ditulis "equal" agar jelas.
  const payload = {
    label: params.label,
    seed: params.seed,
    burst: params.burst,
    createdAt: new Date().toISOString(),
    baseline: params.baseline,
    others: params.others,
    diffs,
    anyDiff,
    ...(params.extra ?? {}),
  };

  const dir = join(process.cwd(), "test-artifacts");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
  const slug = params.label.replace(/[^a-z0-9_.-]+/gi, "_").toLowerCase();
  const file = join(dir, `${slug}-seed-${params.seed}.json`);
  try {
    writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
    return file;
  } catch {
    return null;
  }
}