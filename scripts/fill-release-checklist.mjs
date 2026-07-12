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
 *   # Tanpa --aab: skrip cari .aab terbaru (mtime) di dist/aab/ &
 *   # android/app/build/outputs/bundle/{release,debug}/ secara otomatis.
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
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
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
const aabPathFlag = flag("--aab");
const discovery = aabPathFlag ? null : findLatestAab(ROOT);
const autoAab = discovery?.winner ?? null;
const aabPath = aabPathFlag ?? autoAab?.rel ?? "dist/app-release.aab";
const aabAutoDiscovered = !aabPathFlag && !!autoAab;
const aabSource = aabPathFlag ? "--aab" : aabAutoDiscovered ? "auto-discover" : "default-fallback";
const aabReason = buildAabReason({ aabPathFlag, discovery });
printAabDetection({ aabPath, aabSource, aabReason, discovery, autoAab });
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
  : validateAabManifest(resolve(ROOT, aabPath), versionCode, versionName);
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
  aabAutoDiscovered,
  aabSource,
  aabReason,
  aabCandidates: discovery?.candidates ?? [],
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
console.log(`  aab source  : ${aabSource}`);
console.log(`  aab reason  : ${aabReason}\n`);
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

// ─── Auto-discover AAB terbaru ───────────────────────────────────────
/**
 * Mencari file .aab dengan mtime terbaru di folder-folder standar:
 *   - dist/aab/                              (arsip hasil preflight)
 *   - android/app/build/outputs/bundle/release/
 *   - android/app/build/outputs/bundle/debug/
 * Return { abs, rel, mtimeMs } atau null.
 */
function findLatestAab(rootAbs) {
  // Urutan folder ini juga menjadi prioritas tie-breaker: jika ada dua
  // .aab dengan mtime persis sama (jarang tapi mungkin di CI), yang di
  // folder lebih atas menang.
  const dirs = [
    { abs: resolve(rootAbs, "dist/aab"), label: "dist/aab" },
    {
      abs: resolve(rootAbs, "android/app/build/outputs/bundle/release"),
      label: "android/app/build/outputs/bundle/release",
    },
    {
      abs: resolve(rootAbs, "android/app/build/outputs/bundle/debug"),
      label: "android/app/build/outputs/bundle/debug",
    },
  ];
  const candidates = [];
  const scanned = [];
  let best = null;
  let bestPriority = Infinity;
  for (let i = 0; i < dirs.length; i++) {
    const { abs: dir, label } = dirs[i];
    scanned.push({ dir: label, exists: existsSync(dir) });
    if (!existsSync(dir)) continue;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.toLowerCase().endsWith(".aab")) continue;
      const abs = resolve(dir, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      const entry = {
        abs,
        rel: relative(rootAbs, abs),
        mtimeMs: st.mtimeMs,
        dir: label,
        priority: i,
      };
      candidates.push(entry);
      if (
        !best ||
        st.mtimeMs > best.mtimeMs ||
        (st.mtimeMs === best.mtimeMs && i < bestPriority)
      ) {
        best = entry;
        bestPriority = i;
      }
    }
  }
  return { winner: best, candidates, scanned };
}

function buildAabReason({ aabPathFlag, discovery }) {
  if (aabPathFlag) return `dipilih eksplisit via --aab ${aabPathFlag}`;
  if (!discovery || !discovery.winner) {
    const dirs = discovery?.scanned?.map((s) => `${s.dir}${s.exists ? "" : " (tidak ada)"}`).join(", ");
    return `tidak ada .aab ditemukan di [${dirs}]; fallback default dist/app-release.aab`;
  }
  const w = discovery.winner;
  const total = discovery.candidates.length;
  const ageMin = ((Date.now() - w.mtimeMs) / 60_000).toFixed(1);
  if (total === 1) {
    return `satu-satunya .aab yang ditemukan (di ${w.dir}, mtime ${ageMin} menit lalu)`;
  }
  const tied = discovery.candidates.filter((c) => c.mtimeMs === w.mtimeMs).length > 1;
  if (tied) {
    return `${total} kandidat; prioritas folder (${w.dir}) memenangkan tie mtime; mtime ${ageMin} menit lalu`;
  }
  return `mtime terbaru dari ${total} kandidat (${w.dir}, ${ageMin} menit lalu)`;
}

