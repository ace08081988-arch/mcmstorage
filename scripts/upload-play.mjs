#!/usr/bin/env node
/**
 * Upload AAB ke Google Play Console via Play Developer API v3.
 * Zero deps eksternal — pakai `jose` (sudah ada di package.json) untuk
 * signing JWT service-account + fetch bawaan Node 20.
 *
 * Pemakaian:
 *   node scripts/upload-play.mjs                        # varian full, track internal
 *   node scripts/upload-play.mjs --track production --release-status draft
 *   node scripts/upload-play.mjs --aab path/ke.aab
 *   node scripts/upload-play.mjs --package mcmstorage.app
 *
 * Flag:
 *   --track            internal (default) | alpha | beta | production
 *   --release-status   draft (default) | inProgress | halted | completed
 *   --release-name     Nama release (default: versionCode dari AAB)
 *   --rollout          Fraksi rollout 0..1 untuk track production
 *                      (dipakai hanya kalau --release-status inProgress)
 *   --notes id=path.txt,en-US=path.txt   Release notes per locale
 *   --dry-run          Auth + validasi saja, tanpa insert edit
 *   --skip-version-check  Lewati verifikasi versionCode vs Play Console
 *                         (TIDAK direkomendasikan — bikin upload gagal 403)
 *
 * Auth (SATU dari dua env harus di-set):
 *   PLAY_SERVICE_ACCOUNT_JSON      = path ke file service-account.json
 *   PLAY_SERVICE_ACCOUNT_JSON_B64  = isi file di-base64 (untuk CI)
 *
 *   Cara buat service account:
 *   1. Play Console → Setup → API access → Choose a project → Link.
 *   2. Create service account di Google Cloud IAM (Role: none di GCP).
 *   3. Kembali ke Play Console → Grant access → pilih SA →
 *      permission "Release manager" (Admin API) + akses ke app spesifik.
 *   4. Download JSON key. Simpan di ~/keys/mcm-play-sa.json (chmod 600).
 *   5. `export PLAY_SERVICE_ACCOUNT_JSON=~/keys/mcm-play-sa.json`
 *
 * Alur upload (Play Developer API v3):
 *   auth → edits.insert → edits.bundles.upload → edits.tracks.update →
 *   [releaseNotes] → edits.commit.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { readAppVersion } from "./read-app-version.mjs";
import { resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SignJWT, importPKCS8 } from "jose";

const argv = process.argv.slice(2);
const args = new Set(argv);
function flag(name, fallback) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : fallback;
}

const ROOT = resolve(process.cwd());
const variant = "full";
{
  const requested = flag("--variant");
  if (requested && requested !== "full") {
    fail(
      `Varian "${requested}" sudah dihapus. Project ini hanya merilis package mcmstorage.app.`,
    );
  }
}
const track = flag("--track", "internal");
const releaseStatus = flag("--release-status", "draft");
const releaseName = flag("--release-name");
const rollout = flag("--rollout");
const notesArg = flag("--notes");
const dryRun = args.has("--dry-run");
const aabOverride = flag("--aab");
const packageOverride = flag("--package");
const skipVersionCheck = args.has("--skip-version-check");

// State untuk ringkasan GitHub Actions (ditulis ke $GITHUB_STEP_SUMMARY di akhir).
const runSummary = {
  variant,
  packageName: null,
  track,
  releaseStatus,
  dryRun,
  skipVersionCheck,
  local: null,
  play: null, // { maxOverall, tracks:{...} }
  uploaded: null, // { versionCode, sha1 }
  committed: false,
  outcome: "pending", // pending | success | dry-run | failed
  error: null,
};
process.on("exit", () => {
  writeStepSummary(runSummary);
  writeSummaryJson(runSummary);
});

const VALID_TRACKS = ["internal", "alpha", "beta", "production"];
if (!VALID_TRACKS.includes(track)) fail(`--track harus salah satu: ${VALID_TRACKS.join(", ")}`);
const VALID_STATUS = ["draft", "inProgress", "halted", "completed"];
if (!VALID_STATUS.includes(releaseStatus))
  fail(`--release-status harus salah satu: ${VALID_STATUS.join(", ")}`);

banner(`Upload AAB ke Play Console · MCM Storage · track ${track}`);
const TOTAL = 7;

// ─── 1. Load service account ──────────────────────────────────────────
step(`1/${TOTAL}  Load service account`);
const sa = loadServiceAccount();
console.log(`  ✓ client_email: ${sa.client_email}`);

// ─── 2. Tentukan package name & AAB ───────────────────────────────────
step(`2/${TOTAL}  Cari AAB & tentukan packageName`);
const packageName =
  packageOverride ?? "mcmstorage.app";
console.log(`  ✓ packageName: ${packageName}`);
runSummary.packageName = packageName;

const aabPath = aabOverride
  ? resolveHome(aabOverride)
  : resolve(ROOT, "android/app/build/outputs/bundle/release/app-release.aab");
if (!existsSync(aabPath)) {
  fail(
    `AAB tidak ditemukan: ${aabPath}\n` +
      "Build dulu: bun run aab:build. Lalu ulangi.",
  );
}
const aabSize = statSync(aabPath).size;
console.log(`  ✓ ${aabPath} (${(aabSize / 1024 / 1024).toFixed(1)} MB)`);

// ─── 2b. Baca versionCode/versionName lokal dari build.gradle ────────
const local = readLocalVersion();
console.log(
  `  ✓ lokal (version.properties): versionCode=${local.versionCode} versionName=${local.versionName}`,
);
runSummary.local = local;

// ─── 3. Baca release notes (opsional) ─────────────────────────────────
step(`3/${TOTAL}  Baca release notes`);
const releaseNotes = [];
if (notesArg) {
  for (const pair of notesArg.split(",")) {
    const [locale, path] = pair.split("=");
    if (!locale || !path) fail(`Format --notes salah: "${pair}". Contoh: id=notes.txt`);
    const full = resolveHome(path);
    if (!existsSync(full)) fail(`File notes tidak ada: ${full}`);
    releaseNotes.push({ language: locale.trim(), text: readFileSync(full, "utf8").slice(0, 500) });
  }
  console.log(`  ✓ ${releaseNotes.length} locale`);
} else {
  console.log("  ⚠ tidak ada release notes (--notes tidak diberikan)");
}

// ─── 4. Ambil access token ────────────────────────────────────────────
step(`4/${TOTAL}  Auth ke Google (JWT bearer flow)`);
const accessToken = await getAccessToken(sa);
console.log("  ✓ access_token diperoleh");

// ─── 5. Verifikasi versionCode vs Play Console (PRE-UPLOAD) ───────────
step(`5/${TOTAL}  Verifikasi versionCode/versionName vs Play Console`);
if (skipVersionCheck) {
  console.log("  ⚠ DILEWATI (--skip-version-check). Kalau versionCode ≤ Play, upload akan 403.");
} else {
  const probeEdit = await api("POST", `/edits`, { accessToken, packageName });
  try {
    const summary = await collectPlayVersions(accessToken, packageName, probeEdit.id);
    runSummary.play = summary;
    reportPlaySummary(summary, track);
    const conflicts = [];
    if (summary.maxOverall != null && local.versionCode <= summary.maxOverall) {
      conflicts.push(
        `versionCode lokal (${local.versionCode}) ≤ versionCode tertinggi di Play (${summary.maxOverall}).\n` +
          "    Play menolak upload duplikat/downgrade. Jalankan: bun run version:bump",
      );
    }
    const trackInfo = summary.tracks[track];
    if (trackInfo?.maxVersionCode != null && local.versionCode <= trackInfo.maxVersionCode) {
      conflicts.push(
        `versionCode lokal (${local.versionCode}) ≤ track "${track}" saat ini (${trackInfo.maxVersionCode}).`,
      );
    }
    if (
      trackInfo?.maxVersionName &&
      local.versionName &&
      compareSemver(local.versionName, trackInfo.maxVersionName) <= 0
    ) {
      // Warning saja — Play tidak menolak versionName duplikat, tapi bikin bingung tester.
      console.log(
        `  ⚠ versionName lokal "${local.versionName}" ≤ track "${track}" ("${trackInfo.maxVersionName}"). ` +
          "Pertimbangkan naikkan versionName juga.",
      );
    }
    if (conflicts.length) {
      // Buang edit yang barusan dipakai untuk probing sebelum keluar.
      await api("DELETE", `/edits/${probeEdit.id}`, { accessToken, packageName }).catch(() => {});
      fail(
        "Konflik versi vs Play Console:\n  • " +
          conflicts.join("\n  • ") +
          "\n\n  Pakai --skip-version-check kalau yakin ingin lanjut (upload biasanya akan 403).",
      );
    }
    console.log(
      `  ✓ versionCode ${local.versionCode} aman: lebih tinggi dari semua versi di Play Console.`,
    );
    // Re-use probe edit untuk step upload berikutnya supaya hemat 1 round-trip.
    global.__probeEditId = probeEdit.id;
  } catch (err) {
    await api("DELETE", `/edits/${probeEdit.id}`, { accessToken, packageName }).catch(() => {});
    throw err;
  }
}

if (dryRun) {
  runSummary.outcome = "dry-run";
  banner("Dry-run selesai — auth & validasi OK, tidak ada perubahan di Play Console");
  process.exit(0);
}

// ─── 6. Insert edit → upload bundle → update track ───────────────────
step(`6/${TOTAL}  Insert edit + upload bundle`);
const editId = global.__probeEditId
  ? { id: global.__probeEditId }
  : await api("POST", `/edits`, { accessToken, packageName });
console.log(`  ✓ editId: ${editId.id}`);

const aabBuf = readFileSync(aabPath);
const upload = await fetch(
  `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${encodeURIComponent(
    packageName,
  )}/edits/${editId.id}/bundles?uploadType=media`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(aabBuf.byteLength),
    },
    body: aabBuf,
  },
);
if (!upload.ok) {
  fail(`Upload bundle gagal (${upload.status}):\n${await upload.text()}`);
}
const uploaded = await upload.json();
const versionCode = uploaded.versionCode;
runSummary.uploaded = { versionCode, sha1: uploaded.sha1 ?? null };
console.log(`  ✓ versionCode di Play: ${versionCode}, SHA1: ${uploaded.sha1?.slice(0, 12)}…`);

step(`7/${TOTAL}  Set track + commit`);
const trackBody = {
  releases: [
    {
      name: releaseName ?? String(versionCode),
      versionCodes: [String(versionCode)],
      status: releaseStatus,
      ...(releaseNotes.length ? { releaseNotes } : {}),
      ...(rollout && releaseStatus === "inProgress"
        ? { userFraction: Number(rollout) }
        : {}),
    },
  ],
};
await api("PUT", `/edits/${editId.id}/tracks/${track}`, {
  accessToken,
  packageName,
  body: trackBody,
});
console.log(`  ✓ track "${track}" diset ke versionCode ${versionCode} (${releaseStatus})`);

await api("POST", `/edits/${editId.id}:commit`, { accessToken, packageName });
runSummary.committed = true;
runSummary.outcome = "success";
console.log("  ✓ edit di-commit");

banner(`Selesai — AAB terkirim ke Play Console track "${track}"`);
console.log(
  "\nBuka Play Console → Testing → " +
    (track === "production" ? "Production" : `${track.charAt(0).toUpperCase()}${track.slice(1)} testing`) +
    " untuk review release.\n",
);
process.exit(0);

// ─── util ─────────────────────────────────────────────────────────────
function loadServiceAccount() {
  const jsonPath = process.env.PLAY_SERVICE_ACCOUNT_JSON;
  const jsonB64 = process.env.PLAY_SERVICE_ACCOUNT_JSON_B64;
  let raw;
  if (jsonPath) {
    const full = resolveHome(jsonPath);
    if (!existsSync(full)) fail(`PLAY_SERVICE_ACCOUNT_JSON path tidak ada: ${full}`);
    raw = readFileSync(full, "utf8");
  } else if (jsonB64) {
    raw = Buffer.from(jsonB64, "base64").toString("utf8");
  } else {
    fail(
      "Set env PLAY_SERVICE_ACCOUNT_JSON (path ke JSON) ATAU\n" +
        "PLAY_SERVICE_ACCOUNT_JSON_B64 (isi JSON di-base64) sebelum jalankan skrip.",
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("Service account JSON tidak valid.");
  }
  for (const f of ["client_email", "private_key", "token_uri"]) {
    if (!parsed[f]) fail(`Service account JSON kurang field: ${f}`);
  }
  return parsed;
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(sa.private_key, "RS256");
  const assertion = await new SignJWT({
    scope: "https://www.googleapis.com/auth/androidpublisher",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience(sa.token_uri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) fail(`Auth Google gagal (${res.status}):\n${await res.text()}`);
  const { access_token } = await res.json();
  if (!access_token) fail("Auth Google: response tidak berisi access_token.");
  return access_token;
}

function readLocalVersion() {
  const v = readAppVersion();
  if (!v) {
    fail(
      "Tidak bisa baca versi lokal dari android/version.properties.\n" +
        "Jalankan: bunx cap add android (sekali) lalu `bun run version:check`.",
    );
  }
  return { versionCode: v.versionCode, versionName: v.versionName ?? null };
}

async function collectPlayVersions(accessToken, packageName, editId) {
  // Ambil semua bundle yang pernah di-upload (batas Play API ~1000 bundle).
  const bundles = await api("GET", `/edits/${editId}/bundles`, { accessToken, packageName });
  const codes = (bundles.bundles ?? [])
    .map((b) => Number(b.versionCode))
    .filter((n) => Number.isFinite(n));
  const maxOverall = codes.length ? Math.max(...codes) : null;

  const tracks = {};
  for (const t of VALID_TRACKS) {
    try {
      const r = await api("GET", `/edits/${editId}/tracks/${t}`, { accessToken, packageName });
      const codes = (r.releases ?? []).flatMap((rel) =>
        (rel.versionCodes ?? []).map((v) => Number(v)),
      );
      const names = (r.releases ?? [])
        .map((rel) => rel.name)
        .filter((n) => typeof n === "string" && n.trim());
      tracks[t] = {
        maxVersionCode: codes.length ? Math.max(...codes) : null,
        maxVersionName: names.length ? names.sort(compareSemver).slice(-1)[0] : null,
        status: r.releases?.[0]?.status ?? null,
      };
    } catch {
      tracks[t] = { maxVersionCode: null, maxVersionName: null, status: null };
    }
  }
  return { maxOverall, tracks };
}

function reportPlaySummary(summary, targetTrack) {
  console.log(
    `  · versionCode tertinggi di Play (semua bundle): ${summary.maxOverall ?? "—"}`,
  );
  for (const t of VALID_TRACKS) {
    const info = summary.tracks[t];
    if (!info) continue;
    const marker = t === targetTrack ? "→" : " ";
    console.log(
      `  ${marker} track ${t.padEnd(10)} vc=${info.maxVersionCode ?? "—"}  vn=${
        info.maxVersionName ?? "—"
      }${info.status ? `  (${info.status})` : ""}`,
    );
  }
}

function compareSemver(a, b) {
  const pa = String(a).split(".").map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(".").map((x) => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

async function api(method, pathSuffix, { accessToken, packageName, body }) {
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
    packageName,
  )}${pathSuffix}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    fail(`Play API ${method} ${pathSuffix} gagal (${res.status}):\n${text}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : {};
}

function resolveHome(p) {
  if (!p) return p;
  if (p.startsWith("~")) return resolve(homedir(), p.slice(2));
  return isAbsolute(p) ? p : resolve(ROOT, p);
}
function banner(msg) {
  const line = "═".repeat(msg.length + 4);
  console.log(`\n${line}\n  ${msg}  \n${line}`);
}
function step(msg) {
  console.log(`\n▶ ${msg}`);
}
function fail(msg) {
  if (runSummary.outcome === "pending") {
    runSummary.outcome = "failed";
    runSummary.error = String(msg).split("\n")[0];
  }
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function writeStepSummary(s) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  try {
    const emoji =
      s.outcome === "success"
        ? "✅"
        : s.outcome === "dry-run"
          ? "🧪"
          : s.outcome === "failed"
            ? "❌"
            : "⏳";
    const outcomeLabel =
      s.outcome === "success"
        ? "Uploaded & committed"
        : s.outcome === "dry-run"
          ? "Dry-run (tidak upload)"
          : s.outcome === "failed"
            ? "GAGAL"
            : "belum selesai";
    const localVc = s.local?.versionCode ?? "—";
    const localVn = s.local?.versionName ?? "—";
    const playMax = s.play?.maxOverall ?? "—";
    const trackInfo = s.play?.tracks?.[s.track];
    const trackVc = trackInfo?.maxVersionCode ?? "—";
    const trackVn = trackInfo?.maxVersionName ?? "—";
    const uploadedVc = s.uploaded?.versionCode ?? "—";
    const sha1 = s.uploaded?.sha1 ? String(s.uploaded.sha1).slice(0, 12) + "…" : "—";

    const rows = [];
    rows.push(`## ${emoji} Play Console upload — ${outcomeLabel}`);
    rows.push("");
    rows.push(`**Package:** \`${s.packageName ?? "—"}\` · **Varian:** \`${s.variant}\``);
    rows.push("");
    rows.push("| Field | Nilai |");
    rows.push("| --- | --- |");
    rows.push(`| Track | \`${s.track}\` |`);
    rows.push(`| Release status | \`${s.releaseStatus}\` |`);
    rows.push(`| Mode | ${s.dryRun ? "🧪 dry-run" : "🚀 upload"}${s.skipVersionCheck ? " · ⚠ skip-version-check" : ""} |`);
    rows.push(`| Committed | ${s.committed ? "yes" : "no"} |`);
    if (s.error) rows.push(`| Error | \`${s.error.replace(/\|/g, "\\|")}\` |`);
    rows.push("");
    rows.push("### Versi lokal vs Play Console");
    rows.push("");
    rows.push("| | versionCode | versionName |");
    rows.push("| --- | ---: | --- |");
    rows.push(`| **Lokal (version.properties)** | \`${localVc}\` | \`${localVn}\` |`);
    rows.push(`| Play — tertinggi (semua bundle) | \`${playMax}\` | — |`);
    rows.push(`| Play — track \`${s.track}\` | \`${trackVc}\` | \`${trackVn}\` |`);
    if (s.uploaded) {
      rows.push(`| **Terupload** | \`${uploadedVc}\` | (SHA1: \`${sha1}\`) |`);
    }
    // Semua track (bila probe berhasil).
    if (s.play?.tracks) {
      rows.push("");
      rows.push("<details><summary>Semua track di Play Console</summary>");
      rows.push("");
      rows.push("| Track | versionCode | versionName | status |");
      rows.push("| --- | ---: | --- | --- |");
      for (const [name, info] of Object.entries(s.play.tracks)) {
        rows.push(
          `| ${name === s.track ? "**" + name + "**" : name} | \`${info?.maxVersionCode ?? "—"}\` | \`${info?.maxVersionName ?? "—"}\` | ${info?.status ?? "—"} |`,
        );
      }
      rows.push("");
      rows.push("</details>");
    }
    rows.push("");
    appendFileSync(path, rows.join("\n") + "\n");
  } catch {
    // Jangan bikin process gagal hanya karena summary tidak bisa ditulis.
  }
}

function writeSummaryJson(s) {
  const out = process.env.UPLOAD_PLAY_SUMMARY_JSON;
  if (!out) return;
  try {
    const full = resolveHome(out);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, JSON.stringify(s, null, 2), "utf8");
  } catch {
    // best-effort — jangan ganggu exit code
  }
}