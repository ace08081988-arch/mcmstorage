#!/usr/bin/env node
/**
 * Build APK helper — jalankan pre-flight cek + build web + cap sync
 * dalam satu perintah, dengan pesan error yang ringkas & bahasa Indonesia.
 *
 * Pemakaian:
 *   node scripts/build-apk.mjs                # default: varian full
 *   node scripts/build-apk.mjs --open         # + buka Android Studio
 *   node scripts/build-apk.mjs --skip-typecheck  (kalau sudah dicek manual)
 *   node scripts/build-apk.mjs --assemble          # + ./gradlew assembleDebug
 *   node scripts/build-apk.mjs --release           # + assembleRelease (butuh signing)
 *   node scripts/build-apk.mjs --install           # + adb install & verifikasi
 *   node scripts/build-apk.mjs --install --launch  # + install & buka app
 *   node scripts/build-apk.mjs --install --device <serial>
 *   node scripts/build-apk.mjs --install --uninstall-first
 *
 * Tujuan:
 *   - Fail-fast sebelum masuk ke Gradle: typecheck dulu, baru build.
 *   - Cek `android/` sudah di-generate — kalau belum, kasih instruksi.
 *   - Cek `ANDROID_HOME` / `JAVA_HOME` — kalau kosong, kasih hint.
 *   - Semua langkah pakai script yang SUDAH ADA di package.json
 *     (`apk:full`) supaya tidak ada logic duplikat.
 *   - Opsional: kalau --install, chain otomatis ke scripts/install-apk.mjs
 *     (adb install -r -d + verifikasi package terdaftar & versionCode match).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const argv = process.argv.slice(2);
const args = new Set(argv);
function flagValue(name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}
// Project ini hanya punya satu package Android: mcmstorage.app.
const variant = "full";
{
  const i = process.argv.indexOf("--variant");
  const requested = process.argv.find((a) => a.startsWith("--variant="))?.split("=")[1] ??
    (i === -1 ? undefined : process.argv[i + 1]);
  if (requested && requested !== "full") {
    fail(
      `Varian "${requested}" sudah dihapus. MCM Storage hanya membangun mcmstorage.app.`,
    );
  }
}

const skipTypecheck = args.has("--skip-typecheck");
const openStudio = args.has("--open");
const doInstall = args.has("--install");
const doLaunch = args.has("--launch");
const doUninstallFirst = args.has("--uninstall-first");
const isRelease = args.has("--release");
// --assemble tersirat kalau --install (butuh .apk fisik) atau --release.
const doAssemble = args.has("--assemble") || doInstall || isRelease;
const deviceArg = flagValue("--device");
const ROOT = resolve(process.cwd());

banner("Build APK · MCM Storage");

// ─── 1. Pre-flight ─────────────────────────────────────────────────────
step("1/4  Pre-flight cek lingkungan");

if (!existsSync(resolve(ROOT, "android"))) {
  fail(
    "Folder `android/` belum ada. Jalankan sekali:\n\n" +
      "    bunx cap add android\n\n" +
      "Lalu ulangi skrip ini.",
  );
}

const missingEnv = [];
if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) missingEnv.push("ANDROID_HOME");
if (!process.env.JAVA_HOME) missingEnv.push("JAVA_HOME");
if (missingEnv.length) {
  console.log(
    `⚠ Env var berikut kosong: ${missingEnv.join(", ")}.\n` +
      `  Gradle di Android Studio biasanya masih jalan karena baca dari JDK bundled,\n` +
      `  tapi build CLI (./gradlew assembleRelease) akan gagal. Silakan set kalau perlu.\n`,
  );
}
console.log("  ✓ lingkungan siap");

// ─── 2. Typecheck ─────────────────────────────────────────────────────
if (!skipTypecheck) {
  step("2/4  Typecheck (tsgo --noEmit)");
  run("bunx", ["tsgo", "--noEmit"]);
  console.log("  ✓ typecheck bersih");
} else {
  step("2/4  Typecheck DILEWATI (--skip-typecheck)");
}

// ─── 3. Build web + cap sync ──────────────────────────────────────────
const totalSteps = doAssemble ? (doInstall ? 6 : 5) : 4;
step(`3/${totalSteps}  Build web + cap sync (apk:full)`);
run("bun", ["run", "apk:full"]);
console.log("  ✓ dist/ ter-generate & android/ ter-sync");

// ─── 4. Gradle assemble (opsional) ────────────────────────────────────
if (doAssemble) {
  const gradleTask = isRelease ? "assembleRelease" : "assembleDebug";
  step(`4/${totalSteps}  ./gradlew :app:${gradleTask}`);
  const gradleCmd = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  const gradleRes = spawnSync(gradleCmd, [`:app:${gradleTask}`], {
    stdio: "inherit",
    cwd: resolve(ROOT, "android"),
    shell: process.platform === "win32",
  });
  if (gradleRes.status !== 0) {
    fail(
      `Gradle ${gradleTask} gagal (exit ${gradleRes.status}).\n` +
        (isRelease
          ? "  Untuk release, pastikan keystore sudah setup:\n" +
            "    bun run aab:validate-keystore"
          : "  Cek log di atas — biasanya masalah SDK / JDK / Android licenses."),
    );
  }
  const apkSubdir = isRelease ? "release" : "debug";
  const apkName = isRelease ? "app-release.apk" : "app-debug.apk";
  const apkPath = resolve(ROOT, `android/app/build/outputs/apk/${apkSubdir}/${apkName}`);
  console.log(`  ✓ APK: ${apkPath}`);
}

// ─── 5. Install & verifikasi (opsional) ───────────────────────────────
if (doInstall) {
  step(`5/${totalSteps}  adb install + verifikasi pemasangan`);
  const installArgs = ["run", "apk:install", "--"];
  if (isRelease) installArgs.push("--release");
  if (doLaunch) installArgs.push("--launch");
  if (doUninstallFirst) installArgs.push("--uninstall-first");
  if (deviceArg) installArgs.push("--device", deviceArg);
  run("bun", installArgs);
}

// ─── 6. Buka Android Studio (opsional) ────────────────────────────────
if (openStudio) {
  step(`${totalSteps}/${totalSteps}  Buka Android Studio`);
  run("bunx", ["cap", "open", "android"]);
} else if (!doAssemble) {
  step(`${totalSteps}/${totalSteps}  Selesai — langkah manual berikutnya`);
  console.log(
    "\n" +
      "  Buka Android Studio:  bunx cap open android\n" +
      "  Lalu di menu Android Studio:\n" +
      "    • Debug APK  : Build → Build Bundle(s)/APK(s) → Build APK(s)\n" +
      "    • Rilis APK  : Build → Generate Signed Bundle/APK → APK\n" +
      "\n" +
      "  Output APK tersimpan di:\n" +
      "    android/app/build/outputs/apk/{debug|release}/*.apk\n",
  );
} else if (doInstall) {
  banner("APK MCM Storage terpasang & terverifikasi");
} else {
  banner("APK MCM Storage berhasil di-build");
}

// ─── util ─────────────────────────────────────────────────────────────
function banner(msg) {
  const line = "═".repeat(msg.length + 4);
  console.log(`\n${line}\n  ${msg}  \n${line}`);
}
function step(msg) {
  console.log(`\n▶ ${msg}`);
}
function run(cmd, argv) {
  const r = spawnSync(cmd, argv, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) fail(`Perintah gagal: ${cmd} ${argv.join(" ")} (exit ${r.status})`);
}
function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}