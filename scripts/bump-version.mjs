#!/usr/bin/env node
/**
 * Bump versionCode/versionName di android/app/build.gradle otomatis.
 *
 * Strategi (khusus Play Store, minim error):
 *   versionCode = max(currentVersionCode + 1, YYMMDDNN)
 *     • YYMMDDNN = YY(2)+MM(2)+DD(2)+NN(2), NN = urutan build hari itu 00–99.
 *     • Contoh 12 Jul 2026, build ke-1: 26071200. Muat sampai tahun 2099
 *       (max int32 Play = 2_100_000_000).
 *     • max() memastikan MONOTONIC NAIK — Play Console menolak versionCode
 *       ≤ yang sudah pernah diupload. Jadi kalau builder di komputer lain
 *       sudah lebih tinggi (mis. 26071215), skrip ini tetap +1.
 *
 *   versionName = "<major>.<minor>.<patch>+YYMMDD.NN"
 *     • Ambil <major.minor.patch> dari argv --set, atau dari package.json
 *       "version", atau dari versionName lama.
 *     • Suffix +tanggal.NN untuk keterbacaan (Play tidak parse ini).
 *
 * Pemakaian:
 *   node scripts/bump-version.mjs                  # bump otomatis
 *   node scripts/bump-version.mjs --set 1.4.0      # set base versionName
 *   node scripts/bump-version.mjs --dry-run        # print rencana, no write
 *   node scripts/bump-version.mjs --print          # hanya cetak versi saat ini
 *   node scripts/bump-version.mjs --json           # output rencana JSON
 *
 * Idempoten: aman dijalankan berkali-kali dalam sehari (NN otomatis maju).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const argv = process.argv.slice(2);
const args = new Set(argv);
function flag(name) {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : undefined;
}

const ROOT = resolve(process.cwd());
// SSOT versi = android/version.properties. build.gradle hanya membacanya.
const VERSION_PROPS = resolve(ROOT, "android/version.properties");
const GRADLE = resolve(ROOT, "android/app/build.gradle");
const PKG = resolve(ROOT, "package.json");

const dryRun = args.has("--dry-run");
const printOnly = args.has("--print");
const jsonOut = args.has("--json");
const setBase = flag("--set");

if (!existsSync(VERSION_PROPS) && !existsSync(GRADLE)) {
  fail(
    `${VERSION_PROPS} tidak ada.\nJalankan \`bunx cap add android\` dulu, lalu ulangi.`,
  );
}

const cur = readVersion();

if (printOnly) {
  console.log(JSON.stringify(cur, null, 2));
  process.exit(0);
}

// ─── Hitung versionCode berikutnya ────────────────────────────────────
const now = new Date();
const yy = String(now.getFullYear() % 100).padStart(2, "0");
const mm = String(now.getMonth() + 1).padStart(2, "0");
const dd = String(now.getDate()).padStart(2, "0");
const datePrefix = Number(`${yy}${mm}${dd}`); // ex 260712
const dateBase = datePrefix * 100; // ex 26071200

// Kalau versionCode lama sudah punya date-prefix hari ini, ambil NN+1.
// Kalau tidak, mulai dari 00 hari ini.
let candidate;
if (Math.floor(cur.versionCode / 100) === datePrefix) {
  candidate = cur.versionCode + 1;
  if (candidate % 100 === 0 && candidate > cur.versionCode + 1) {
    // sudah >99 build hari ini — kembali ke +1 sederhana
  }
} else {
  candidate = dateBase;
}
// Guard monotonic: HARUS > versionCode lama.
const nextCode = Math.max(candidate, cur.versionCode + 1);

if (nextCode >= 2_100_000_000) {
  fail(
    `versionCode ${nextCode} melampaui batas Play Store (2_100_000_000). ` +
      "Ini tidak akan pernah terjadi sebelum tahun 2099 dengan strategi tanggal.",
  );
}
if (nextCode - dateBase > 99) {
  console.log(
    `⚠ sudah lebih dari 99 build hari ini (NN=${nextCode - dateBase}). ` +
      "Aman untuk Play, tapi format YYMMDDNN meleber ke digit ke-9.",
  );
}

// ─── Hitung versionName ───────────────────────────────────────────────
const base = setBase ?? deriveBaseFromExisting(cur.versionName) ?? readPkgVersion() ?? "1.0.0";
if (!/^\d+\.\d+\.\d+$/.test(base)) {
  fail(`--set / package.json version harus format X.Y.Z, dapat: "${base}"`);
}
const nn = String(nextCode - dateBase).padStart(2, "0");
const nextName = `${base}+${yy}${mm}${dd}.${nn}`;

const plan = {
  file: "android/version.properties",
  versionCode: { from: cur.versionCode, to: nextCode },
  versionName: { from: cur.versionName, to: nextName },
  dryRun,
};

if (jsonOut) {
  console.log(JSON.stringify(plan));
  process.exit(0);
}

banner("Bump version");
console.log(`  versionCode : ${cur.versionCode}  →  ${nextCode}`);
console.log(`  versionName : ${cur.versionName}  →  ${nextName}`);

if (dryRun) {
  console.log("\n  --dry-run: tidak ada file yang diubah.");
  process.exit(0);
}

// ─── Tulis kembali ke SSOT ─────────────────────────────────────────────
writeFileSync(
  VERSION_PROPS,
  [
    "# SSOT versi aplikasi Android (dibaca android/app/build.gradle).",
    "# Jangan edit manual saat rilis — pakai: bun run version:bump",
    "# Cek nilai saat ini: bun run version:check",
    `VERSION_CODE=${nextCode}`,
    `VERSION_NAME=${nextName}`,
    "",
  ].join("\n"),
);
console.log("\n  ✓ android/version.properties updated (SSOT)");

process.exit(0);

// ─── util ─────────────────────────────────────────────────────────────
function readVersion() {
  if (existsSync(VERSION_PROPS)) {
    const text = readFileSync(VERSION_PROPS, "utf8");
    const vc = /^VERSION_CODE\s*=\s*(\d+)\s*$/m.exec(text);
    const vn = /^VERSION_NAME\s*=\s*(.+?)\s*$/m.exec(text);
    if (vc && vn) return { versionCode: Number(vc[1]), versionName: vn[1] };
    fail(
      "android/version.properties ada tapi tidak memuat VERSION_CODE / VERSION_NAME.",
    );
  }
  // Fallback (repo lama): baca dari build.gradle.
  return parseGradle(readFileSync(GRADLE, "utf8"));
}
function parseGradle(text) {
  const vc = /versionCode\s+(\d+)/.exec(text);
  const vn = /versionName\s+"([^"]+)"/.exec(text);
  if (!vc) fail("Tidak menemukan `versionCode` di build.gradle.");
  if (!vn) fail("Tidak menemukan `versionName` di build.gradle.");
  return { versionCode: Number(vc[1]), versionName: vn[1] };
}
function deriveBaseFromExisting(name) {
  const m = /^(\d+\.\d+\.\d+)/.exec(name);
  return m ? m[1] : null;
}
function readPkgVersion() {
  if (!existsSync(PKG)) return null;
  try {
    return JSON.parse(readFileSync(PKG, "utf8")).version || null;
  } catch {
    return null;
  }
}
function banner(msg) {
  const line = "═".repeat(msg.length + 4);
  console.log(`\n${line}\n  ${msg}  \n${line}`);
}
function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}