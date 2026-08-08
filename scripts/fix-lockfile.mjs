#!/usr/bin/env node
/**
 * `bun run fix:lockfile`
 * Otomatis mengonversi/memperbaiki lockfile sesuai docs/dependency-lockfile.md:
 *  1. Pastikan `bunfig.toml` punya `[install] saveTextLockfile = true`.
 *  2. Hapus lockfile biner `bun.lockb` (dan buang dari index git bila terlacak).
 *  3. Regenerasi `bun.lock` teks lewat `bun install --save-text-lockfile`.
 *  4. Verifikasi ulang dengan scripts/check-text-lockfile.mjs.
 */
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const steps = [];
const log = (m) => { steps.push(m); console.log(m); };

// 1. bunfig.toml
let bunfig = existsSync("bunfig.toml") ? readFileSync("bunfig.toml", "utf8") : "";
if (!/save[-_]?[Tt]ext[-_]?[Ll]ockfile\s*=\s*true/.test(bunfig)) {
  if (/^\s*\[install\]\s*$/m.test(bunfig)) {
    bunfig = bunfig.replace(
      /^(\s*\[install\]\s*)$/m,
      `$1\n# Lockfile wajib format teks agar diff dependency bisa diaudit (docs/dependency-lockfile.md).\nsaveTextLockfile = true`,
    );
  } else {
    bunfig = `${bunfig.trimEnd()}\n\n[install]\n# Lockfile wajib format teks agar diff dependency bisa diaudit (docs/dependency-lockfile.md).\nsaveTextLockfile = true\n`.trimStart();
  }
  writeFileSync("bunfig.toml", bunfig.endsWith("\n") ? bunfig : `${bunfig}\n`);
  log("• bunfig.toml: menyetel saveTextLockfile = true");
} else {
  log("• bunfig.toml: saveTextLockfile sudah aktif");
}

// 2. buang lockfile biner
if (existsSync("bun.lockb")) {
  const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "bun.lockb"], { stdio: "ignore" });
  if (tracked.status === 0) spawnSync("git", ["rm", "--cached", "-q", "bun.lockb"], { stdio: "inherit" });
  rmSync("bun.lockb", { force: true });
  log("• bun.lockb (biner) dihapus");
}

// 3. regenerasi lockfile teks
const needsBinaryConvert =
  !existsSync("bun.lock") || readFileSync("bun.lock").subarray(0, 8).includes(0);
const args = ["install", "--save-text-lockfile"];
if (needsBinaryConvert) args.push("--lockfile-only");
log(`• Menjalankan: bun ${args.join(" ")}`);
const install = spawnSync("bun", args, { stdio: "inherit" });
if (install.status !== 0) {
  console.error("\n❌ `bun install` gagal. Perbaiki error di atas lalu ulangi.");
  process.exit(install.status ?? 1);
}

// 4. verifikasi
const check = spawnSync(process.execPath, ["scripts/check-text-lockfile.mjs"], { stdio: "inherit" });
if (check.status !== 0) {
  console.error("\n❌ Lockfile masih belum sesuai aturan docs/dependency-lockfile.md.");
  process.exit(check.status ?? 1);
}
console.log("\n🎉 Lockfile sudah sesuai aturan. Commit `bun.lock` (dan `bunfig.toml` bila berubah).");
