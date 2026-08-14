#!/usr/bin/env node
/**
 * Pre-flight release: verifikasi minify/proguard/signing di
 * `android/app/build.gradle` sebelum Gradle jalan, dan (kalau
 * dijalankan dengan --post) verifikasi `mapping.txt` ter-generate
 * & tersalin ke `dist/mapping/`.
 *
 * Pemakaian:
 *   node scripts/preflight-release.mjs           # pre-build cek konfig
 *   node scripts/preflight-release.mjs --post    # post-build cek artefak
 *   node scripts/preflight-release.mjs --strict  # warn → fail
 *
 * Cek pre-build (default):
 *   1. android/app/build.gradle ada.
 *   2. buildTypes.release memakai signingConfigs.release
 *      (kalau tidak, AAB unsigned → ditolak Play).
 *   3. buildTypes.release.minifyEnabled = true
 *      (aktifkan R8 → APK lebih kecil + obfuscation + mapping.txt).
 *   4. buildTypes.release.shrinkResources = true (recommended).
 *   5. proguardFiles memasukkan `proguard-rules.pro`.
 *   6. File `proguard-rules.pro` ada (boleh kosong; sekadar placeholder).
 *   7. keepDebugSymbols/native minify flags (info saja untuk NDK).
 *
 * Cek post-build (--post):
 *   a. mapping.txt ada di
 *      android/app/build/outputs/mapping/release/mapping.txt
 *   b. Salin ke dist/mapping/mapping-<versionCode>.txt untuk arsip &
 *      upload manual ke Play Console (Deobfuscation files).
 *   c. AAB ada di outputs/bundle/release/app-release.aab.
 *   d. File mengandung sinyal signing (peek 'META-INF/*.RSA|.EC').
 *
 * Semua peringatan default = warning (exit 0). --strict = fail.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  copyFileSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { readAppVersion } from "./read-app-version.mjs";

const argv = process.argv.slice(2);
const args = new Set(argv);
function flag(name, fallback) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : fallback;
}
const ROOT = resolve(process.cwd());
const isPost = args.has("--post");
const strict = args.has("--strict");
const warnings = [];
const errors = [];
function warn(msg) {
  warnings.push(msg);
  console.log(`  ⚠ ${msg}`);
}
function err(msg) {
  errors.push(msg);
  console.log(`  ✗ ${msg}`);
}
function ok(msg) {
  console.log(`  ✓ ${msg}`);
}

banner(`Pre-flight release · MCM Storage · ${isPost ? "POST-build" : "PRE-build"}`);

if (!isPost) {
  runPreBuild();
} else {
  runPostBuild();
}

// ─── Ringkasan ────────────────────────────────────────────────────────
banner(
  errors.length
    ? `Gagal — ${errors.length} error, ${warnings.length} warning`
    : warnings.length
      ? `Selesai dengan ${warnings.length} warning`
      : "Semua cek lolos",
);

if (errors.length) process.exit(1);
if (warnings.length && strict) {
  console.log("\n--strict aktif: warning dianggap error.");
  process.exit(1);
}
process.exit(0);

// ─── PRE-BUILD ────────────────────────────────────────────────────────
function runPreBuild() {
  step("1  android/app/build.gradle ada");
  const gradlePath = resolve(ROOT, "android/app/build.gradle");
  if (!existsSync(gradlePath)) {
    err(`build.gradle tidak ada: ${gradlePath}. Jalankan \`bunx cap add android\`.`);
    return;
  }
  ok(gradlePath);
  const src = readFileSync(gradlePath, "utf8");

  // Fokus ke blok buildTypes.release {}
  const releaseBlock = extractBlock(src, /buildTypes\s*\{[\s\S]*?release\s*\{/);
  if (!releaseBlock) {
    err("Blok `buildTypes { release { … } }` tidak ditemukan.");
    return;
  }

  step("2  release memakai signingConfigs.release");
  if (/signingConfig\s+signingConfigs\.release/.test(releaseBlock)) {
    ok("signingConfig wired");
  } else {
    err(
      "buildTypes.release TIDAK memakai `signingConfig signingConfigs.release`.\n" +
        "    Tanpa ini, `bundleRelease` menghasilkan AAB UNSIGNED → Play Console tolak.\n" +
        "    Lihat docs/BUILD_AAB.md → \"Wire ke android/app/build.gradle\".",
    );
  }

  step("3  minifyEnabled = true (R8)");
  if (/minifyEnabled\s+true/.test(releaseBlock)) {
    ok("R8 aktif — APK lebih kecil + mapping.txt akan ter-generate");
  } else {
    warn(
      "minifyEnabled tidak `true`. Tanpa R8: APK lebih besar, tanpa obfuscation,\n" +
        "    dan Play Console tidak bisa deobfuscate stacktrace crash.\n" +
        "    Rekomendasi (di buildTypes.release):\n" +
        "      minifyEnabled true\n" +
        "      shrinkResources true\n" +
        "      proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'",
    );
  }

  step("4  shrinkResources = true");
  if (/shrinkResources\s+true/.test(releaseBlock)) {
    ok("shrinkResources aktif");
  } else if (/minifyEnabled\s+true/.test(releaseBlock)) {
    warn("minifyEnabled true tapi shrinkResources tidak — resource yang tidak dipakai ikut dibundle.");
  } else {
    console.log("    (skip; minifyEnabled false)");
  }

  step("5  proguardFiles memasukkan proguard-rules.pro");
  if (/proguardFiles[^\n{}]*proguard-rules\.pro/.test(releaseBlock)) {
    ok("proguard-rules.pro ter-referensi");
  } else if (/minifyEnabled\s+true/.test(releaseBlock)) {
    warn(
      "R8 aktif tapi `proguard-rules.pro` tidak di-reference di proguardFiles.\n" +
        "    Aturan default OK untuk kebanyakan app, tapi kalau ada lib refleksi\n" +
        "    (mis. Gson/kotlinx-serialization) crash post-minify bisa terjadi.",
    );
  } else {
    console.log("    (skip; minifyEnabled false)");
  }

  step("6  File proguard-rules.pro ada");
  const pgPath = resolve(ROOT, "android/app/proguard-rules.pro");
  if (existsSync(pgPath)) {
    ok(`${pgPath} (${statSync(pgPath).size} byte)`);
  } else if (/minifyEnabled\s+true/.test(releaseBlock)) {
    warn(
      `File tidak ada: ${pgPath}. Buat file kosong sebagai placeholder:\n` +
        "      echo '# ProGuard rules Ace' > android/app/proguard-rules.pro",
    );
  } else {
    console.log("    (skip; minifyEnabled false)");
  }

  step("7  Kredensial signing (env var ATAU keystore.properties)");
  const propsPath = resolve(ROOT, "android/keystore.properties");
  const envSigning =
    process.env.KEYSTORE_FILE && existsSync(resolve(process.env.KEYSTORE_FILE)) &&
    process.env.KEYSTORE_ALIAS &&
    process.env.KEYSTORE_STORE_PASS &&
    process.env.KEYSTORE_KEY_PASS;
  if (envSigning) {
    ok("kredensial dari environment (KEYSTORE_FILE/ALIAS/STORE_PASS/KEY_PASS)");
  } else if (existsSync(propsPath)) {
    ok("android/keystore.properties ada (validator terpisah cek isinya)");
  } else {
    err(
      "Kredensial signing tidak ditemukan.\n" +
        "      CI    : set env KEYSTORE_FILE, KEYSTORE_ALIAS, KEYSTORE_STORE_PASS, KEYSTORE_KEY_PASS.\n" +
        "      Lokal : jalankan sekali `bun run aab:setup-keystore` (menulis android/keystore.properties).",
    );
  }

  if (!/version\.properties/.test(src)) {
    warn(
      "build.gradle tidak membaca android/version.properties — SSOT versi bisa jadi ganda.",
    );
  }

  step("8  Cek versionCode monotonic-safe (SSOT android/version.properties)");
  const appVersion = readAppVersion();
  const vc = appVersion ? String(appVersion.versionCode) : null;
  const vn = appVersion?.versionName ?? null;
  if (vc && vn) {
    ok(`versionCode=${vc}, versionName=${vn}`);
    if (Number(vc) < 100) {
      warn(
        `versionCode ${vc} sangat kecil. Kalau app pernah dirilis dengan versionCode lebih tinggi,\n` +
          "    upload ke Play akan gagal 'Version code already used / lower'.\n" +
          "    Skrip auto-bump: `bun run version:bump`.",
      );
    }
  } else {
    err(
      "versionCode/versionName tidak bisa dibaca. SSOT = android/version.properties\n" +
        "    (VERSION_CODE / VERSION_NAME). Jalankan `bun run version:check`.",
    );
  }

  checkIdentity(src);
}

/**
 * Identitas rilis MCM Storage — satu package, satu label, tanpa sisa
 * flavor chat. Semua cek di sini FATAL: salah identitas = salah app di Play.
 */
