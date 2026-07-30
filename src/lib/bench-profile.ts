/**
 * Per-function timing profiler untuk micro-benchmark.
 *
 * Aktifkan lewat env `BENCH_PROFILE=1` (atau otomatis ketika suatu
 * scenario melampaui ambang regresi/flakiness). Profiler membungkus
 * fungsi target (mis. `computeBeliDerived`, `computeBeliWarnings`)
 * dan mencatat durasi tiap panggilan sehingga kita bisa melihat
 * bottleneck real, bukan sekedar total durasi.
 *
 * Overhead per call ~0.5–2 µs (dua `performance.now()` + push array),
 * jadi profiler HANYA dipakai di pass profiling terpisah; loop
 * pengukuran normal tetap memakai spy tanpa timing untuk menjaga
 * angka best/p95 tetap wajar.
 */

import { summarize, type SampleSummary } from "./bench-stats";

export type ProfileRecord = {
  /** Nama fungsi yang di-profile (mis. "computeBeliDerived"). */
  name: string;
  /** Durasi tiap panggilan dalam milidetik, urut kronologis. */
  durations: number[];
  /** Total durasi kumulatif (ms). */
  totalMs: number;
  /** Ringkasan statistik durasi call individual. */
  stats: SampleSummary;
};

export type ProfileReport = {
  scenario: string;
  mode: "batched" | "sequential";
  totalMs: number;
  records: ProfileRecord[];
  /**
   * Bottleneck ranking berdasarkan share totalMs — descending. Setiap entry
   * juga membawa `sharePct` (share dari total profil untuk scenario ini)
   * agar bisa diprioritaskan optimalisasi.
   */
  bottlenecks: Array<{ name: string; totalMs: number; calls: number; sharePct: number }>;
};

type Profiler = {
  /**
   * Bungkus fungsi target — hasilnya bisa dipakai sebagai drop-in replacement.
   * Setiap invocation mencatat durasinya ke record dengan nama `name`.
   */
  wrap<A extends unknown[], R>(name: string, fn: (...args: A) => R): (...args: A) => R;
  /**
   * Tutup profiler, kembalikan report siap serialisasi. Idempoten — panggilan
   * kedua akan mengembalikan snapshot yang sama.
   */
  finalize(scenario: string, mode: "batched" | "sequential", totalMs: number): ProfileReport;
  /** True bila profiler benar-benar mencatat (env aktif atau force=true). */
  readonly enabled: boolean;
};

/**
 * Buat profiler baru. `enabled=false` menghasilkan wrapper no-op supaya
 * kode pemanggil bisa selalu `wrap(...)` tanpa cabang if.
 */
export function createProfiler(enabled: boolean): Profiler {
  const durations = new Map<string, number[]>();

  return {
    enabled,
    wrap<A extends unknown[], R>(name: string, fn: (...args: A) => R): (...args: A) => R {
      if (!enabled) return fn;
      if (!durations.has(name)) durations.set(name, []);
      const bucket = durations.get(name)!;
      return (...args: A): R => {
        const t0 = performance.now();
        try {
          return fn(...args);
        } finally {
          bucket.push(performance.now() - t0);
        }
      };
    },
    finalize(scenario, mode, totalMs) {
      const records: ProfileRecord[] = [];
      for (const [name, arr] of durations.entries()) {
        const total = arr.reduce((s, x) => s + x, 0);
        records.push({
          name,
          durations: arr,
          totalMs: total,
          stats: summarize(arr.length > 0 ? arr : [0]),
        });
      }
      records.sort((a, b) => b.totalMs - a.totalMs);
      const bottlenecks = records.map((r) => ({
        name: r.name,
        totalMs: r.totalMs,
        calls: r.durations.length,
        sharePct: totalMs > 0 ? (r.totalMs / totalMs) * 100 : 0,
      }));
      return { scenario, mode, totalMs, records, bottlenecks };
    },
  };
}

/**
 * Cek apakah profiling aktif berdasarkan env. Truthy: "1", "true", "yes".
 */
export function isProfilingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.BENCH_PROFILE;
  if (!v) return false;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
}

/**
 * Format report ke Markdown table — dipakai untuk step summary & artifact.
 */
export function formatProfileMarkdown(reports: ProfileReport[]): string {
  const md: string[] = [];
  md.push("### 🔬 Profiling per-fungsi (bottleneck)");
  md.push("");
  if (reports.length === 0) {
    md.push("_Tidak ada profil terekam. Aktifkan `BENCH_PROFILE=1` atau lampaui ambang regresi/flakiness._");
    return md.join("\n") + "\n";
  }
  for (const r of reports) {
    md.push(`#### \`${r.scenario}\` (${r.mode}) — total ${r.totalMs.toFixed(3)}ms`);
    md.push("");
    md.push("| Fungsi | Calls | Total (ms) | Share % | Best | p50 | p95 | Worst | Mean |");
    md.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const b of r.bottlenecks) {
      const rec = r.records.find((x) => x.name === b.name)!;
      md.push(
        `| ${b.name} | ${b.calls} | ${b.totalMs.toFixed(3)} | ${b.sharePct.toFixed(1)}% | ` +
          `${rec.stats.best.toFixed(4)} | ${rec.stats.p50.toFixed(4)} | ${rec.stats.p95.toFixed(4)} | ` +
          `${rec.stats.worst.toFixed(4)} | ${rec.stats.mean.toFixed(4)} |`,
      );
    }
    md.push("");
  }
  return md.join("\n") + "\n";
}
