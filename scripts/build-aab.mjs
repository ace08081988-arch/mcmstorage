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
const doUpload = args.has("--upload");
const skipBump = args.has("--skip-bump");
const uploadTrack = (() => {
  const i = argv.indexOf("--upload-track");
  return i === -1 ? "internal" : argv[i + 1] ?? "internal";
})();

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

console.log("  ✓ lingkungan siap");

// ─── 1b. Validasi keystore (khusus release) ───────────────────────────
if (!debugBundle) {
  step("1b/4 Validasi keystore signing (fail-fast sebelum Gradle)");
  run("node", [resolve(ROOT, "scripts/validate-keystore.mjs")]);
  console.log("  ✓ keystore lolos semua cek");
}

// ─── 1c. Bump versionCode/versionName (khusus release) ────────────────
if (!debugBundle && !skipBump) {
  step("1c/4 Bump versionCode/versionName otomatis");
  run("node", [resolve(ROOT, "scripts/bump-version.mjs")]);
  console.log("  ✓ version di build.gradle sudah maju");
}

// ─── 1d. Pre-flight minify/proguard/signing ──────────────────────────
if (!debugBundle) {
  step("1d/4 Pre-flight release (minify/proguard/signing)");
  run("node", [resolve(ROOT, "scripts/preflight-release.mjs"), "--variant", variant]);
  console.log("  ✓ konfigurasi release aman");
}

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

// ─── Post-build: verifikasi mapping.txt + arsip ─────────────────────
if (!debugBundle) {
  step("Post-build  Verifikasi mapping.txt + arsip AAB");
  run("node", [resolve(ROOT, "scripts/preflight-release.mjs"), "--post", "--variant", variant]);
}

const aabPath = join(ANDROID_DIR, "app", "build", "outputs", "bundle", outSubdir);
banner("Selesai");
console.log(
  `AAB output tersimpan di:\n  ${aabPath}/\n\n` +
    "Upload file `.aab` di folder tersebut ke Google Play Console →\n" +
    "  Release → Production (atau Internal testing) → Create new release → Upload.\n",
);

if (doUpload) {
  if (debugBundle) {
    console.log("⚠ --debug + --upload: skip upload (Play Console menolak debug AAB).");
  } else {
    step(`Upload AAB → Play Console (track: ${uploadTrack})`);
    run("node", [
      resolve(ROOT, "scripts/upload-play.mjs"),
      "--variant",
      variant,
      "--track",
      uploadTrack,
    ]);
  }
}

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