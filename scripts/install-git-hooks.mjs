#!/usr/bin/env node
/**
 * Arahkan git ke folder hook yang ikut ter-commit (`.githooks/`), supaya
 * pre-commit audit head aktif otomatis setelah `bun install`.
 *
 * Aman dijalankan berulang, dan tidak melakukan apa-apa di CI atau di luar
 * repo git (mis. saat paket dipakai sebagai dependency).
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

if (process.env.CI) {
  console.log("↷ CI terdeteksi — lewati pemasangan git hooks.");
  process.exit(0);
}

try {
  execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
} catch {
  console.log("↷ Bukan repo git — lewati pemasangan git hooks.");
  process.exit(0);
}

const dir = ".githooks";
if (!existsSync(dir)) {
  console.log(`↷ Folder ${dir} tidak ada — lewati.`);
  process.exit(0);
}

for (const file of readdirSync(dir)) {
  try {
    chmodSync(join(dir, file), 0o755);
  } catch {
    // Filesystem tanpa bit executable (mis. Windows) — abaikan.
  }
}

execFileSync("git", ["config", "core.hooksPath", dir], { stdio: "inherit" });
console.log(`✓ Git hooks aktif dari ${dir}/ (pre-commit: audit head).`);