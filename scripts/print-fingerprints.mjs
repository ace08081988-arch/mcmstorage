#!/usr/bin/env node
/**
 * Cetak SHA-1 dan SHA-256 sertifikat dari alias di keystore.
 *
 * Berguna untuk mendaftarkan sidik jari (fingerprint) ke:
 *   - Google Play Console (App signing / Upload key)
 *   - Firebase / Google Cloud OAuth (Android client SHA-1 & SHA-256)
 *   - Google Sign-In / Maps API restrictions
 *
 * Pemakaian:
 *   node scripts/print-fingerprints.mjs
 *   node scripts/print-fingerprints.mjs --alias mcm
 *   node scripts/print-fingerprints.mjs --store ~/keys/mcm.keystore --alias mcm
 *   node scripts/print-fingerprints.mjs --json
 *   node scripts/print-fingerprints.mjs --copy       # salin SHA-1 ke clipboard
 *   node scripts/print-fingerprints.mjs --copy sha256
 *
 * Prioritas kredensial: CLI flag > env var > android/keystore.properties.
 * Env yang diakui: KEYSTORE_FILE, KEYSTORE_ALIAS, KEYSTORE_STORE_PASSWORD.
 *
 * Exit 0 = fingerprint berhasil dicetak.
 * Exit 1 = keytool gagal / keystore/alias/password salah.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { homedir, platform } from "node:os";

const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}
function has(name) {
  return argv.includes(name);
}

const ROOT = resolve(process.cwd());
const propsPath = resolve(ROOT, flag("--props") ?? "android/keystore.properties");
const wantJson = has("--json");
const copyArg = argv.includes("--copy")
  ? argv[argv.indexOf("--copy") + 1] && !argv[argv.indexOf("--copy") + 1].startsWith("--")
    ? argv[argv.indexOf("--copy") + 1]
    : "sha1"
  : null;

let storeFile = flag("--store") ?? process.env.KEYSTORE_FILE;
let alias = flag("--alias") ?? process.env.KEYSTORE_ALIAS;
let storePassword = flag("--store-pass") ?? (process.env.KEYSTORE_STORE_PASSWORD ?? process.env.KEYSTORE_STORE_PASSWORD);

// Isi field yang kosong dari keystore.properties (opsional).
if ((!storeFile || !alias || !storePassword) && existsSync(propsPath)) {
  const raw = readFileSync(propsPath, "utf8");
  const parsed = Object.fromEntries(
    raw
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.trim().startsWith("#"))
      .map((l) => {
        const idx = l.indexOf("=");
        return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
      }),
  );
  storeFile ??= parsed.storeFile;
  alias ??= parsed.keyAlias;
  storePassword ??= parsed.storePassword;
}

if (!storeFile) fail("Store file tidak diketahui. Set KEYSTORE_FILE atau --store <path>.");
if (!alias) fail("Alias tidak diketahui. Set KEYSTORE_ALIAS atau --alias <name>.");
if (!storePassword)
  fail(
    "Store password tidak diketahui. Set KEYSTORE_STORE_PASSWORD atau --store-pass <pw>,\n" +
      "  atau isi storePassword di android/keystore.properties.",
  );

const expandedStore = storeFile.startsWith("~")
  ? resolve(homedir(), storeFile.slice(2))
  : isAbsolute(storeFile)
    ? storeFile
    : resolve(ROOT, "android", storeFile);

if (!existsSync(expandedStore)) fail(`Store file tidak ada: ${expandedStore}`);

const res = spawnSync(
  "keytool",
  ["-list", "-v", "-keystore", expandedStore, "-alias", alias, "-storepass", storePassword],
  { encoding: "utf8" },
);

if (res.error) fail(`Gagal menjalankan keytool: ${res.error.message}`);
if (res.status !== 0) {
  const msg = (res.stderr || res.stdout || "").trim();
  fail(`keytool exit ${res.status}. Cek alias/password:\n${msg}`);
}

const out = res.stdout;
const sha1 = pick(out, /SHA1:\s*([0-9A-F:]+)/i);
const sha256 = pick(out, /SHA256:\s*([0-9A-F:]+)/i);
const md5 = pick(out, /MD5:\s*([0-9A-F:]+)/i);
const validUntil = pick(out, /Valid from:.*?until:\s*(.+)/i);
const owner = pick(out, /Owner:\s*(.+)/);

if (!sha1 || !sha256) {
  fail(
    "Tidak menemukan SHA-1/SHA-256 di output keytool. Output mentah:\n" + out,
  );
}

if (wantJson) {
  console.log(
    JSON.stringify(
      { alias, storeFile: expandedStore, owner, validUntil, md5, sha1, sha256 },
      null,
      2,
    ),
  );
} else {
  console.log("");
  console.log(`  Keystore : ${expandedStore}`);
  console.log(`  Alias    : ${alias}`);
  if (owner) console.log(`  Owner    : ${owner}`);
  if (validUntil) console.log(`  Berlaku  : hingga ${validUntil}`);
  console.log("");
  if (md5) console.log(`  MD5    : ${md5}`);
  console.log(`  SHA-1  : ${sha1}`);
  console.log(`  SHA-256: ${sha256}`);
  console.log("");
  console.log("  Salin ke Play Console / Firebase / Google OAuth.");
  console.log("");
}

if (copyArg) {
  const key = copyArg.toLowerCase().replace(/-/g, "");
  const value = key === "sha256" ? sha256 : key === "md5" ? md5 : sha1;
  const label = key === "sha256" ? "SHA-256" : key === "md5" ? "MD5" : "SHA-1";
  const ok = copyToClipboard(value);
  if (ok) console.log(`  ✓ ${label} disalin ke clipboard.`);
  else console.log(`  ⚠ Tidak bisa akses clipboard di sistem ini. ${label}: ${value}`);
}

function pick(text, re) {
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function copyToClipboard(text) {
  const p = platform();
  const cmd =
    p === "darwin"
      ? ["pbcopy", []]
      : p === "win32"
        ? ["clip", []]
        : ["xclip", ["-selection", "clipboard"]];
  const r = spawnSync(cmd[0], cmd[1], { input: text });
  if (r.status === 0) return true;
  if (p === "linux") {
    const r2 = spawnSync("wl-copy", [], { input: text });
    return r2.status === 0;
  }
  return false;
}