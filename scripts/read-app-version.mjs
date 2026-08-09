#!/usr/bin/env node
/**
 * Pembaca versi Android — SSOT tunggal: `android/version.properties`.
 *
 * Dipakai oleh: bump-version.mjs, preflight-release.mjs, upload-play.mjs,
 * workflow GitHub Actions, dan `bun run version:check`.
 *
 * CLI:
 *   node scripts/read-app-version.mjs           # tabel ringkas
 *   node scripts/read-app-version.mjs --json    # { versionCode, versionName, source }
 *   node scripts/read-app-version.mjs --field versionCode
 *
 * Skrip ini TIDAK PERNAH menulis apa pun (aman untuk dry-run / retry CI).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd());
const PROPS = resolve(ROOT, "android/version.properties");
const GRADLE = resolve(ROOT, "android/app/build.gradle");

export function readAppVersion() {
  if (existsSync(PROPS)) {
    const text = readFileSync(PROPS, "utf8");
    const vc = /^VERSION_CODE\s*=\s*(\d+)\s*$/m.exec(text)?.[1];
    const vn = /^VERSION_NAME\s*=\s*(.+?)\s*$/m.exec(text)?.[1];
    if (vc && vn) {
      return { versionCode: Number(vc), versionName: vn, source: "android/version.properties" };
    }
  }
  if (existsSync(GRADLE)) {
    const raw = readFileSync(GRADLE, "utf8");
    const vc = /versionCode\s+(\d+)/.exec(raw)?.[1];
    const vn = /versionName\s+"([^"]+)"/.exec(raw)?.[1];
    if (vc && vn) {
      return { versionCode: Number(vc), versionName: vn, source: "android/app/build.gradle (fallback)" };
    }
  }
  return null;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const argv = process.argv.slice(2);
  const v = readAppVersion();
  if (!v) {
    console.error(
      "\n✗ Tidak bisa membaca versi.\n" +
        `  Cek ${PROPS} (VERSION_CODE / VERSION_NAME) atau jalankan \`bunx cap add android\`.\n`,
    );
    process.exit(1);
  }
  const fieldIdx = argv.indexOf("--field");
  if (fieldIdx !== -1) {
    const key = argv[fieldIdx + 1];
    if (!(key in v)) {
      console.error(`✗ field tidak dikenal: ${key}`);
      process.exit(1);
    }
    console.log(String(v[key]));
  } else if (argv.includes("--json")) {
    console.log(JSON.stringify(v));
  } else {
    console.log(
      `\nversionCode : ${v.versionCode}\nversionName : ${v.versionName}\nsumber      : ${v.source}\n`,
    );
  }
  // Validasi format — sama dengan gate di workflow.
  if (!Number.isInteger(v.versionCode) || v.versionCode < 1) {
    console.error(`✗ versionCode "${v.versionCode}" bukan integer positif.`);
    process.exit(1);
  }
  if (!/^\d+(\.\d+){1,3}([+-][A-Za-z0-9.-]+)?$/.test(v.versionName)) {
    console.error(`✗ versionName "${v.versionName}" tidak mengikuti format semver.`);
    process.exit(1);
  }
  process.exit(0);
}
