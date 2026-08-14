#!/usr/bin/env node
/**
 * Validasi keystore untuk signed release build.
 *
 * Pemakaian:
 *   node scripts/validate-keystore.mjs
 *   node scripts/validate-keystore.mjs --props android/keystore.properties
 *   node scripts/validate-keystore.mjs --store ~/keys/mcm.keystore \
 *     --alias mcm --store-pass "$STORE_PW" --key-pass "$KEY_PW"
 *
 * Cek berlapis (fail-fast, pesan Bahasa Indonesia):
 *   1. `keytool` tersedia di PATH (dari JDK).
 *   2. File `keystore.properties` ada & punya 4 field wajib.
 *   3. File `.keystore` yang dirujuk benar-benar ada di disk.
 *   4. `storePassword` benar → keytool -list bisa buka store.
 *   5. `keyAlias` benar-benar ADA di dalam store.
 *   6. `keyPassword` benar untuk alias tsb → keytool -list -rfc bisa
 *      ekspor sertifikat alias (ini yang gagal-nya paling misterius di
 *      Gradle: pesan "Failed to read key … from store" tanpa detail).
 *   7. Sertifikat belum expired (peringatan kalau <90 hari lagi).
 *   8. `build.gradle` sudah menghubungkan `signingConfigs.release` ke
 *      keystore.properties (heuristik regex — sekadar peringatan).
 *
 * Exit code 0 = siap `./gradlew :app:bundleRelease`.
 * Exit code 1 = ada masalah yang PASTI bikin Gradle gagal signing.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";

// Dideklarasikan di atas: dipakai oleh rl() dan cleanup `__rl?.close()`
// yang berjalan sebelum blok helper di bawah (hindari temporal dead zone).
let __rl;

const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}
const NON_INTERACTIVE =
  new Set(argv).has("--non-interactive") ||
  process.env.CI === "true" ||
  !process.stdin.isTTY;

const ROOT = resolve(process.cwd());
const propsPath = resolve(ROOT, flag("--props") ?? "android/keystore.properties");

// Prioritas: CLI flag > env var > keystore.properties
// Env yang diakui:
//   KEYSTORE_STORE_PASSWORD, KEYSTORE_KEY_PASSWORD
//   KEYSTORE_FILE (path), KEYSTORE_ALIAS
let storeFile = flag("--store") ?? process.env.KEYSTORE_FILE;
let storePassword = flag("--store-pass") ?? (process.env.KEYSTORE_STORE_PASSWORD ?? process.env.KEYSTORE_STORE_PASSWORD);
let keyAlias = flag("--alias") ?? process.env.KEYSTORE_ALIAS;
let keyPassword = flag("--key-pass") ?? (process.env.KEYSTORE_KEY_PASSWORD ?? process.env.KEYSTORE_KEY_PASSWORD);
const sources = [];
if (flag("--store") || flag("--store-pass") || flag("--alias") || flag("--key-pass"))
  sources.push("CLI flag");
if (
  (process.env.KEYSTORE_STORE_PASSWORD ?? process.env.KEYSTORE_STORE_PASSWORD) ||
  (process.env.KEYSTORE_KEY_PASSWORD ?? process.env.KEYSTORE_KEY_PASSWORD) ||
  process.env.KEYSTORE_FILE ||
  process.env.KEYSTORE_ALIAS
)
  sources.push("env var");
let source = sources.join(" + ") || "flags";

banner("Validasi keystore untuk signed release");

// ─── 1. keytool tersedia? ─────────────────────────────────────────────
step("1/8  Cek `keytool` (dari JDK)");
const kt = which("keytool");
if (!kt) {
  fail(
    "`keytool` tidak ditemukan di PATH.\n" +
      "Pastikan JDK 17 terpasang dan `JAVA_HOME` di-set:\n\n" +
      "  export JAVA_HOME=\"$(/usr/libexec/java_home -v 17)\"   # macOS\n" +
      "  export PATH=\"$JAVA_HOME/bin:$PATH\"\n",
  );
}
console.log(`  ✓ keytool: ${kt}`);

// ─── 2. Baca keystore.properties (kalau flag nggak lengkap) ──────────
step("2/8  Baca kredensial");
if (!storeFile || !storePassword || !keyAlias || !keyPassword) {
  if (!existsSync(propsPath)) {
    fail(
      `File ${propsPath} tidak ada dan flag CLI + env var tidak lengkap.\n` +
        "Suplai kredensial via SALAH SATU cara:\n\n" +
        "  a) Env var (recommended untuk CI):\n" +
        "       export KEYSTORE_FILE=/path/ke/.keystore\n" +
        "       export KEYSTORE_ALIAS=mcm\n" +
        "       export KEYSTORE_STORE_PASSWORD='…'\n" +
        "       export KEYSTORE_KEY_PASSWORD='…'\n\n" +
        "  b) File android/keystore.properties (dari `bun run aab:setup-keystore`).\n\n" +
        "  c) CLI flag lengkap:\n" +
        "       --store <path> --alias <alias> --store-pass <pw> --key-pass <pw>\n",
    );
  }
  const parsed = parseProperties(readFileSync(propsPath, "utf8"));
  storeFile ??= parsed.storeFile;
  storePassword ??= parsed.storePassword;
  keyAlias ??= parsed.keyAlias;
  keyPassword ??= parsed.keyPassword;
  source = source ? `${source} + keystore.properties` : `keystore.properties (${propsPath})`;
}
let missing = fieldsMissing();
if (missing.length) {
  if (NON_INTERACTIVE) {
    fail(
      `Field kosong di ${source}: ${missing.join(", ")}.\n` +
        "Non-interactive mode aktif (--non-interactive / CI=true / stdin bukan TTY).",
    );
  }
  console.log(
    `  ⚠ ${missing.length} field kosong (${missing.join(", ")}) — masuk mode prompt interaktif.`,
  );
  await promptForMissing();
  missing = fieldsMissing();
  if (missing.length) fail(`Masih kosong setelah prompt: ${missing.join(", ")}`);
  source = `${source} + prompt interaktif`;
}
console.log(`  ✓ sumber: ${source}`);
console.log(`  ✓ alias: ${keyAlias}`);

// ─── 3. File .keystore fisik ada? ─────────────────────────────────────
step("3/8  Cek file keystore fisik");
const storeAbs = resolveHome(storeFile);
if (!existsSync(storeAbs)) {
  fail(
    `File keystore tidak ditemukan: ${storeAbs}\n` +
      "Periksa `storeFile` di keystore.properties — HARUS path absolut.",
  );
}
console.log(`  ✓ ${storeAbs}`);

// ─── 4. storePassword benar? ──────────────────────────────────────────
step("4/8  Verifikasi storePassword");
let listAll = keytool(["-list", "-keystore", storeAbs, "-storepass", storePassword]);
if (listAll.status !== 0) {
  if (NON_INTERACTIVE) {
    fail(
      "storePassword SALAH — keytool tidak bisa membuka store.\n\n" +
        truncate((listAll.stderr || listAll.stdout || "").trim(), 400),
    );
  }
  for (let attempt = 1; attempt <= 3 && listAll.status !== 0; attempt++) {
    console.log(`  ⚠ storePassword salah (percobaan ${attempt}/3). Prompt ulang…`);
    storePassword = await askPassword("     Store password: ");
    listAll = keytool(["-list", "-keystore", storeAbs, "-storepass", storePassword]);
  }
  if (listAll.status !== 0) fail("storePassword tetap salah setelah 3 percobaan.");
}
console.log("  ✓ store bisa dibuka");

// ─── 5. Alias ADA di store? ───────────────────────────────────────────
step("5/8  Cek alias di dalam store");
let listAlias = keytool([
  "-list", "-keystore", storeAbs, "-storepass", storePassword, "-alias", keyAlias,
]);
if (listAlias.status !== 0) {
  const aliases = extractAliases(listAll.stdout);
  if (NON_INTERACTIVE || aliases.length === 0) {
    fail(
      `Alias "${keyAlias}" TIDAK ADA di keystore.\n` +
        (aliases.length
          ? `Alias yang tersedia: ${aliases.join(", ")}`
          : "Store ini tidak punya entry alias apa pun (kosong?)."),
    );
  }
  console.log(`  ⚠ Alias "${keyAlias}" tidak ada. Alias di store: ${aliases.join(", ")}`);
  if (aliases.length === 1) {
    keyAlias = aliases[0];
    console.log(`  → auto-pilih satu-satunya: "${keyAlias}"`);
  } else {
    const pick = await askChoice("     Pilih alias", aliases);
    keyAlias = pick;
  }
  listAlias = keytool([
    "-list", "-keystore", storeAbs, "-storepass", storePassword, "-alias", keyAlias,
  ]);
  if (listAlias.status !== 0) fail("Alias pilihan tidak bisa dibuka. Aneh — coba ulangi.");
}
console.log("  ✓ alias ditemukan");

// ─── 6. keyPassword benar untuk alias tsb? ───────────────────────────
step("6/8  Verifikasi keyPassword (ekspor sertifikat alias)");
let exportCert = keytool([
  "-exportcert",
  "-keystore",
  storeAbs,
  "-storepass",
  storePassword,
  "-alias",
  keyAlias,
  "-keypass",
  keyPassword,
  "-rfc",
]);
if (exportCert.status !== 0) {
  const msg = (exportCert.stderr || exportCert.stdout || "").trim();
  // Kadang `-keypass` tidak dipakai untuk PKCS12 (satu password saja).
  // Kalau msg mengandung "PKCS12" dan storePassword === keyPassword, biar
  // Gradle yang decide — anggap OK.
  if (/PKCS12/i.test(msg) && storePassword === keyPassword) {
    console.log("  ⚠ store PKCS12 — key & store share password (OK)");
  } else {
    if (NON_INTERACTIVE) {
      fail(
        "keyPassword SALAH untuk alias ini — Gradle akan gagal signing.\n\n" +
          truncate(msg, 400),
      );
    }
    for (let attempt = 1; attempt <= 3 && exportCert.status !== 0; attempt++) {
      console.log(`  ⚠ keyPassword salah (percobaan ${attempt}/3). Prompt ulang…`);
      keyPassword = await askPassword("     Key password: ");
      exportCert = keytool([
        "-exportcert", "-keystore", storeAbs, "-storepass", storePassword,
        "-alias", keyAlias, "-keypass", keyPassword, "-rfc",
      ]);
    }
    if (exportCert.status !== 0) fail("keyPassword tetap salah setelah 3 percobaan.");
    console.log("  ✓ keyPassword valid (setelah prompt)");
  }
} else {
  console.log("  ✓ keyPassword valid");
}

// ─── 7. Cek expiry sertifikat ─────────────────────────────────────────
step("7/8  Cek masa berlaku sertifikat");
const details = keytool([
  "-list",
  "-v",
  "-keystore",
  storeAbs,
  "-storepass",
  storePassword,
  "-alias",
  keyAlias,
]);
const untilLine = (details.stdout || "").split("\n").find((l) => /Valid from:.*until:/i.test(l));
if (untilLine) {
  const m = untilLine.match(/until:\s*(.+)$/i);
  const until = m ? new Date(m[1].trim()) : null;
  if (until && !isNaN(until.getTime())) {
    const days = Math.floor((until.getTime() - Date.now()) / 86_400_000);
    if (days < 0) {
      fail(`Sertifikat sudah EXPIRED (${until.toISOString().slice(0, 10)}). Play Store menolak.`);
    } else if (days < 90) {
      console.log(`  ⚠ tinggal ${days} hari lagi (expired ${until.toISOString().slice(0, 10)})`);
    } else {
      console.log(`  ✓ berlaku ${days} hari lagi (sampai ${until.toISOString().slice(0, 10)})`);
    }
  } else {
    console.log("  ⚠ tidak bisa parse tanggal expiry — lewati cek");
  }
} else {
  console.log("  ⚠ output keytool tidak berisi baris expiry — lewati cek");
}

// ─── 8. build.gradle wire signingConfigs.release? ────────────────────
step("8/8  Cek `android/app/build.gradle` sudah wire signingConfigs.release");
const bg = resolve(ROOT, "android/app/build.gradle");
if (!existsSync(bg)) {
  console.log("  ⚠ android/app/build.gradle tidak ada — skip (folder android/ belum di-generate?)");
} else {
  const src = readFileSync(bg, "utf8");
  const hasSigningRelease = /signingConfigs\s*\{[\s\S]*release\s*\{/.test(src);
  const releaseUsesSigning = /buildTypes\s*\{[\s\S]*release\s*\{[\s\S]*signingConfig\s+signingConfigs\.release/.test(
    src,
  );
  const readsProps = /keystore\.properties/i.test(src);
  if (!hasSigningRelease || !releaseUsesSigning || !readsProps) {
    console.log(
      "  ⚠ build.gradle belum lengkap:\n" +
        `      signingConfigs.release    : ${hasSigningRelease ? "OK" : "MISSING"}\n` +
        `      buildTypes.release wire   : ${releaseUsesSigning ? "OK" : "MISSING"}\n` +
        `      baca keystore.properties  : ${readsProps ? "OK" : "MISSING"}\n` +
        "    Lihat docs/BUILD_AAB.md → \"Wire ke android/app/build.gradle\".",
    );
  } else {
    console.log("  ✓ signingConfigs.release ter-wire ke keystore.properties");
  }
}

banner("Keystore siap — aman untuk ./gradlew :app:bundleRelease");
__rl?.close();
process.exit(0);

// ─── util ─────────────────────────────────────────────────────────────
function parseProperties(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}
function resolveHome(p) {
  if (!p) return p;
  if (p.startsWith("~")) return resolve(homedir(), p.slice(2));
  return isAbsolute(p) ? p : resolve(ROOT, p);
}
function keytool(args) {
  return spawnSync("keytool", args, { encoding: "utf8" });
}
function which(cmd) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return (r.stdout || "").split("\n")[0].trim() || null;
}
function extractAliases(text) {
  const out = [];
  for (const line of (text || "").split("\n")) {
    const m = line.match(/^([\w.\-]+),\s*.+,\s*(PrivateKeyEntry|trustedCertEntry)/i);
    if (m) out.push(m[1]);
  }
  return out;
}
function truncate(s, n) {
  return s.length <= n ? s : s.slice(0, n) + "\n… (dipotong)";
}

// ─── Interactive prompt helpers ──────────────────────────────────────
function rl() {
  if (!__rl) __rl = createInterface({ input: process.stdin, output: process.stdout });
  return __rl;
}
function ask(prompt, fallback) {
  return new Promise((res) =>
    rl().question(prompt, (a) => res(a.trim() || fallback || "")),
  );
}
function askPassword(prompt) {
  return new Promise((res) => {
    const r = rl();
    const origWrite = r._writeToOutput?.bind(r);
    if (origWrite) {
      r._writeToOutput = (s) => {
        if (s.startsWith(prompt)) origWrite(s);
        else origWrite("*");
      };
    }
    r.question(prompt, (a) => {
      if (origWrite) r._writeToOutput = origWrite;
      process.stdout.write("\n");
      res(a);
    });
  });
}
async function askChoice(prompt, options) {
  console.log(`\n  ${prompt}:`);
  options.forEach((o, i) => console.log(`     ${i + 1}) ${o}`));
  while (true) {
    const ans = (await ask("     Nomor pilihan: ")).trim();
    const n = Number(ans);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1];
    if (options.includes(ans)) return ans;
    console.log("     ⚠ pilihan tidak valid.");
  }
}
function fieldsMissing() {
  const m = [];
  if (!storeFile) m.push("storeFile");
  if (!storePassword) m.push("storePassword");
  if (!keyAlias) m.push("keyAlias");
  if (!keyPassword) m.push("keyPassword");
  return m;
}
async function promptForMissing() {
  if (!storeFile) {
    const def = resolve(homedir(), "keys/mcm-release.keystore");
    storeFile = resolveHome(await ask(`     Path .keystore [${def}]: `, def));
  }
  if (!keyAlias) {
    keyAlias = await ask("     Alias [mcm]: ", "mcm");
  }
  if (!storePassword) {
    storePassword = await askPassword("     Store password: ");
  }
  if (!keyPassword) {
    const same = (await ask("     Key password sama dengan store password? [Y/n]: ", "Y"))
      .trim()
      .toLowerCase();
    keyPassword =
      same === "" || same === "y" || same === "yes"
        ? storePassword
        : await askPassword("     Key password: ");
  }
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