function checkIdentity(gradleSrc) {
  step("9  applicationId = mcmstorage.app (tidak ada package chat)");
  const appId = /applicationId\s+["']([^"']+)["']/.exec(gradleSrc)?.[1];
  if (appId === "mcmstorage.app") ok(`applicationId ${appId}`);
  else err(`applicationId Gradle = ${appId ?? "tidak terbaca"} (harus mcmstorage.app).`);

  const capPath = resolve(ROOT, "capacitor.config.ts");
  if (existsSync(capPath)) {
    const cap = readFileSync(capPath, "utf8");
    const capId = /appId:\s*["']([^"']+)["']/.exec(cap)?.[1];
    if (capId === "mcmstorage.app") ok("capacitor.config.ts appId cocok");
    else err(`capacitor.config.ts appId = ${capId ?? "tidak terbaca"} (harus mcmstorage.app).`);
    if (/biz\.mcmstorage\.chat|Ace Chat|APP_VARIANT/.test(cap)) {
      err("capacitor.config.ts masih memuat sisa varian chat.");
    }
  }

  step("10  App label = MCM Storage");
  const stringsPath = resolve(ROOT, "android/app/src/main/res/values/strings.xml");
  if (existsSync(stringsPath)) {
    const xml = readFileSync(stringsPath, "utf8");
    const label = /<string name="app_name">([^<]*)<\/string>/.exec(xml)?.[1];
    if (label === "MCM Storage") ok(`app_name = ${label}`);
    else err(`app_name = ${label ?? "tidak terbaca"} (harus "MCM Storage").`);
    if (/Ace Chat|Private Connect/i.test(xml)) err("strings.xml memuat label app lain.");
    const scheme = /<string name="custom_url_scheme">([^<]*)<\/string>/.exec(xml)?.[1];
    if (scheme === "mcmstorage.app") ok("custom_url_scheme = mcmstorage.app");
    else err(`custom_url_scheme = ${scheme ?? "tidak terbaca"} (harus mcmstorage.app).`);
  } else {
    err(`strings.xml tidak ada: ${stringsPath}`);
  }

  step("11  Manifest: tanpa komponen chat privat, tanpa cleartext/debuggable");
  const manifestPath = resolve(ROOT, "android/app/src/main/AndroidManifest.xml");
  if (existsSync(manifestPath)) {
    const m = readFileSync(manifestPath, "utf8");
    const banned = [
      "IncomingCallActivity",
      "ChatBubbleActivity",
      "CallForegroundService",
      "mcmstorage.chat",
      "com.mcm.privateconnect",
    ].filter((b) => m.includes(b));
    for (const perm of [
      "USE_FULL_SCREEN_INTENT",
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_MICROPHONE",
      "FOREGROUND_SERVICE_CAMERA",
      "FOREGROUND_SERVICE_PHONE_CALL",
      "MANAGE_OWN_CALLS",
      "SYSTEM_ALERT_WINDOW",
    ]) {
      if (m.includes(`<uses-permission android:name="android.permission.${perm}"`)) {
        banned.push(`izin ${perm}`);
      }
    }
    if (banned.length) err(`Manifest masih memuat: ${banned.join(", ")}`);
    else ok("tidak ada komponen/izin milik MCM: Private Connect");
    if (/android:debuggable="true"/.test(m)) err('Manifest memaksa android:debuggable="true".');
    else ok("tidak ada debuggable=true");
    if (/android:usesCleartextTraffic="true"/.test(m)) err("usesCleartextTraffic=true tidak boleh.");
    else ok("cleartext traffic nonaktif");
    for (const host of ["mcmstorage.app", "www.mcmstorage.app"]) {
      if (m.includes(`android:host="${host}"`)) ok(`app link host ${host}`);
      else warn(`App Link host ${host} tidak ada di manifest.`);
    }
  } else {
    err(`AndroidManifest.xml tidak ada: ${manifestPath}`);
  }

  step("12  Firebase google-services.json cocok package");
  const gsPath = resolve(ROOT, "android/app/google-services.json");
  if (!existsSync(gsPath)) {
    err(
      `google-services.json tidak ada (${gsPath}).\n` +
        "    Push notification native TIDAK akan jalan di AAB ini.\n" +
        "    Unduh dari Firebase console untuk package mcmstorage.app lalu commit/inject di CI.",
    );
  } else {
    let pkgs = [];
    try {
      const gs = JSON.parse(readFileSync(gsPath, "utf8"));
      pkgs = (gs.client ?? []).map((c) => c?.client_info?.android_client_info?.package_name);
    } catch {
      err("google-services.json bukan JSON valid.");
    }
    if (pkgs.length !== 1 || pkgs[0] !== "mcmstorage.app") {
      err(
        `google-services.json harus tepat satu client mcmstorage.app (ada: ${pkgs.join(", ") || "none"}).`,
      );
    } else {
      ok("client mcmstorage.app tersedia");
    }
  }

  step("13  min/target SDK");
  const varsPath = resolve(ROOT, "android/variables.gradle");
  if (existsSync(varsPath)) {
    const v = readFileSync(varsPath, "utf8");
    const target = Number(/targetSdkVersion\s*=\s*(\d+)/.exec(v)?.[1] ?? 0);
    const min = Number(/minSdkVersion\s*=\s*(\d+)/.exec(v)?.[1] ?? 0);
    if (target >= 36) ok(`targetSdkVersion ${target}`);
    else err(`targetSdkVersion ${target} — rilis MCM Storage mensyaratkan >= 36.`);
    if (min >= 23) ok(`minSdkVersion ${min}`);
    else warn(`minSdkVersion ${min} cukup rendah.`);
  } else {
    warn("android/variables.gradle tidak ada — min/target SDK tidak diverifikasi.");
  }

  step("14  assetlinks.json publik");
  const al = ["public/.well-known/assetlinks.json", "public/well-known/assetlinks.json"]
    .map((rel) => resolve(ROOT, rel))
    .find((f) => existsSync(f)) ?? resolve(ROOT, "public/.well-known/assetlinks.json");
  if (existsSync(al)) {
    const raw = readFileSync(al, "utf8");
    if (raw.includes("mcmstorage.app")) ok("assetlinks.json memuat mcmstorage.app");
    else err("assetlinks.json tidak memuat package mcmstorage.app.");
    if (/mcmstorage\.chat/.test(raw)) err("assetlinks.json masih memuat package chat.");
  } else {
    warn(`assetlinks.json belum ada di ${al} — App Links tidak akan terverifikasi.`);
  }
}

