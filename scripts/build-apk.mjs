#!/usr/bin/env node
/**
 * Build APK helper — jalankan pre-flight cek + build web + cap sync
 * dalam satu perintah, dengan pesan error yang ringkas & bahasa Indonesia.
 *
 * Pemakaian:
 *   node scripts/build-apk.mjs                # default: varian full
 *   node scripts/build-apk.mjs --variant chat # varian MCM Chat
 *   node scripts/build-apk.mjs --open         # + buka Android Studio
 *   node scripts/build-apk.mjs --skip-typecheck  (kalau sudah dicek manual)
 *
 * Tujuan:
 *   - Fail-fast sebelum masuk ke Gradle: typecheck dulu, baru build.
 *   - Cek `android/` sudah di-generate — kalau belum, kasih instruksi.
 *   - Cek `ANDROID_HOME` / `JAVA_HOME` — kalau kosong, kasih hint.
 *   - Semua langkah pakai script yang SUDAH ADA di package.json
 *     (`apk:full` / `apk:chat`) supaya tidak ada logic duplikat.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const args = new Set(process.argv.slice(2));
let variant = "full";
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--variant=")) variant = a.split("=")[1];
  else if (a === "--variant") {
    const idx = process.argv.indexOf("--variant");
    variant = process.argv[idx + 1] ?? "full";
  }
}
if (!["full", "chat"].includes(variant)) {
  fail(`Varian tidak dikenal: "${variant}". Pilih: full atau chat.`);
}

const skipTypecheck = args.has("--skip-typecheck");
const openStudio = args.has("--open");
const ROOT = resolve(process.cwd());

banner(`Build APK · varian ${variant.toUpperCase()}`);

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
step(`3/4  Build web + cap sync (apk:${variant})`);
run("bun", ["run", `apk:${variant}`]);
console.log(`  ✓ dist/ ter-generate & android/ ter-sync (varian ${variant})`);

// ─── 4. Buka Android Studio (opsional) ────────────────────────────────
if (openStudio) {
  step("4/4  Buka Android Studio");
  run("bunx", ["cap", "open", "android"]);
} else {
  step("4/4  Selesai — langkah manual berikutnya");
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