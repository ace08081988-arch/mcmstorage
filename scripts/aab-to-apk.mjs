#!/usr/bin/env node
/**
 * Generate APK universal dari AAB pakai bundletool — supaya bisa install
 * langsung ke HP via `adb install` tanpa menunggu Play Store.
 *
 * Pemakaian:
 *   node scripts/aab-to-apk.mjs                          # varian full, release AAB
 *   node scripts/aab-to-apk.mjs --variant chat
 *   node scripts/aab-to-apk.mjs --debug                  # dari bundle debug
 *   node scripts/aab-to-apk.mjs --aab path/ke.aab --out out/mcm.apk
 *   node scripts/aab-to-apk.mjs --install                # sekalian adb install
 *   node scripts/aab-to-apk.mjs --device-spec            # APK khusus device
 *                                                        # (lebih kecil dari universal)
 *
 * Alur:
 *   1. Cek `java` (bundletool butuh JVM).
 *   2. Pastikan bundletool.jar tersedia. Kalau belum, auto-download
 *      v1.15.6 ke ~/.cache/mcm/bundletool-all.jar (satu kali, ~30MB).
 *   3. Pilih mode:
 *      • --device-spec (default kalau --install & 1 device):
 *        `bundletool build-apks --connected-device` → apks berisi APK
 *        khusus device yang terhubung (paling kecil, paling cepat).
 *      • universal (default kalau tidak install):
 *        `bundletool build-apks --mode=universal` → 1 APK fat semua ABI.
 *   4. Kalau AAB release, baca `android/keystore.properties` untuk
 *      sign APK hasilnya (kalau tidak ada, hasil unsigned + peringatan).
 *   5. Extract .apk dari .apks (zip) → tulis ke --out.
 *   6. (opsional) `adb install -r -d` file APK final.
 *
 * bundletool ref: https://developer.android.com/tools/bundletool
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  createWriteStream,
  statSync,
  unlinkSync,
  readdirSync,
} from "node:fs";
import { resolve, dirname, isAbsolute, basename } from "node:path";
import { homedir, tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";

const BUNDLETOOL_VERSION = "1.15.6";
const BUNDLETOOL_URL = `https://github.com/google/bundletool/releases/download/${BUNDLETOOL_VERSION}/bundletool-all-${BUNDLETOOL_VERSION}.jar`;
const CACHE_JAR = resolve(homedir(), ".cache/mcm/bundletool-all.jar");

const argv = process.argv.slice(2);
const args = new Set(argv);
function flag(name, fallback) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : fallback;
}

const ROOT = resolve(process.cwd());
const variant = flag("--variant", "full");
if (!["full", "chat"].includes(variant)) fail(`Varian tidak dikenal: ${variant}`);
const isDebug = args.has("--debug");
const doInstall = args.has("--install");
const forceDeviceSpec = args.has("--device-spec");
const aabOverride = flag("--aab");
const outOverride = flag("--out");

banner(
  `AAB → APK · varian ${variant.toUpperCase()} · ${isDebug ? "debug" : "release"}${doInstall ? " + install" : ""}`,
);

// ─── 1. Java ──────────────────────────────────────────────────────────
step("1/6  Cek Java (JVM untuk bundletool)");
if (!which("java")) {
  fail(
    "`java` tidak ditemukan. Install JDK 17 dan pastikan di PATH:\n" +
      "  export JAVA_HOME=\"$(/usr/libexec/java_home -v 17)\"\n" +
      "  export PATH=\"$JAVA_HOME/bin:$PATH\"",
  );
}
console.log("  ✓ java tersedia");

// ─── 2. bundletool ────────────────────────────────────────────────────
step("2/6  Pastikan bundletool.jar tersedia");
await ensureBundletool();
console.log(`  ✓ ${CACHE_JAR}`);

// ─── 3. Tentukan AAB ──────────────────────────────────────────────────
step("3/6  Cari AAB");
const aabDefault = resolve(
  ROOT,
  `android/app/build/outputs/bundle/${isDebug ? "debug" : "release"}/app-${isDebug ? "debug" : "release"}.aab`,
);
const aabPath = aabOverride ? resolveHome(aabOverride) : aabDefault;
if (!existsSync(aabPath)) {
  fail(
    `AAB tidak ditemukan: ${aabPath}\n` +
      `Build dulu: bun run aab:build${isDebug ? ":debug" : variant === "chat" ? ":chat" : ""}`,
  );
}
console.log(`  ✓ ${aabPath} (${(statSync(aabPath).size / 1024 / 1024).toFixed(1)} MB)`);

// ─── 4. Kredensial signing (kalau release) ───────────────────────────
step("4/6  Baca kredensial signing");
const signing = isDebug ? null : readSigning();
if (!isDebug && !signing) {
  console.log(
    "  ⚠ tidak menemukan android/keystore.properties — APK output akan UNSIGNED.\n" +
      "    Jalankan `bun run aab:setup-keystore` dulu supaya APK bisa di-install.",
  );
} else if (signing) {
  console.log(`  ✓ pakai alias "${signing.keyAlias}" dari ${signing.storeFile}`);
}

// ─── 5. Bundletool build-apks ────────────────────────────────────────
step("5/6  bundletool build-apks");

// device-spec kalau user minta ATAU auto-mode: install + 1 device connected
let useDeviceSpec = forceDeviceSpec;
if (!useDeviceSpec && doInstall) {
  const devs = listDevices();
  if (devs.length === 1) {
    useDeviceSpec = true;
    console.log(`  → mode device-spec (device: ${devs[0].serial}) — APK lebih kecil`);
  }
}

const workDir = resolve(tmpdir(), `mcm-aab-to-apk-${Date.now()}`);
mkdirSync(workDir, { recursive: true });
const apksPath = resolve(workDir, "out.apks");

const btArgs = [
  "-jar",
  CACHE_JAR,
  "build-apks",
  `--bundle=${aabPath}`,
  `--output=${apksPath}`,
];
if (useDeviceSpec) {
  btArgs.push("--connected-device");
} else {
  btArgs.push("--mode=universal");
}
if (signing) {
  btArgs.push(
    `--ks=${signing.storeFile}`,
    `--ks-key-alias=${signing.keyAlias}`,
    `--ks-pass=pass:${signing.storePassword}`,
    `--key-pass=pass:${signing.keyPassword}`,
  );
}

const bt = spawnSync("java", btArgs, { stdio: "inherit" });
if (bt.status !== 0) fail(`bundletool gagal (exit ${bt.status}).`);

// ─── 6. Extract APK final dari .apks ─────────────────────────────────
step("6/6  Extract APK final");
const extractDir = resolve(workDir, "extracted");
mkdirSync(extractDir, { recursive: true });
// bundletool extract-apks butuh device-spec JSON kalau bukan universal.
// Untuk universal, .apks langsung berisi universal.apk — kita zip-extract.
// Untuk device-spec, .apks berisi splits/base-master.apk + config.*.apk;
// gunakan `bundletool extract-apks --device-spec` tapi lebih mudah:
// pakai `install-apks` untuk device-spec (langsung install ke device).

let finalApk;
if (useDeviceSpec) {
  // Untuk device-spec mode, .apks harus di-install via install-apks
  // (bundletool akan pick split yang tepat). Simpan .apks untuk arsip.
  const outApks = outOverride
    ? resolveHome(outOverride)
    : resolve(ROOT, `dist/mcm-${variant}-${isDebug ? "debug" : "release"}-device.apks`);
  mkdirSync(dirname(outApks), { recursive: true });
  writeFileSync(outApks, readFileSync(apksPath));
  finalApk = outApks;
  console.log(`  ✓ device-spec bundle: ${finalApk}`);
} else {
  // Universal: unzip .apks → ambil universal.apk
  const unzip = spawnSync("unzip", ["-o", apksPath, "-d", extractDir], { encoding: "utf8" });
  if (unzip.status !== 0) fail("`unzip` gagal — pastikan tool `unzip` terpasang.");
  const universalApk = resolve(extractDir, "universal.apk");
  if (!existsSync(universalApk)) {
    fail(`universal.apk tidak ada di ${apksPath}. Isi:\n${readdirSync(extractDir).join("\n")}`);
  }
  const outApk = outOverride
    ? resolveHome(outOverride)
    : resolve(ROOT, `dist/mcm-${variant}-${isDebug ? "debug" : "release"}-universal.apk`);
  mkdirSync(dirname(outApk), { recursive: true });
  writeFileSync(outApk, readFileSync(universalApk));
  finalApk = outApk;
  console.log(`  ✓ universal APK: ${finalApk} (${(statSync(finalApk).size / 1024 / 1024).toFixed(1)} MB)`);
}

// ─── Install (opsional) ──────────────────────────────────────────────
if (doInstall) {
  banner("Install ke device");
  if (useDeviceSpec) {
    // bundletool install-apks: pilih split otomatis.
    const inst = spawnSync(
      "java",
      ["-jar", CACHE_JAR, "install-apks", `--apks=${finalApk}`],
      { stdio: "inherit" },
    );
    if (inst.status !== 0) fail("bundletool install-apks gagal.");
  } else {
    // universal.apk → adb install biasa via scripts/install-apk.mjs
    const inst = spawnSync(
      "node",
      [
        resolve(ROOT, "scripts/install-apk.mjs"),
        "--variant",
        variant,
        "--apk",
        finalApk,
        ...(isDebug ? [] : ["--release"]),
      ],
      { stdio: "inherit" },
    );
    if (inst.status !== 0) fail("Install verifier gagal (lihat pesan di atas).");
  }
}

banner("Selesai");
console.log(
  `File output:  ${finalApk}\n` +
    (useDeviceSpec
      ? "  Untuk install manual nanti: java -jar <bundletool.jar> install-apks --apks=<file>\n"
      : "  Untuk install manual nanti: adb install -r -d <file>\n"),
);
process.exit(0);

// ─── util ─────────────────────────────────────────────────────────────
async function ensureBundletool() {
  if (existsSync(CACHE_JAR) && statSync(CACHE_JAR).size > 5_000_000) return;
  console.log(`  → download bundletool ${BUNDLETOOL_VERSION} (satu kali)…`);
  mkdirSync(dirname(CACHE_JAR), { recursive: true });
  const res = await fetch(BUNDLETOOL_URL, { redirect: "follow" });
  if (!res.ok || !res.body) fail(`Download bundletool gagal (${res.status}): ${BUNDLETOOL_URL}`);
  await pipeline(res.body, createWriteStream(CACHE_JAR));
  if (statSync(CACHE_JAR).size < 5_000_000) {
    try {
      unlinkSync(CACHE_JAR);
    } catch {}
    fail("bundletool ter-download tapi ukurannya mencurigakan. Coba ulang.");
  }
}

function readSigning() {
  const p = resolve(ROOT, "android/keystore.properties");
  if (!existsSync(p)) return null;
  const out = {};
  for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  if (!out.storeFile || !out.storePassword || !out.keyAlias || !out.keyPassword) return null;
  out.storeFile = resolveHome(out.storeFile);
  return out;
}

function listDevices() {
  const r = spawnSync("adb", ["devices"], { encoding: "utf8" });
  if (r.status !== 0) return [];
  const out = [];
  for (const line of (r.stdout || "").split("\n").slice(1)) {
    const m = line.match(/^(\S+)\s+device\b/);
    if (m) out.push({ serial: m[1] });
  }
  return out;
}

function which(cmd) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], {
    encoding: "utf8",
  });
  return r.status === 0 && r.stdout.trim() ? r.stdout.split("\n")[0].trim() : null;
}
function resolveHome(p) {
  if (!p) return p;
  if (p.startsWith("~")) return resolve(homedir(), p.slice(2));
  return isAbsolute(p) ? p : resolve(ROOT, p);
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