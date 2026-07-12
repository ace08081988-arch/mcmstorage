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
 *   node scripts/fill-release-checklist.mjs --aab dist/aab/mcm-full-vc45.aab
 *   node scripts/fill-release-checklist.mjs --strict-aab           # gagal kalau AAB/bundletool tidak ada
 *   node scripts/fill-release-checklist.mjs --skip-aab-check       # lewati validasi AAB
 *
 * Validasi AAB (opsional tapi default aktif):
 *   Sebelum mengisi checklist, skrip memeriksa versionCode di dalam AAB
 *   target dan memastikan cocok dengan versionCode di build.gradle.
 *   Butuh `bundletool` di PATH atau env var BUNDLETOOL menunjuk ke jar.
 *   Kalau AAB atau bundletool tidak tersedia, defaultnya WARN (skrip
 *   tetap jalan). Pakai --strict-aab untuk fail-fast di CI.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync, spawnSync } from "node:child_process";

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
const strictAab = args.has("--strict-aab");
const skipAabCheck = args.has("--skip-aab-check");

if (!existsSync(GRADLE)) {
  fail(`${GRADLE} tidak ditemukan. Pastikan project Android sudah di-sync.`);
}
if (!existsSync(TEMPLATE)) {
  fail(`${TEMPLATE} tidak ditemukan.`);
}

const gradleSrc = readFileSync(GRADLE, "utf8");
const { versionCode, versionName } = parseGradle(gradleSrc);
const baseVersion = deriveBaseVersion(versionName);

// ─── Validasi versionCode di AAB target ─────────────────────────────
const aabCheck = skipAabCheck
  ? { status: "skipped", message: "dilewati via --skip-aab-check" }
  : validateAabVersionCode(resolve(ROOT, aabPath), versionCode);
reportAabCheck(aabCheck);
if (strictAab && aabCheck.status !== "ok") {
  fail(
    `Validasi AAB gagal (--strict-aab): ${aabCheck.message}\n` +
      "Perbaiki AAB target atau install bundletool, lalu ulangi.",
  );
}

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
  aabCheck,
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
console.log(`  aab check   : ${aabCheck.status} — ${aabCheck.message}\n`);

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

// ─── Validasi AAB ─────────────────────────────────────────────────────
/**
 * Memeriksa versionCode di dalam AAB target dan membandingkannya dengan
 * versionCode dari build.gradle. Return status:
 *   - "ok"       cocok
 *   - "mismatch" AAB ada, versionCode berbeda
 *   - "missing"  file AAB tidak ada
 *   - "notool"   bundletool tidak tersedia
 *   - "error"    error saat menjalankan bundletool
 */
function validateAabVersionCode(aabAbs, expected) {
  if (!existsSync(aabAbs)) {
    return {
      status: "missing",
      message:
        `AAB tidak ada di ${aabAbs}. Bangun dulu (mis. \`bun run aab:build:release\`) ` +
        "atau tunjuk lewat --aab.",
    };
  }
  const tool = resolveBundletool();
  if (!tool) {
    return {
      status: "notool",
      message:
        "bundletool tidak ditemukan. Install (`brew install bundletool` / apt) " +
        "atau set env BUNDLETOOL=/abs/path/bundletool.jar. " +
        "Sementara ini versionCode di AAB tidak diverifikasi.",
    };
  }
  const argv = [
    ...tool.prefix,
    "dump",
    "manifest",
    `--bundle=${aabAbs}`,
    "--xpath=/manifest/@android:versionCode",
  ];
  const r = spawnSync(tool.cmd, argv, { encoding: "utf8" });
  if (r.status !== 0) {
    return {
      status: "error",
      message:
        `bundletool gagal (exit ${r.status}). stderr: ` +
        (r.stderr?.trim().slice(0, 200) || "(kosong)"),
    };
  }
  const raw = (r.stdout || "").trim();
  const m = /(\d+)/.exec(raw);
  if (!m) {
    return {
      status: "error",
      message: `Tidak bisa parse versionCode dari output bundletool: "${raw}"`,
    };
  }
  const aabVc = Number.parseInt(m[1], 10);
  if (aabVc !== expected) {
    return {
      status: "mismatch",
      message:
        `versionCode di AAB (${aabVc}) ≠ build.gradle (${expected}). ` +
        "Rebuild AAB atau update build.gradle sebelum upload.",
      aabVersionCode: aabVc,
    };
  }
  return {
    status: "ok",
    message: `versionCode AAB = ${aabVc} (cocok dengan build.gradle)`,
    aabVersionCode: aabVc,
  };
}

function resolveBundletool() {
  const jar = process.env.BUNDLETOOL;
  if (jar && existsSync(jar)) {
    return { cmd: "java", prefix: ["-jar", jar] };
  }
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["bundletool"], {
    encoding: "utf8",
  });
  if (which.status === 0 && which.stdout.trim()) {
    return { cmd: "bundletool", prefix: [] };
  }
  return null;
}

function reportAabCheck(c) {
  const icon =
    c.status === "ok" ? "✓" : c.status === "skipped" ? "↷" : c.status === "mismatch" ? "✗" : "⚠";
  console.log(`${icon} AAB check [${c.status}]: ${c.message}`);
}