// ─── POST-BUILD ───────────────────────────────────────────────────────
function runPostBuild() {
  step("a  AAB release ada");
  const aab = resolve(ROOT, "android/app/build/outputs/bundle/release/app-release.aab");
  if (!existsSync(aab)) {
    err(`AAB tidak ada: ${aab}`);
    return;
  }
  const aabSize = statSync(aab).size;
  ok(`${aab} (${(aabSize / 1024 / 1024).toFixed(1)} MB)`);

  step("b  AAB tanda-tangan (peek META-INF)");
  // Peek dengan unzip -l — hindari full extract.
  const unzip = spawnSync("unzip", ["-l", aab], { encoding: "utf8" });
  if (unzip.status === 0) {
    const list = unzip.stdout || "";
    const hasSig = /META-INF\/[^\s]+\.(RSA|EC|DSA)/i.test(list);
    if (hasSig) ok("METADATA signing terdeteksi (META-INF/*.RSA/EC/DSA)");
    else err("Tidak ditemukan signing artefact di META-INF. AAB tidak boleh dirilis.");
  } else {
    err("`unzip` tidak tersedia — signature AAB tidak dapat diverifikasi.");
  }

  step("b2 Package AAB = mcmstorage.app dan tidak debuggable");
  const bundletool = process.env.BUNDLETOOL_JAR;
  if (!bundletool || !existsSync(bundletool)) {
    err("BUNDLETOOL_JAR tidak tersedia — package/debuggable AAB tidak dapat diverifikasi.");
  } else {
    const dump = spawnSync("java", ["-jar", bundletool, "dump", "manifest", "--bundle", aab], {
      encoding: "utf8",
    });
    const manifest = dump.stdout || "";
    if (dump.status !== 0) err(`bundletool gagal membaca manifest AAB: ${(dump.stderr || "").trim()}`);
    else {
      if (/package="mcmstorage\.app"/.test(manifest)) ok("package AAB = mcmstorage.app");
      else err("package AAB bukan mcmstorage.app.");
      if (/android:debuggable="true"/.test(manifest)) err("AAB release masih debuggable.");
      else ok("AAB tidak debuggable");
      if (/android:label="MCM Storage"/.test(manifest) || /resource=.*app_name/.test(manifest)) {
        ok("label AAB merujuk MCM Storage");
      } else {
        err("label MCM Storage tidak terverifikasi di manifest AAB.");
      }
    }
  }

  step("c  mapping.txt ter-generate");
  const mapping = resolve(ROOT, "android/app/build/outputs/mapping/release/mapping.txt");
  if (existsSync(mapping)) {
    const vc = String(readAppVersion()?.versionCode ?? "unknown");
    const archive = resolve(ROOT, `dist/mapping/mcm-storage-vc${vc}-mapping.txt`);
    mkdirSync(dirname(archive), { recursive: true });
    copyFileSync(mapping, archive);
    ok(`${mapping} → arsip ${archive} (${(statSync(mapping).size / 1024).toFixed(1)} KB)`);
    console.log(
      `    Upload manual di Play Console → App bundle explorer → versionCode ${vc}\n` +
        "    → Downloads → \"Retracer mapping file\" → Upload.",
    );
  } else {
    warn(
      `mapping.txt tidak ada di ${mapping}.\n` +
        "    Kalau minifyEnabled=false, ini expected. Kalau true, R8 tidak jalan — cek build log.",
    );
  }

  step("d  Salin AAB ke dist/ untuk arsip");
  const appVersion = readAppVersion();
  const vn = appVersion?.versionName ?? "unknown";
  const vc = String(appVersion?.versionCode ?? "unknown");
  const distAab = resolve(ROOT, `dist/aab/mcm-storage-${vn}-vc${vc}-release.aab`);
  mkdirSync(dirname(distAab), { recursive: true });
  copyFileSync(aab, distAab);
  ok(`arsip: ${distAab}`);
  try {
    const sum = spawnSync("sha256sum", [distAab], { encoding: "utf8" });
    if (sum.status === 0) {
      const digest = (sum.stdout || "").trim().split(/\s+/)[0];
      writeFileSync(`${distAab}.sha256`, `${digest}  ${distAab.split("/").pop()}\n`);
      ok(`sha256: ${digest}`);
    }
  } catch {
    warn("sha256sum tidak tersedia — checksum dilewati.");
  }
}

// ─── util ─────────────────────────────────────────────────────────────
function extractBlock(text, startRegex) {
  const m = startRegex.exec(text);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  while (i < text.length && depth > 0) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  return depth === 0 ? text.slice(start, i - 1) : null;
}
function banner(msg) {
  const line = "═".repeat(msg.length + 4);
  console.log(`\n${line}\n  ${msg}  \n${line}`);
}
function step(msg) {
  console.log(`\n▶ ${msg}`);
}