#!/usr/bin/env node
/**
 * Runner batch untuk spec E2E APK. Klasifikasi otomatis per file:
 *   - `full`     → spec meng-import `installServerFnPassthroughGuard`
 *                  (terminalGuard + passthrough).
 *   - `terminal` → spec hanya memakai `stub.terminalGuard()`.
 *
 * Pemakaian:
 *   node scripts/run-apk-e2e.mjs                # jalankan KEDUA grup
 *   node scripts/run-apk-e2e.mjs --mode terminal
 *   node scripts/run-apk-e2e.mjs --mode full
 *   node scripts/run-apk-e2e.mjs --list         # klasifikasi saja, no run
 *
 * Argumen ekstra diteruskan apa adanya ke `playwright test`:
 *   node scripts/run-apk-e2e.mjs -- --reporter=list --workers=1
 *
 * Konvensi nama project: `<basename-spec>-e2e` (dipakai oleh generator
 * `scripts/scaffold-apk-e2e-spec.mjs`). Bila project belum terdaftar di
 * `playwright.config.ts`, Playwright akan error — daftarkan dulu.
 */
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const ROOT = process.cwd();
const SPEC_DIR = path.join(ROOT, "tests/e2e");

function parseArgs(argv) {
  const out = { mode: "both", list: false, extra: [] };
  let passthrough = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (passthrough) {
      out.extra.push(a);
      continue;
    }
    if (a === "--") {
      passthrough = true;
      continue;
    }
    if (a === "--list") out.list = true;
    else if (a === "--mode") out.mode = argv[++i] ?? "";
    else if (a.startsWith("--mode=")) out.mode = a.slice("--mode=".length);
    else if (a === "--full") out.mode = "full";
    else if (a === "--terminal" || a === "--terminal-only") out.mode = "terminal";
    else if (a === "--both") out.mode = "both";
    else out.extra.push(a);
  }
  return out;
}

const VALID_MODES = new Set(["terminal", "full", "both"]);

async function classifyApkSpecs() {
  const entries = await fs.readdir(SPEC_DIR);
  const specs = entries
    .filter((f) => f.startsWith("apk-") && f.endsWith(".spec.ts"))
    .sort();
  const terminal = [];
  const full = [];
  for (const file of specs) {
    const src = await fs.readFile(path.join(SPEC_DIR, file), "utf8");
    const isFull = /\binstallServerFnPassthroughGuard\s*\(/.test(src);
    const basename = file.replace(/\.spec\.ts$/, "");
    const project = `${basename}-e2e`;
    (isFull ? full : terminal).push({ file, project });
  }
  return { terminal, full };
}

function runPlaywright(projects, extra) {
  return new Promise((resolve) => {
    const args = ["playwright", "test"];
    for (const p of projects) args.push(`--project=${p}`);
    args.push(...extra);
    const child = spawn("bunx", args, { stdio: "inherit" });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", (err) => {
      console.error(err);
      resolve(1);
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (!VALID_MODES.has(args.mode)) {
    console.error(
      `✗ Mode "${args.mode}" tidak dikenal. Pilih: terminal | full | both.`,
    );
    process.exit(1);
  }

  const { terminal, full } = await classifyApkSpecs();

  if (args.list) {
    console.log(`── Klasifikasi spec E2E APK ──`);
    console.log(`\nterminalGuard-only (${terminal.length}):`);
    terminal.forEach((s) => console.log(`  • ${s.file}  →  --project=${s.project}`));
    console.log(`\nfull guards (terminal + passthrough) (${full.length}):`);
    full.forEach((s) => console.log(`  • ${s.file}  →  --project=${s.project}`));
    return;
  }

  const groups = [];
  if (args.mode === "terminal" || args.mode === "both")
    groups.push({ label: "terminalGuard-only", specs: terminal });
  if (args.mode === "full" || args.mode === "both")
    groups.push({ label: "full guards (terminal + passthrough)", specs: full });

  let overall = 0;
  for (const g of groups) {
    if (g.specs.length === 0) {
      console.log(`\n▸ ${g.label}: (0 spec — dilewati)`);
      continue;
    }
    console.log(`\n▸ ${g.label} — ${g.specs.length} spec`);
    for (const s of g.specs) console.log(`    --project=${s.project}`);
    const code = await runPlaywright(g.specs.map((s) => s.project), args.extra);
    console.log(`▸ ${g.label} exit: ${code}`);
    if (code !== 0 && overall === 0) overall = code;
  }

  process.exit(overall);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});