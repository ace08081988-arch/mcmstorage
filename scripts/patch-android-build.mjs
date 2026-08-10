#!/usr/bin/env node
/**
 * Patch versi + nama aplikasi native pada proyek Android yang di-generate
 * Capacitor (ephemeral di CI). TIDAK berisi secret apa pun.
 *
 * Pemakaian:
 *   node scripts/patch-android-build.mjs --version-name 1.0.0 --version-code 1
 *   node scripts/patch-android-build.mjs --app-name "ACE STORAGE"
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
}

const versionName = arg("--version-name", "");
const versionCode = arg("--version-code", "");
const appName = arg("--app-name", "ACE STORAGE");
const root = resolve(process.cwd());

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (versionCode && !/^\d+$/.test(versionCode)) fail(`version_code harus angka: "${versionCode}"`);
if (versionName && !/^[0-9A-Za-z._+-]{1,32}$/.test(versionName)) {
  fail(`version_name tidak valid: "${versionName}"`);
}
if (!/^[\w .&'-]{1,40}$/.test(appName)) fail(`app_name tidak valid: "${appName}"`);

// ── 1. Versi ─────────────────────────────────────────────────────────────
// Proyek ini memakai SSOT `android/version.properties` (dibaca build.gradle).
// Kalau proyek Android baru saja di-generate Capacitor dan belum punya file
// itu, fallback ke patch literal di build.gradle.
const gradlePath = resolve(root, "android/app/build.gradle");
if (!existsSync(gradlePath)) fail("android/app/build.gradle tidak ada — jalankan `bunx cap add android` dulu.");

const versionPropsPath = resolve(root, "android/version.properties");
const gradleUsesSsot = readFileSync(gradlePath, "utf8").includes("version.properties");

if (versionName || versionCode) {
  if (gradleUsesSsot) {
    const current = existsSync(versionPropsPath) ? readFileSync(versionPropsPath, "utf8") : "";
    const nextCode = versionCode || (current.match(/^VERSION_CODE=(.*)$/m)?.[1] ?? "1").trim();
    const nextName = versionName || (current.match(/^VERSION_NAME=(.*)$/m)?.[1] ?? "1.0.0").trim();
    writeFileSync(
      versionPropsPath,
      `# Ditulis oleh scripts/patch-android-build.mjs (build ephemeral).\n` +
        `VERSION_CODE=${nextCode}\nVERSION_NAME=${nextName}\n`,
    );
  } else {
    let gradle = readFileSync(gradlePath, "utf8");
    if (versionCode) {
      if (!/versionCode\s+[^\n]+/.test(gradle)) fail("versionCode tidak ditemukan di build.gradle");
      gradle = gradle.replace(/versionCode\s+[^\n]+/, `versionCode ${versionCode}`);
    }
    if (versionName) {
      if (!/versionName\s+[^\n]+/.test(gradle)) fail("versionName tidak ditemukan di build.gradle");
      gradle = gradle.replace(/versionName\s+[^\n]+/, `versionName "${versionName}"`);
    }
    writeFileSync(gradlePath, gradle);
  }
}

// ── 2. strings.xml → app_name (nama yang tampil di launcher) ─────────────
const stringsPath = resolve(root, "android/app/src/main/res/values/strings.xml");
if (existsSync(stringsPath)) {
  let strings = readFileSync(stringsPath, "utf8");
  strings = strings
    .replace(/(<string name="app_name">)[^<]*(<\/string>)/, `$1${appName}$2`)
    .replace(/(<string name="title_activity_main">)[^<]*(<\/string>)/, `$1${appName}$2`);
  writeFileSync(stringsPath, strings);
}

console.log(
  `✓ patch android: app_name="${appName}"` +
    (versionName ? ` versionName=${versionName}` : "") +
    (versionCode ? ` versionCode=${versionCode}` : ""),
);
