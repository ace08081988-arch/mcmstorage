#!/usr/bin/env node
/**
 * Audit head/SEO untuk pre-commit hook.
 *
 * Tujuan: mismatch tag head (title/description/OG/twitter/canonical, ikon,
 * manifest, cache-buster aset) tidak sempat masuk ke commit — kegagalan
 * ditangkap di mesin developer, bukan di CI.
 *
 * Supaya commit tetap cepat, audit hanya dijalankan bila ada file staged yang
 * benar-benar bisa mengubah tag head. Commit yang hanya menyentuh, mis., file
 * dokumen atau komponen non-rute akan lewat tanpa menjalankan vitest.
 *
 * Lewati sekali: `SKIP_HEAD_AUDIT=1 git commit ...`
 * Paksa jalan  : `node scripts/pre-commit-head-audit.mjs --all`
 */
import { execFileSync, spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const force = args.includes("--all");

if (process.env.SKIP_HEAD_AUDIT === "1" && !force) {
  console.log("↷ Audit head dilewati (SKIP_HEAD_AUDIT=1).");
  process.exit(0);
}

/** Pola file yang bisa mengubah tag head / aset brand. */
const WATCHED = [
  /^src\/routes\//,
  /^src\/lib\/seo-meta\.ts$/,
  /^src\/lib\/asset-version\.ts$/,
  /^src\/lib\/structured-data\.ts$/,
  /^src\/lib\/head-audit\.ts$/,
  /^src\/lib\/rendered-head-audit\.ts$/,
  /^src\/lib\/route-seo-audit\.ts$/,
  /^public\/(_headers|robots\.txt|manifest\.webmanifest|browserconfig\.xml)$/,
  /^public\/.*\.(png|svg|ico|webmanifest|xml)$/,
];

export function isWatchedPath(path) {
  return WATCHED.some((re) => re.test(path));
}

function stagedFiles() {
  try {
    return execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
      encoding: "utf8",
    })
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function run(cmd, cmdArgs) {
  const res = spawnSync(cmd, cmdArgs, { stdio: "inherit", shell: process.platform === "win32" });
  return res.status ?? 1;
}

// Dipakai juga sebagai modul oleh unit test — jangan eksekusi saat di-import.
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const files = force ? ["--all"] : stagedFiles();
  const relevant = force ? files : files.filter(isWatchedPath);

  if (!relevant.length) {
    console.log("↷ Tidak ada perubahan yang memengaruhi tag head — audit dilewati.");
    process.exit(0);
  }

  console.log(
    `→ Audit head untuk ${relevant.length} file staged:\n  ${relevant.slice(0, 10).join("\n  ")}${
      relevant.length > 10 ? `\n  …(+${relevant.length - 10} lagi)` : ""
    }\n`,
  );

  const runner = process.env.HEAD_AUDIT_RUNNER || "bunx";
  let code = run(runner, ["vitest", "run", "src/lib/__tests__/route-seo-audit.test.ts"]);
  if (code === 0) {
    code = run(runner, [
      "vitest",
      "run",
      "src/lib/__tests__/head-audit.test.ts",
      "src/lib/__tests__/rendered-head-audit.test.ts",
    ]);
  }
  if (code === 0) code = run("node", ["scripts/audit-seo-routes.mjs"]);
  if (code === 0) code = run("bun", ["scripts/audit-asset-version.ts"]);

  if (code !== 0) {
    console.error(
      "\n✗ Audit head GAGAL — commit dibatalkan.\n" +
        "  Perbaiki metadata/aset yang mismatch, atau jalankan `bun run audit:seo:fix`.\n" +
        "  Darurat: `SKIP_HEAD_AUDIT=1 git commit ...`\n",
    );
    process.exit(code);
  }
  console.log("\n✓ Audit head lulus — commit dilanjutkan.");
}