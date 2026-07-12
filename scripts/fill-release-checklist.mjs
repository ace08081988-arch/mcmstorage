#!/usr/bin/env node
/**
 * Mengisi RELEASE_CHECKLIST.md secara otomatis dari:
 *   - versionCode / versionName di android/app/build.gradle
 *   - nama tag Git (atau --tag)
 *   - branch + commit SHA saat ini
 *   - tanggal hari ini
 *
 * Penggunaan:
 *   node scripts/fill-release-checklist.mjs
 *   node scripts/fill-release-checklist.mjs --tag v1.4.0
 *   node scripts/fill-release-checklist.mjs --output CHECKLIST-v1.4.0.md
 *   node scripts/fill-release-checklist.mjs --in-place
 *   node scripts/fill-release-checklist.mjs --print
 *   node scripts/fill-release-checklist.mjs --dry-run
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const ROOT = resolve(process.cwd());
const GRADLE = resolve(ROOT, "android/app/build.gradle");
const TEMPLATE = resolve(ROOT, "RELEASE_CHECKLIST.md");

const argv = process.argv.slice(2);
const args = new Set(argv);

function flag(name) {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : undefined;
}

const dryRun = args.has("--dry-run");
const printOnly = args.has("--print");
const inPlace = args.has("--in-place");
const tagOverride = flag("--tag");
const outputPath = flag("--output");
const aabPath = flag("--aab") ?? "dist/app-release.aab";

if (!existsSync(GRADLE)) {
  fail(`${GRADLE} tidak ditemukan. Pastikan project Android sudah di-sync.`);
}
if (!existsSync(TEMPLATE)) {
  fail(`${TEMPLATE} tidak ditemukan.`);
}

const gradleSrc = readFileSync(GRADLE, "utf8");
const { versionCode, versionName } = parseGradle(gradleSrc);
const baseVersion = deriveBaseVersion(versionName);

const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]) ?? "unknown";
const commit = git(["rev-parse", "--short", "HEAD"]) ?? "unknown";

let tag = tagOverride;
if (!tag) {
  tag = git(["describe", "--tags", "--exact-match"]) ?? `v${baseVersion}`;
}
if (!tagOverride && tag === `v${baseVersion}`) {
  console.warn(
    `\n⚠ Tidak ada tag di HEAD. Menggunakan tag default v${baseVersion}. ` +
      `Jalankan dengan --tag <nama-tag> jika ingin tag lain.\n`,
  );
}

const now = new Date();
const dateId = now.toLocaleDateString("id-ID", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const dateEn = now.toLocaleDateString("en-US", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const releaseName = `${baseVersion} (${versionCode})`;
const tagWithPrefix = tag.startsWith("v") ? tag : `v${tag}`;

const plan = {
  versionCode,
  versionName,
  baseVersion,
  releaseName,
  tag,
  branch,
  commit,
  dateId,
  dateEn,
  aabPath,
  output: inPlace
    ? "RELEASE_CHECKLIST.md"
    : outputPath ?? `RELEASE_CHECKLIST-${tagWithPrefix}.md`,
};

if (dryRun) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

let template = readFileSync(TEMPLATE, "utf8");

// Urutan penting: placeholder yang lebih spesifik / lebih panjang didahulukan.
template = template
  .replaceAll("{{ 1.2.3 (5) }}", releaseName)
  .replaceAll("{{ 1.2.3 }}", baseVersion)
  .replaceAll("{{ 5 }}", String(versionCode))
  .replaceAll("{{ 12 Juli 2026 }}", dateId)
  .replaceAll("{{ July 12, 2026 }}", dateEn)
  .replaceAll("{{ main }}", branch)
  .replaceAll("{{ abc1234 }}", commit)
  .replaceAll("dist/app-release.aab", aabPath);

if (printOnly) {
  console.log(template);
  process.exit(0);
}

const outFile = resolve(ROOT, plan.output);
writeFileSync(outFile, template);
console.log(`\n✓ Checklist rilis tersimpan di: ${plan.output}`);
console.log(`  versionCode : ${versionCode}`);
console.log(`  versionName : ${versionName}`);
console.log(`  baseVersion : ${baseVersion}`);
console.log(`  tag         : ${tag}`);
console.log(`  branch      : ${branch}`);
console.log(`  commit      : ${commit}`);
console.log(`  tanggal ID  : ${dateId}`);
console.log(`  tanggal EN  : ${dateEn}`);
console.log(`  aab path    : ${aabPath}\n`);

process.exit(0);

// ─── util ─────────────────────────────────────────────────────────────
function parseGradle(text) {
  const vc = /versionCode\s+(\d+)/.exec(text);
  const vn = /versionName\s+"([^"]+)"/.exec(text);
  if (!vc) fail("Tidak menemukan `versionCode` di build.gradle.");
  if (!vn) fail("Tidak menemukan `versionName` di build.gradle.");
  return { versionCode: Number(vc[1]), versionName: vn[1] };
}

function deriveBaseVersion(name) {
  // versionName bisa "1.2.3+260712.01", "1.2.3", atau "1.0"
  const base = name.split("+")[0];
  if (/^\d+\.\d+\.\d+$/.test(base)) return base;
  if (/^\d+\.\d+$/.test(base)) return `${base}.0`;
  return base;
}

function git(args) {
  try {
    return execSync(`git ${args.join(" ")}`, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}
