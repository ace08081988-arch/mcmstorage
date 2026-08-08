#!/usr/bin/env node
/**
 * Menjaga lockfile tetap format teks (`bun.lock`) supaya diff dependency bisa
 * diverifikasi scanner & reviewer. Lihat docs/dependency-lockfile.md.
 */
import { existsSync, readFileSync } from "node:fs";

const problems = [];

if (existsSync("bun.lockb")) {
  problems.push(
    "`bun.lockb` (lockfile biner) ditemukan. Hapus file itu lalu jalankan `bun install` untuk menulis `bun.lock`.",
  );
}

if (!existsSync("bun.lock")) {
  problems.push("`bun.lock` tidak ada. Jalankan `bun install` untuk membuat lockfile teks.");
} else {
  const head = readFileSync("bun.lock").subarray(0, 8);
  if (head.includes(0)) problems.push("`bun.lock` terlihat biner, bukan teks. Regenerasi dengan `bun install`.");
}

const bunfig = existsSync("bunfig.toml") ? readFileSync("bunfig.toml", "utf8") : "";
if (!/save[-_]?[Tt]ext[-_]?[Ll]ockfile\s*=\s*true/.test(bunfig)) {
  problems.push("`bunfig.toml` belum menyetel `saveTextLockfile = true` di blok `[install]`.");
}

if (problems.length) {
  console.error("❌ Cek lockfile gagal:\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error("\nPanduan: docs/dependency-lockfile.md");
  process.exit(1);
}

console.log("✅ Lockfile teks (`bun.lock`) valid dan `saveTextLockfile` aktif.");
