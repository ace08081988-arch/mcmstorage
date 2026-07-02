/**
 * Ringkasan flakiness per-scenario yang dipecah menurut penyebabnya
 * (guard p95, guard CV, dan floor guard yang memblokir false-positive).
 *
 * Dipakai oleh benchmark `afterAll` untuk menulis satu section terpisah ke
 * `$GITHUB_STEP_SUMMARY` supaya akar penyebab flakiness (naik p95, high CV,
 * atau margin absolut kecil di bawah floor) langsung terlihat.
 */
import type { FlakinessCheck } from "./bench-baseline";

export type FlakinessRootCause =
  | "p95_over_baseline"
  | "cv_over_max"
  | "p95_and_cv"
  | "p95_blocked_by_floor"
  | "no_baseline"
  | "clean";

export function classifyFlakiness(check: FlakinessCheck): FlakinessRootCause {
  if (check.p95GuardTripped && check.cvGuardTripped) return "p95_and_cv";
  if (check.p95GuardTripped) return "p95_over_baseline";
  if (check.cvGuardTripped) return "cv_over_max";
  if (check.floorGuardBlocked) return "p95_blocked_by_floor";
  if (check.baselineP95Ms == null) return "no_baseline";
  return "clean";
}

const LABEL: Record<FlakinessRootCause, string> = {
  p95_and_cv: "❌ p95 + CV",
  p95_over_baseline: "❌ p95",
  cv_over_max: "❌ CV",
  p95_blocked_by_floor: "🛡️ floor guard",
  no_baseline: "⏭ no baseline",
  clean: "✅ bersih",
};

function fmt(n: number | null | undefined, digits = 3): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export function formatFlakinessMarkdown(checks: readonly FlakinessCheck[]): string {
  const md: string[] = [];
  md.push("### 🎛️ Flakiness breakdown per scenario");
  md.push("");
  md.push(
    "Kategori: **p95** (p95 > baseline·(1+pct%) DAN Δ > floor), " +
      "**CV** (coefficient of variation > max), " +
      "**floor guard** (p95 melampaui ambang persen tapi Δ absolut ≤ floor — dianggap noise).",
  );
  md.push("");
  if (checks.length === 0) {
    md.push("_Tidak ada scenario yang diperiksa._");
    return md.join("\n") + "\n";
  }
  md.push(
    "| Scenario | Mode | p95 | Baseline p95 | Allowed p95 | p95 Δ ms | p95 Δ % | Ambang % | CV | maxCV | Floor ms | Guard p95 | Guard CV | Akar |",
  );
  md.push(
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: | :---: | :--- |",
  );
  for (const c of checks) {
    md.push(
      `| ${c.scenario} | ${c.mode ?? "—"} | ${fmt(c.p95Ms)} | ${fmt(c.baselineP95Ms)} | ` +
        `${fmt(c.allowedP95Ms)} | ${fmt(c.p95AbsDeltaMs)} | ${pct(c.p95DeltaPct)} | ` +
        `${c.p95Pct}% | ${fmt(c.cv)} | ${fmt(c.maxCv)} | ${fmt(c.floorMs)} | ` +
        `${c.p95GuardTripped ? "❌" : c.floorGuardBlocked ? "🛡️" : "✅"} | ` +
        `${c.cvGuardTripped ? "❌" : "✅"} | ${LABEL[classifyFlakiness(c)]} |`,
    );
  }

  // Ringkasan penyebab agar cepat dilihat.
  const buckets: Record<FlakinessRootCause, string[]> = {
    p95_and_cv: [],
    p95_over_baseline: [],
    cv_over_max: [],
    p95_blocked_by_floor: [],
    no_baseline: [],
    clean: [],
  };
  for (const c of checks) buckets[classifyFlakiness(c)].push(c.scenario);

  md.push("");
  md.push("**Ringkas per akar penyebab**");
  md.push("");
  const explain: Record<FlakinessRootCause, string> = {
    p95_and_cv:
      "p95 melewati ambang **dan** CV di atas batas — kemungkinan regresi + noise tinggi; investigasi paling prioritas.",
    p95_over_baseline:
      "p95 melewati ambang baseline dengan Δ absolut > floor — indikasi regresi durasi ekor.",
    cv_over_max:
      "Distribusi sampel terlalu lebar — CV > maxCV. Cek jitter (GC, tetangga proses, timer resolution).",
    p95_blocked_by_floor:
      "p95 secara persen naik, tapi selisih absolut ≤ floor — noise sub-ms yang wajar; tidak dihitung flaky.",
    no_baseline:
      "Belum ada p95 baseline untuk scenario ini — jalankan dengan `UPDATE_BENCH_BASELINE=1` untuk mengkalibrasi.",
    clean:
      "Dalam batas — tidak ada tindakan.",
  };
  for (const cause of Object.keys(buckets) as FlakinessRootCause[]) {
    const list = buckets[cause];
    if (list.length === 0) continue;
    md.push(`- ${LABEL[cause]} (${list.length}): \`${list.join("`, `")}\` — ${explain[cause]}`);
  }
  return md.join("\n") + "\n";
}