function printAabDetection({ aabPath, aabSource, aabReason, discovery, autoAab }) {
  console.log("\n── AAB detection ────────────────────────────────────");
  console.log(`  path   : ${aabPath}`);
  console.log(`  source : ${aabSource}`);
  console.log(`  reason : ${aabReason}`);
  if (discovery && discovery.candidates.length > 0) {
    console.log(`  kandidat (${discovery.candidates.length}):`);
    const sorted = [...discovery.candidates].sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const c of sorted) {
      const ageMin = ((Date.now() - c.mtimeMs) / 60_000).toFixed(1);
      const marker = autoAab && c.abs === autoAab.abs ? "★" : " ";
      console.log(`    ${marker} ${c.rel}  (${c.dir}, mtime ${ageMin} mnt lalu)`);
    }
  } else if (discovery) {
    console.log("  kandidat: (tidak ada)");
    for (const s of discovery.scanned) {
      console.log(`    - ${s.dir}${s.exists ? "" : " (tidak ada)"}`);
    }
  }
  console.log("─────────────────────────────────────────────────────\n");
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
function validateAabManifest(aabAbs, expectedCode, expectedName) {
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
        "Sementara ini versionCode/versionName di AAB tidak diverifikasi.",
    };
  }
  const codeRes = dumpManifestAttr(tool, aabAbs, "/manifest/@android:versionCode");
  if (codeRes.status !== "ok") return codeRes;
  const nameRes = dumpManifestAttr(tool, aabAbs, "/manifest/@android:versionName");
  if (nameRes.status !== "ok") return nameRes;
  const codeMatch = /(\d+)/.exec(codeRes.raw);
  if (!codeMatch) {
    return {
      status: "error",
      message: `Tidak bisa parse versionCode dari bundletool: "${codeRes.raw}"`,
    };
  }
  const aabVc = Number.parseInt(codeMatch[1], 10);
  const aabVn = nameRes.raw.replace(/^["']|["']$/g, "").trim();
  if (!aabVn) {
    return {
      status: "error",
      message: `versionName di AAB kosong / tidak terbaca (raw: "${nameRes.raw}")`,
    };
  }
  if (aabVc !== expectedCode) {
    return {
      status: "mismatch",
      message:
        `versionCode di AAB (${aabVc}) ≠ build.gradle (${expectedCode}). ` +
        "Rebuild AAB atau update build.gradle sebelum upload.",
      aabVersionCode: aabVc,
      aabVersionName: aabVn,
    };
  }
  if (aabVn !== expectedName) {
    return {
      status: "mismatch",
      message:
        `versionName di AAB ("${aabVn}") ≠ build.gradle ("${expectedName}"). ` +
        "Rebuild AAB atau update build.gradle sebelum upload.",
      aabVersionCode: aabVc,
      aabVersionName: aabVn,
    };
  }
  return {
    status: "ok",
    message: `versionCode=${aabVc}, versionName="${aabVn}" di AAB cocok dengan build.gradle`,
    aabVersionCode: aabVc,
    aabVersionName: aabVn,
  };
}

function dumpManifestAttr(tool, aabAbs, xpath) {
  const argv = [...tool.prefix, "dump", "manifest", `--bundle=${aabAbs}`, `--xpath=${xpath}`];
  const r = spawnSync(tool.cmd, argv, { encoding: "utf8" });
  if (r.status !== 0) {
    return {
      status: "error",
      message:
        `bundletool gagal (exit ${r.status}) saat baca ${xpath}. stderr: ` +
        (r.stderr?.trim().slice(0, 200) || "(kosong)"),
    };
  }
  return { status: "ok", raw: (r.stdout || "").trim() };
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
