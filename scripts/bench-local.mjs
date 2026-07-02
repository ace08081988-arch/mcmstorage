#!/usr/bin/env node
/**
 * Replikasi lokal suite benchmark Gudang dengan env yang sama seperti CI
 * (.github/workflows/gudang-recompute.yml).
 *
 * Usage:
 *   node scripts/bench-local.mjs                 # jalankan seperti CI default
 *   node scripts/bench-local.mjs --update        # UPDATE_BENCH_BASELINE=1
 *   node scripts/bench-local.mjs --profile       # BENCH_PROFILE=1
 *   node scripts/bench-local.mjs --skip-baseline # SKIP_BENCH_BASELINE=1
 *   node scripts/bench-local.mjs --regression-pct 30 --p95-pct 80 --max-cv 1.5
 *   node scripts/bench-local.mjs --only bench    # cuma benchmark file (bukan seluruh suite)
 *
 * Semua env di bawah bisa dioverride dari shell (env di shell menang atas default script).
 */
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

// Default sama dengan CI workflow_dispatch defaults.
const defaults = {
  BENCH_STRICT: "1",
  BENCH_REGRESSION_PCT: val("--regression-pct", "50"),
  BENCH_P95_PCT: val("--p95-pct", "100"),
  BENCH_MAX_CV: val("--max-cv", "2.0"),
  SKIP_BENCH_BASELINE: has("--skip-baseline") ? "1" : "",
  BENCH_PROFILE: has("--profile") ? "1" : "",
  UPDATE_BENCH_BASELINE: has("--update") ? "1" : "",
};
// --update tanpa arti kalau baseline tidak di-skip → ikuti pola script bench:update-baseline.
if (defaults.UPDATE_BENCH_BASELINE === "1") defaults.SKIP_BENCH_BASELINE = "1";

const env = { ...process.env };
for (const [k, v] of Object.entries(defaults)) {
  if (env[k] === undefined || env[k] === "") env[k] = v;
}

const only = has("--only") ? val("--only", "bench") : null;
const script = only ? null : "test:gudang-recompute";
const benchFile =
  "src/routes/_authenticated.gudang.conflict-wide-fields-benchmark.test.ts";

const [cmd, args] = script
  ? ["npm", ["run", script, "--silent"]]
  : ["npx", ["vitest", "run", benchFile]];

console.log("▶ bench-local env:");
for (const k of [
  "BENCH_STRICT",
  "BENCH_REGRESSION_PCT",
  "BENCH_P95_PCT",
  "BENCH_MAX_CV",
  "SKIP_BENCH_BASELINE",
  "BENCH_PROFILE",
  "UPDATE_BENCH_BASELINE",
]) {
  console.log(`   ${k}=${env[k] || ""}`);
}
console.log(`▶ running: ${cmd} ${args.join(" ")}\n`);

const child = spawn(cmd, args, { env, stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 1));