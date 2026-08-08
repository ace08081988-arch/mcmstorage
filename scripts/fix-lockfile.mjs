#!/usr/bin/env node
/**
 * `bun run fix:lockfile`
 * Otomatis mengonversi/memperbaiki lockfile sesuai docs/dependency-lockfile.md:
 *  1. Pastikan `bunfig.toml` punya `[install] saveTextLockfile = true`.
 *  2. Hapus lockfile biner `bun.lockb` (dan buang dari index git bila terlacak).
 *  3. Regenerasi `bun.lock` teks lewat `bun install --save-text-lockfile`.
 *  4. Verifikasi ulang dengan scripts/check-text-lockfile.mjs.
 *
 * Mode `--dry-run` (alias `-n` / `--check`): hanya menampilkan rencana + diff,
 * tanpa menulis `bunfig.toml`, tanpa menghapus `bun.lockb`, dan tanpa menimpa `bun.lock`.
 */
import { existsSync, readFileSync, writeFileSync, rmSync, mkdtempSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DRY = process.argv.slice(2).some((a) => ["--dry-run", "-n", "--check"].includes(a));
const steps = [];
const log = (m) => { steps.push(m); console.log(m); };
const plan = [];
if (DRY) console.log("🔎 Mode dry-run: tidak ada file yang diubah.\n");

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
  if (DRY) {
    plan.push("bunfig.toml → tambahkan `[install] saveTextLockfile = true`");
    log("• [dry-run] bunfig.toml: akan menyetel saveTextLockfile = true");
  } else {
    writeFileSync("bunfig.toml", bunfig.endsWith("\n") ? bunfig : `${bunfig}\n`);
    log("• bunfig.toml: menyetel saveTextLockfile = true");
  }
} else {
  log("• bunfig.toml: saveTextLockfile sudah aktif");
}

// 2. buang lockfile biner
if (existsSync("bun.lockb")) {
  if (DRY) {
    plan.push("bun.lockb → dihapus (dan di-untrack dari git bila terlacak)");
    log("• [dry-run] bun.lockb (biner) akan dihapus");
  } else {
    const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "bun.lockb"], { stdio: "ignore" });
    if (tracked.status === 0) spawnSync("git", ["rm", "--cached", "-q", "bun.lockb"], { stdio: "inherit" });
    rmSync("bun.lockb", { force: true });
    log("• bun.lockb (biner) dihapus");
  }
}

// 3. regenerasi lockfile teks
const needsBinaryConvert =
  !existsSync("bun.lock") || readFileSync("bun.lock").subarray(0, 8).includes(0);

if (DRY) {
  // Regenerasi di direktori sementara supaya bun.lock asli tidak tersentuh.
  const dir = mkdtempSync(join(tmpdir(), "lockfile-dryrun-"));
  copyFileSync("package.json", join(dir, "package.json"));
  writeFileSync(join(dir, "bunfig.toml"), bunfig || "[install]\nsaveTextLockfile = true\n");
  const hadLock = existsSync("bun.lock") && !needsBinaryConvert;
  if (hadLock) copyFileSync("bun.lock", join(dir, "bun.lock"));
  log(`• [dry-run] Simulasi: bun install --save-text-lockfile --lockfile-only (di ${dir})`);
  const sim = spawnSync("bun", ["install", "--save-text-lockfile", "--lockfile-only", "--cwd", dir], {
    stdio: "inherit",
  });
  if (sim.status !== 0) {
    console.error("\n❌ Simulasi `bun install` gagal. Perbaiki error di atas lalu ulangi.");
    process.exit(sim.status ?? 1);
  }
  const generated = join(dir, "bun.lock");
  const diff = spawnSync(
    "git",
    ["--no-pager", "diff", "--no-index", "--color=always", hadLock ? "bun.lock" : "/dev/null", generated],
    { encoding: "utf8" },
  );
  const hasDiff = (diff.stdout ?? "").trim().length > 0;
  console.log("\n── Rencana perubahan ──");
  if (plan.length === 0) console.log("• Tidak ada perubahan file konfigurasi.");
  else plan.forEach((p) => console.log(`• ${p}`));
  console.log("\n── Diff bun.lock ──");
  console.log(hasDiff ? diff.stdout : "• bun.lock sudah sinkron (tidak ada perubahan).");
  rmSync(dir, { recursive: true, force: true });
  const dirty = hasDiff || plan.length > 0;
  console.log(
    dirty
      ? "\n⚠️  Ada perubahan yang perlu diterapkan. Jalankan `bun run fix:lockfile` untuk menulisnya."
      : "\n🎉 Lockfile sudah sesuai aturan — tidak ada yang perlu diperbaiki.",
  );
  process.exit(dirty ? 1 : 0);
}

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
