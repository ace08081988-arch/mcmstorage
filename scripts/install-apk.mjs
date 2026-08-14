#!/usr/bin/env node
/**
 * Install APK ke perangkat Android terhubung via `adb install`, lalu
 * verifikasi pemasangan (package terdaftar + versionCode match).
 *
 * Pemakaian:
 *   node scripts/install-apk.mjs                        # varian full, debug APK
 *   node scripts/install-apk.mjs --release              # apk release (harus signed)
 *   node scripts/install-apk.mjs --apk path/to.apk      # override path APK
 *   node scripts/install-apk.mjs --device R58...        # pilih device spesifik
 *   node scripts/install-apk.mjs --launch               # + buka app setelah install
 *   node scripts/install-apk.mjs --uninstall-first      # uninstall dulu (bersih)
 *
 * Alur:
 *   1. Cek `adb` ada di PATH (dari Android SDK platform-tools).
 *   2. Cek device terhubung (`adb devices`). Kalau >1, wajib --device.
 *   3. Tentukan file APK: --apk override ATAU
 *      android/app/build/outputs/apk/{debug|release}/app-{debug|release}.apk
 *   4. Baca appId & versionCode dari APK (aapt dump badging kalau tersedia;
 *      fallback ke capacitor.config.ts + build.gradle).
 *   5. (opsional) `adb uninstall` package lama.
 *   6. `adb install -r -d` (replace + downgrade allowed untuk debug).
 *   7. Verifikasi: `adb shell pm list packages | grep <appId>` DAN
 *      `adb shell dumpsys package <appId>` untuk cek versionCode terpasang.
 *   8. (opsional) `adb shell monkey -p <appId> 1` untuk launch.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const argv = process.argv.slice(2);
const args = new Set(argv);
function flag(name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

const ROOT = resolve(process.cwd());
const variant = "full";
{
  const requested = flag("--variant");
  if (requested && requested !== "full") fail(`Varian "${requested}" sudah dihapus dari project ini.`);
}
const isRelease = args.has("--release");
const doLaunch = args.has("--launch");
const doUninstallFirst = args.has("--uninstall-first");
const deviceArg = flag("--device");
const apkOverride = flag("--apk");

banner(
  `Install APK · MCM Storage · ${isRelease ? "RELEASE" : "DEBUG"}`,
);

// ─── 1. adb tersedia? ─────────────────────────────────────────────────
step("1/6  Cek `adb`");
if (!which("adb")) {
  fail(
    "`adb` tidak ditemukan di PATH.\n" +
      "Install Android SDK Platform-Tools, lalu tambah ke PATH:\n\n" +
      "  export PATH=\"$ANDROID_HOME/platform-tools:$PATH\"",
  );
}
console.log("  ✓ adb tersedia");

// ─── 2. Pilih device ──────────────────────────────────────────────────
step("2/6  Cari device terhubung");
const devices = listDevices();
if (devices.length === 0) {
  fail(
    "Tidak ada device terhubung. Cek:\n" +
      "  • Kabel USB / Wi-Fi debugging aktif\n" +
      "  • Opsi Pengembang → USB debugging = ON\n" +
      "  • Trust komputer ini di dialog HP\n" +
      "  • `adb devices` menampilkan device (bukan 'unauthorized' / 'offline')",
  );
}
let device = deviceArg;
if (!device) {
  if (devices.length > 1) {
    fail(
      `Ada ${devices.length} device terhubung. Pilih dengan --device <serial>:\n` +
        devices.map((d) => `  • ${d.serial}  (${d.state})`).join("\n"),
    );
  }
  device = devices[0].serial;
}
const chosen = devices.find((d) => d.serial === device);
if (!chosen) fail(`Device --device ${device} tidak ada di daftar adb devices.`);
if (chosen.state !== "device") {
  fail(`Device ${device} status "${chosen.state}" (bukan "device"). Cek trust dialog / USB mode.`);
}
console.log(`  ✓ device: ${device}`);

// ─── 3. Cari APK ──────────────────────────────────────────────────────
step("3/6  Cari file APK");
const apkSubdir = isRelease ? "release" : "debug";
const apkName = isRelease ? "app-release.apk" : "app-debug.apk";
const defaultApk = resolve(ROOT, `android/app/build/outputs/apk/${apkSubdir}/${apkName}`);
const apkPath = apkOverride ? resolve(ROOT, apkOverride) : defaultApk;
if (!existsSync(apkPath)) {
  fail(
    `APK tidak ditemukan: ${apkPath}\n` +
      "Build dulu: bun run apk:full lalu di Android Studio: Build → Build APK(s).\n" +
      "Atau lewat --apk <path> kalau lokasi custom.",
  );
}
console.log(`  ✓ ${apkPath}`);

// ─── 4. Baca metadata APK ─────────────────────────────────────────────
step("4/6  Baca package name & versionCode dari APK");
let appId;
let versionCode;
const aapt = findAapt();
if (aapt) {
  const r = spawnSync(aapt, ["dump", "badging", apkPath], { encoding: "utf8" });
  if (r.status === 0) {
    const line = (r.stdout || "").split("\n").find((l) => l.startsWith("package:"));
    if (line) {
      appId = /name='([^']+)'/.exec(line)?.[1];
      versionCode = /versionCode='([^']+)'/.exec(line)?.[1];
    }
  }
}
if (!appId) {
  // Fallback: satu-satunya applicationId project ini.
  appId = "mcmstorage.app";
  console.log(`  ⚠ aapt tidak tersedia — fallback appId dari varian: ${appId}`);
} else {
  console.log(`  ✓ appId=${appId}${versionCode ? ` versionCode=${versionCode}` : ""}`);
}

// ─── 5. Uninstall (opsional) + install ────────────────────────────────
step("5/6  Install APK");
if (doUninstallFirst) {
  console.log(`  → uninstall ${appId} dulu…`);
  adb(["shell", "pm", "uninstall", "--user", "0", appId]); // ok kalau gagal (belum terpasang)
}
const installRes = adbRaw(["install", "-r", "-d", apkPath]);
const installOut = (installRes.stdout || "") + (installRes.stderr || "");
process.stdout.write(installOut);
if (installRes.status !== 0 || !/Success/i.test(installOut)) {
  // Diagnosa umum
  if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE/i.test(installOut)) {
    fail(
      "APK signed dengan key berbeda dari yang sudah terpasang.\n" +
        "Solusi: jalankan lagi dengan --uninstall-first.",
    );
  }
  if (/INSTALL_FAILED_VERSION_DOWNGRADE/i.test(installOut)) {
    fail("versionCode APK < yang terpasang. Naikkan versionCode atau --uninstall-first.");
  }
  if (/INSTALL_PARSE_FAILED_NO_CERTIFICATES/i.test(installOut)) {
    fail("APK unsigned. Untuk release, setup signing (docs/BUILD_AAB.md).");
  }
  fail("adb install gagal — lihat pesan di atas.");
}
console.log("  ✓ install sukses");

// ─── 6. Verifikasi pemasangan ─────────────────────────────────────────
step("6/6  Verifikasi pemasangan");
const listPkg = adb(["shell", "pm", "list", "packages", appId]);
if (!listPkg.stdout.split(/\r?\n/).some((l) => l.trim() === `package:${appId}`)) {
  fail(`Package ${appId} tidak muncul di 'pm list packages'. Install tidak persisten.`);
}
console.log(`  ✓ package terdaftar: ${appId}`);

const dump = adb(["shell", "dumpsys", "package", appId]);
const installedVc = /versionCode=(\d+)/.exec(dump.stdout || "")?.[1];
const installedVn = /versionName=([^\s]+)/.exec(dump.stdout || "")?.[1];
if (installedVc) {
  console.log(`  ✓ terpasang: versionCode=${installedVc}${installedVn ? ` versionName=${installedVn}` : ""}`);
  if (versionCode && installedVc !== versionCode) {
    fail(
      `MISMATCH: APK versionCode=${versionCode} tapi yang terpasang=${installedVc}.\n` +
        "Kemungkinan install nyangkut di user profile lain — coba --uninstall-first.",
    );
  }
} else {
  console.log("  ⚠ tidak bisa parse versionCode dari dumpsys (skip cek match)");
}

if (doLaunch) {
  console.log(`\n▶ Launch ${appId}`);
  adb(["shell", "monkey", "-p", appId, "-c", "android.intent.category.LAUNCHER", "1"]);
}

banner("APK terpasang & terverifikasi");
process.exit(0);

// ─── util ─────────────────────────────────────────────────────────────
function listDevices() {
  const r = spawnSync("adb", ["devices"], { encoding: "utf8" });
  if (r.status !== 0) fail("`adb devices` gagal.");
  const out = [];
  for (const line of (r.stdout || "").split("\n").slice(1)) {
    const m = line.match(/^(\S+)\s+(device|offline|unauthorized|no permissions)/);
    if (m) out.push({ serial: m[1], state: m[2] });
  }
  return out;
}
function adb(a) {
  const full = deviceCmd(a);
  const r = spawnSync("adb", full, { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}
function adbRaw(a) {
  const full = deviceCmd(a);
  const r = spawnSync("adb", full, { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}
function deviceCmd(a) {
  return device ? ["-s", device, ...a] : a;
}
function which(cmd) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], {
    encoding: "utf8",
  });
  return r.status === 0 && r.stdout.trim() ? r.stdout.split("\n")[0].trim() : null;
}
function findAapt() {
  // Coba PATH dulu.
  const p = which("aapt2") || which("aapt");
  if (p) return p;
  // Coba dari ANDROID_HOME/build-tools/<version>/aapt2
  const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!home) return null;
  try {
    const bt = readFileSync; // pakai fs
    const dir = resolve(home, "build-tools");
    if (!existsSync(dir)) return null;
    const versions = spawnSync("ls", [dir], { encoding: "utf8" });
    const first = (versions.stdout || "").split("\n").filter(Boolean).sort().pop();
    if (!first) return null;
    const candidate = resolve(dir, first, "aapt2");
    return existsSync(candidate) ? candidate : null;
  } catch {
    return null;
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