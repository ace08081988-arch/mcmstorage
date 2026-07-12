#!/usr/bin/env node
/**
 * Wizard signing keystore — buat keystore baru (kalau belum ada),
 * simpan konfigurasi ke `android/keystore.properties` (dibaca Gradle),
 * jaga file tetap di-gitignore, lalu jalankan validator.
 *
 * Pemakaian:
 *   node scripts/setup-keystore.mjs
 *   node scripts/setup-keystore.mjs --force        # regenerate meskipun sudah ada
 *   node scripts/setup-keystore.mjs --non-interactive \
 *     --alias mcm --store ~/keys/mcm.keystore \
 *     --dname "CN=MCM Storage,O=BAROKAH RIZKI,C=ID" \
 *     --validity 10000
 *     (password dibaca dari env: KEYSTORE_STORE_PASS & KEYSTORE_KEY_PASS)
 *
 * Kenapa `android/keystore.properties` (bukan `.env`):
 *   Gradle Android baca sinyal signing dari file properties, bukan dari
 *   proses env var. Menyimpan ke `.env` akan bikin Anda kembali ke langkah
 *   manual (harus copy ke properties). Skrip ini memakai `keystore.properties`
 *   TAPI menerapkan disiplin ".env" — di-gitignore + chmod 600 + tidak
 *   pernah nge-print password ke terminal.
 *
 * Yang dilakukan:
 *   1. Cek `keytool` tersedia.
 *   2. Interaktif tanya: path keystore, alias, DName, validity, password
 *      (input password disembunyikan; konfirmasi 2x).
 *   3. Kalau file keystore belum ada → jalankan `keytool -genkeypair`.
 *      Kalau sudah ada dan tanpa --force → pakai yang ada, hanya tulis
 *      ulang properties + validasi.
 *   4. Tulis `android/keystore.properties` (chmod 600).
 *   5. Pastikan `.gitignore` project + `android/.gitignore` memblokir
 *      keystore file & keystore.properties.
 *   6. Panggil `scripts/validate-keystore.mjs` sebagai final check.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  chmodSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { resolve, dirname, isAbsolute, relative } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
const args = new Set(argv);
function flag(name, fallback) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : fallback;
}

const ROOT = resolve(process.cwd());
const ANDROID_DIR = resolve(ROOT, "android");
const PROPS_PATH = resolve(ANDROID_DIR, "keystore.properties");
const FORCE = args.has("--force");
const NON_INTERACTIVE = args.has("--non-interactive");
// --env-only: JANGAN tulis password ke android/keystore.properties.
// Sebagai gantinya, keluarkan snippet export untuk shell profile.
// Aman untuk CI / komputer bersama.
const ENV_ONLY = args.has("--env-only");

banner("Wizard signing keystore MCM");

// ─── 1. keytool ada? ──────────────────────────────────────────────────
step("1/6  Cek `keytool`");
if (!which("keytool")) {
  fail(
    "`keytool` tidak ditemukan. Install JDK 17 dan set JAVA_HOME:\n" +
      "  export JAVA_HOME=\"$(/usr/libexec/java_home -v 17)\"\n" +
      "  export PATH=\"$JAVA_HOME/bin:$PATH\"",
  );
}
console.log("  ✓ keytool tersedia");

// ─── 2. Kumpulkan input ───────────────────────────────────────────────
step("2/6  Kumpulkan konfigurasi signing");

const rl = NON_INTERACTIVE
  ? null
  : createInterface({ input: process.stdin, output: process.stdout });

const defaultStore = resolve(homedir(), "keys/mcm-release.keystore");
const storeFile = resolveHome(
  flag("--store") ?? (await ask(`Path keystore [${defaultStore}]: `, defaultStore)),
);
const alias = flag("--alias") ?? (await ask("Alias [mcm]: ", "mcm"));
const validity = flag("--validity") ?? (await ask("Validity (hari) [10000]: ", "10000"));
const dname =
  flag("--dname") ??
  (await ask(
    'Distinguished Name [CN=MCM Storage,O=BAROKAH RIZKI,L=Indonesia,C=ID]: ',
    "CN=MCM Storage,O=BAROKAH RIZKI,L=Indonesia,C=ID",
  ));

let storePassword;
let keyPassword;
if (NON_INTERACTIVE) {
  storePassword = process.env.KEYSTORE_STORE_PASS;
  keyPassword = process.env.KEYSTORE_KEY_PASS ?? storePassword;
  if (!storePassword) {
    fail("--non-interactive butuh env KEYSTORE_STORE_PASS (dan opsional KEYSTORE_KEY_PASS).");
  }
} else {
  storePassword = await askPassword("Store password (min 6 char): ");
  if (!storePassword || storePassword.length < 6) {
    fail("Store password terlalu pendek (min 6 char, keytool akan menolak).");
  }
  const storePassword2 = await askPassword("Konfirmasi store password        : ");
  if (storePassword !== storePassword2) fail("Store password tidak cocok.");

  const same = (await ask("Pakai password yang sama untuk key? [Y/n]: ", "Y"))
    .trim()
    .toLowerCase();
  if (same === "" || same === "y" || same === "yes") {
    keyPassword = storePassword;
  } else {
    keyPassword = await askPassword("Key password (min 6 char) : ");
    if (!keyPassword || keyPassword.length < 6) fail("Key password terlalu pendek.");
    const keyPassword2 = await askPassword("Konfirmasi key password   : ");
    if (keyPassword !== keyPassword2) fail("Key password tidak cocok.");
  }
}
rl?.close();

// ─── 3. Generate keystore kalau perlu ─────────────────────────────────
step("3/6  Generate / pakai ulang keystore");
mkdirSync(dirname(storeFile), { recursive: true });

const storeExists = existsSync(storeFile);
if (storeExists && !FORCE) {
  console.log(`  ✓ keystore sudah ada: ${storeFile} (pakai ulang; --force untuk regenerate)`);
  // Cek alias sudah ada di store — kalau belum, tambah.
  const listRes = spawnSync(
    "keytool",
    ["-list", "-keystore", storeFile, "-storepass", storePassword, "-alias", alias],
    { encoding: "utf8" },
  );
  if (listRes.status !== 0) {
    console.log(`  → alias "${alias}" belum ada di store, membuat entry baru…`);
    runKeytool([
      "-genkeypair",
      "-v",
      "-keystore",
      storeFile,
      "-storepass",
      storePassword,
      "-alias",
      alias,
      "-keypass",
      keyPassword,
      "-keyalg",
      "RSA",
      "-keysize",
      "2048",
      "-validity",
      String(validity),
      "-dname",
      dname,
    ]);
    console.log(`  ✓ alias "${alias}" ditambahkan`);
  } else {
    console.log(`  ✓ alias "${alias}" sudah tersedia`);
  }
} else {
  if (storeExists && FORCE) {
    console.log(`  ⚠ --force: keystore lama di ${storeFile} akan ditimpa`);
    // keytool -genkeypair tidak overwrite file — hapus dulu.
    unlinkSync(storeFile);
  }
  console.log(`  → membuat keystore baru di ${storeFile}`);
  runKeytool([
    "-genkeypair",
    "-v",
    "-keystore",
    storeFile,
    "-storetype",
    "PKCS12",
    "-storepass",
    storePassword,
    "-alias",
    alias,
    "-keypass",
    keyPassword,
    "-keyalg",
    "RSA",
    "-keysize",
    "2048",
    "-validity",
    String(validity),
    "-dname",
    dname,
  ]);
  try {
    chmodSync(storeFile, 0o600);
  } catch {
    // Windows: abaikan
  }
  console.log("  ✓ keystore terbuat (chmod 600)");
}

// ─── 4. Tulis android/keystore.properties ─────────────────────────────
step("4/6  Tulis konfigurasi signing");
if (!existsSync(ANDROID_DIR)) mkdirSync(ANDROID_DIR, { recursive: true });

if (ENV_ONLY) {
  // Tulis hanya path + alias (non-secret). Password harus dari env.
  const propsBody =
    `# Auto-generated oleh scripts/setup-keystore.mjs (--env-only)\n` +
    `# Password TIDAK ditulis di sini — baca dari env KEYSTORE_STORE_PASS\n` +
    `# & KEYSTORE_KEY_PASS saat build.\n` +
    `storeFile=${storeFile}\n` +
    `keyAlias=${alias}\n`;
  writeFileSync(PROPS_PATH, propsBody, { mode: 0o600 });
  try {
    chmodSync(PROPS_PATH, 0o600);
  } catch {}
  console.log(`  ✓ ${relative(ROOT, PROPS_PATH)} (chmod 600, tanpa password)`);
  console.log(
    "\n  Tambahkan ke ~/.zshrc atau ~/.bashrc:\n" +
      "    export KEYSTORE_STORE_PASS='<password store Anda>'\n" +
      "    export KEYSTORE_KEY_PASS='<password key Anda>'\n" +
      "\n  Lalu buka terminal baru sebelum jalankan `bun run aab:build`.\n",
  );
} else {
  const propsBody =
    `# Auto-generated oleh scripts/setup-keystore.mjs\n` +
    `# JANGAN commit file ini. Sudah masuk .gitignore.\n` +
    `# Alternatif: pakai --env-only + env var KEYSTORE_STORE_PASS/KEYSTORE_KEY_PASS.\n` +
    `storeFile=${storeFile}\n` +
    `storePassword=${storePassword}\n` +
    `keyAlias=${alias}\n` +
    `keyPassword=${keyPassword}\n`;
  writeFileSync(PROPS_PATH, propsBody, { mode: 0o600 });
  try {
    chmodSync(PROPS_PATH, 0o600);
  } catch {}
  console.log(`  ✓ ${relative(ROOT, PROPS_PATH)} (chmod 600)`);
}

// ─── 5. Update .gitignore ─────────────────────────────────────────────
step("5/6  Pastikan .gitignore memblokir file sensitif");
ensureIgnored(resolve(ROOT, ".gitignore"), [
  "# signing (auto by scripts/setup-keystore.mjs)",
  "android/keystore.properties",
  "*.keystore",
  "*.jks",
]);
if (existsSync(ANDROID_DIR)) {
  ensureIgnored(resolve(ANDROID_DIR, ".gitignore"), [
    "# signing",
    "keystore.properties",
    "*.keystore",
    "*.jks",
  ]);
}
console.log("  ✓ .gitignore up-to-date");

// ─── 6. Validasi akhir ────────────────────────────────────────────────
step("6/6  Validasi keystore end-to-end");
const val = spawnSync("node", [resolve(ROOT, "scripts/validate-keystore.mjs")], {
  stdio: "inherit",
  env: {
    ...process.env,
    // Passthrough kredensial in-memory ke validator, terutama saat --env-only
    // di mana android/keystore.properties tidak menyimpan password.
    KEYSTORE_FILE: storeFile,
    KEYSTORE_ALIAS: alias,
    KEYSTORE_STORE_PASS: storePassword,
    KEYSTORE_KEY_PASS: keyPassword,
  },
});
if (val.status !== 0) {
  fail("Validator gagal. Cek output di atas.");
}

banner("Selesai — keystore siap dipakai");
console.log(
  "Langkah berikutnya:\n" +
    "  bun run aab:build              # build AAB signed release\n" +
    "\n" +
    "Simpan BACKUP file keystore & password Anda di 2 tempat aman\n" +
    "(mis. password manager + external drive terenkripsi). Kehilangan\n" +
    "keystore = tidak bisa update aplikasi di Play Store lagi.\n",
);
process.exit(0);

// ─── util ─────────────────────────────────────────────────────────────
function ask(prompt, fallback) {
  if (!rl) return Promise.resolve(fallback ?? "");
  return new Promise((res) => rl.question(prompt, (a) => res(a.trim() || fallback || "")));
}
function askPassword(prompt) {
  if (!rl) return Promise.resolve("");
  return new Promise((res) => {
    const stdin = process.stdin;
    const onData = (buf) => {
      // Suppress echo: setiap char yang masuk, timpa dengan '*'.
      // (readline sudah handle; kita hanya ganti output.)
    };
    // readline internal: mute output selama pertanyaan ini.
    const origWrite = rl._writeToOutput?.bind(rl);
    if (origWrite) {
      rl._writeToOutput = (s) => {
        // Tampilkan prompt awal, sensor input.
        if (s.startsWith(prompt)) origWrite(s);
        else origWrite("*");
      };
    }
    rl.question(prompt, (a) => {
      if (origWrite) rl._writeToOutput = origWrite;
      process.stdout.write("\n");
      res(a);
    });
  });
}
function resolveHome(p) {
  if (!p) return p;
  if (p.startsWith("~")) return resolve(homedir(), p.slice(2));
  return isAbsolute(p) ? p : resolve(ROOT, p);
}
function runKeytool(a) {
  const r = spawnSync("keytool", a, { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) fail(`keytool gagal (exit ${r.status}). Lihat output di atas.`);
}
function which(cmd) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], {
    encoding: "utf8",
  });
  return r.status === 0 && r.stdout.trim() ? r.stdout.split("\n")[0].trim() : null;
}
function ensureIgnored(gitignorePath, lines) {
  let existing = "";
  if (existsSync(gitignorePath)) existing = readFileSync(gitignorePath, "utf8");
  const missing = lines.filter((l) => l.startsWith("#") || !existing.split(/\r?\n/).includes(l));
  // Hanya tulis line non-komentar yang benar-benar belum ada.
  const toAppend = lines.filter((l) => {
    if (l.startsWith("#")) return true; // header komentar
    return !existing.split(/\r?\n/).includes(l);
  });
  // Kalau semua non-komentar sudah ada, skip.
  const nonCommentMissing = missing.filter((l) => !l.startsWith("#"));
  if (nonCommentMissing.length === 0) return;
  const prefix = existing.length && !existing.endsWith("\n") ? "\n" : "";
  appendFileSync(gitignorePath, `${prefix}${toAppend.join("\n")}\n`);
}
function banner(msg) {
  const line = "═".repeat(msg.length + 4);
  console.log(`\n${line}\n  ${msg}  \n${line}`);
}
function step(msg) {
  console.log(`\n▶ ${msg}`);
}
function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}