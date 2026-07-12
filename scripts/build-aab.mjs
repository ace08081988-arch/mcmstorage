#!/usr/bin/env node
/**
 * Build Android App Bundle (.aab) — output siap upload ke Google Play Console.
 *
 * Pemakaian:
 *   node scripts/build-aab.mjs                       # varian full, release AAB
 *   node scripts/build-aab.mjs --variant chat        # varian MCM Chat
 *   node scripts/build-aab.mjs --debug               # bundleDebug (tanpa signing)
 *   node scripts/build-aab.mjs --skip-typecheck      # skip tsgo
 *
 * Alur:
 *   1. Pre-flight: cek folder android/, ANDROID_HOME, JAVA_HOME, gradlew.
 *   2. Typecheck (tsgo --noEmit).
 *   3. Build web + cap sync (`apk:full` / `apk:chat` — sama scriptnya).
 *   4. Jalankan `./gradlew :app:bundleRelease` (atau bundleDebug).
 *   5. Cetak path .aab hasilnya.
 *
 * Signing untuk release:
 *   Konfigurasi keystore di `android/app/build.gradle` ATAU lewat file
 *   `android/keystore.properties` (rekomendasi — jangan commit file ini):
 *
 *     storeFile=/absolute/path/ke/mcm-release.keystore
 *     storePassword=xxxx
 *     keyAlias=mcm
 *     keyPassword=xxxx
 *
 *   Skrip ini TIDAK membaca keystore langsung — Gradle yang baca. Kalau
 *   `signingConfig` belum diset, `bundleRelease` menghasilkan AAB unsigned
 *   yang tidak diterima Play Console. Lihat docs/BUILD_AAB.md.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";

const argv = process.argv.slice(2);
const args = new Set(argv);
let variant = "full";
for (const a of argv) {
  if (a.startsWith("--variant=")) variant = a.split("=")[1];
  else if (a === "--variant") {
    const idx = argv.indexOf("--variant");
    variant = argv[idx + 1] ?? "full";
  }
}
if (!["full", "chat"].includes(variant)) {
  fail(`Varian tidak dikenal: "${variant}". Pilih: full atau chat.`);
}
const skipTypecheck = args.has("--skip-typecheck");
const debugBundle = args.has("--debug");

const ROOT = resolve(process.cwd());
const ANDROID_DIR = resolve(ROOT, "android");
const gradleTask = debugBundle ? ":app:bundleDebug" : ":app:bundleRelease";
const outSubdir = debugBundle ? "debug" : "release";

banner(`Build AAB · varian ${variant.toUpperCase()} · ${debugBundle ? "DEBUG" : "RELEASE"}`);

// ─── 1. Pre-flight ─────────────────────────────────────────────────────
step("1/4  Pre-flight cek lingkungan");

if (!existsSync(ANDROID_DIR)) {
  fail(
    "Folder `android/` belum ada. Jalankan sekali:\n\n" +
      "    bunx cap add android\n\n" +
      "Lalu ulangi skrip ini.",
  );
}

const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
const gradlewPath = resolve(ANDROID_DIR, process.platform === "win32" ? "gradlew.bat" : "gradlew");
if (!existsSync(gradlewPath)) {
  fail(
    `Gradle wrapper tidak ditemukan di ${gradlewPath}.\n` +
      "Regenerate folder android:  rm -rf android && bunx cap add android",
  );
}

const missingEnv = [];
if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) missingEnv.push("ANDROID_HOME");
if (!process.env.JAVA_HOME) missingEnv.push("JAVA_HOME");
if (missingEnv.length) {
  fail(
    `Env var wajib untuk build CLI belum di-set: ${missingEnv.join(", ")}.\n` +
      "Set di shell profile (contoh macOS/Linux):\n\n" +
      "    export ANDROID_HOME=\"$HOME/Library/Android/sdk\"   # macOS\n" +
      "    export ANDROID_HOME=\"$HOME/Android/Sdk\"           # Linux\n" +
      "    export JAVA_HOME=\"$(/usr/libexec/java_home -v 17)\" # macOS (JDK 17)\n\n" +
      "Lalu restart terminal & ulangi skrip.",
  );
}

if (!debugBundle && !existsSync(resolve(ANDROID_DIR, "keystore.properties"))) {
  console.log(
    "⚠ File `android/keystore.properties` tidak ditemukan.\n" +
      "  Kalau `signingConfigs.release` di build.gradle tidak dikonfigurasi\n" +
      "  dengan cara lain, `bundleRelease` akan menghasilkan AAB UNSIGNED\n" +
      "  dan Play Console akan menolaknya. Lihat docs/BUILD_AAB.md → \"Signing key\".\n",
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
step(`3/4  Build web + cap sync (apk:${variant})`);
run("bun", ["run", `apk:${variant}`]);
console.log(`  ✓ dist/ ter-generate & android/ ter-sync (varian ${variant})`);

// ─── 4. Gradle bundle ─────────────────────────────────────────────────
step(`4/4  Gradle ${gradleTask}`);
run(gradlew, [gradleTask], { cwd: ANDROID_DIR });

const aabPath = join(ANDROID_DIR, "app", "build", "outputs", "bundle", outSubdir);
banner("Selesai");
console.log(
  `AAB output tersimpan di:\n  ${aabPath}/\n\n` +
    "Upload file `.aab` di folder tersebut ke Google Play Console →\n" +
    "  Release → Production (atau Internal testing) → Create new release → Upload.\n",
);

// ─── util ─────────────────────────────────────────────────────────────
function banner(msg) {
  const line = "═".repeat(msg.length + 4);
  console.log(`\n${line}\n  ${msg}  \n${line}`);
}
function step(msg) {
  console.log(`\n▶ ${msg}`);
}
function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
  if (r.status !== 0) fail(`Perintah gagal: ${cmd} ${argv.join(" ")} (exit ${r.status})`);
}
function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}