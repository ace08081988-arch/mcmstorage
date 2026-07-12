#!/usr/bin/env node
/**
 * Upload AAB ke Google Play Console via Play Developer API v3.
 * Zero deps eksternal — pakai `jose` (sudah ada di package.json) untuk
 * signing JWT service-account + fetch bawaan Node 20.
 *
 * Pemakaian:
 *   node scripts/upload-play.mjs                        # varian full, track internal
 *   node scripts/upload-play.mjs --variant chat
 *   node scripts/upload-play.mjs --track production --release-status draft
 *   node scripts/upload-play.mjs --aab path/ke.aab
 *   node scripts/upload-play.mjs --package biz.mcmstorage.app
 *
 * Flag:
 *   --track            internal (default) | alpha | beta | production
 *   --release-status   draft (default) | inProgress | halted | completed
 *   --release-name     Nama release (default: versionCode dari AAB)
 *   --rollout          Fraksi rollout 0..1 untuk track production
 *                      (dipakai hanya kalau --release-status inProgress)
 *   --notes id=path.txt,en-US=path.txt   Release notes per locale
 *   --dry-run          Auth + validasi saja, tanpa insert edit
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
import { resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";
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
const variant = flag("--variant", "full");
if (!["full", "chat"].includes(variant)) fail(`Varian tidak dikenal: ${variant}`);
const track = flag("--track", "internal");
const releaseStatus = flag("--release-status", "draft");
const releaseName = flag("--release-name");
const rollout = flag("--rollout");
const notesArg = flag("--notes");
const dryRun = args.has("--dry-run");
const aabOverride = flag("--aab");
const packageOverride = flag("--package");

const VALID_TRACKS = ["internal", "alpha", "beta", "production"];
if (!VALID_TRACKS.includes(track)) fail(`--track harus salah satu: ${VALID_TRACKS.join(", ")}`);
const VALID_STATUS = ["draft", "inProgress", "halted", "completed"];
if (!VALID_STATUS.includes(releaseStatus))
  fail(`--release-status harus salah satu: ${VALID_STATUS.join(", ")}`);

banner(`Upload AAB ke Play Console · varian ${variant.toUpperCase()} · track ${track}`);

// ─── 1. Load service account ──────────────────────────────────────────
step("1/6  Load service account");
const sa = loadServiceAccount();
console.log(`  ✓ client_email: ${sa.client_email}`);

// ─── 2. Tentukan package name & AAB ───────────────────────────────────
step("2/6  Cari AAB & tentukan packageName");
const packageName =
  packageOverride ?? (variant === "chat" ? "biz.mcmstorage.chat" : "biz.mcmstorage.app");
console.log(`  ✓ packageName: ${packageName}`);

const aabPath = aabOverride
  ? resolveHome(aabOverride)
  : resolve(ROOT, "android/app/build/outputs/bundle/release/app-release.aab");
if (!existsSync(aabPath)) {
  fail(
    `AAB tidak ditemukan: ${aabPath}\n` +
      "Build dulu: bun run aab:build (atau aab:build:chat). Lalu ulangi.",
  );
}
const aabSize = statSync(aabPath).size;
console.log(`  ✓ ${aabPath} (${(aabSize / 1024 / 1024).toFixed(1)} MB)`);

// ─── 3. Baca release notes (opsional) ─────────────────────────────────
step("3/6  Baca release notes");
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
step("4/6  Auth ke Google (JWT bearer flow)");
const accessToken = await getAccessToken(sa);
console.log("  ✓ access_token diperoleh");

if (dryRun) {
  banner("Dry-run selesai — auth & validasi OK, tidak ada perubahan di Play Console");
  process.exit(0);
}

// ─── 5. Insert edit → upload bundle → update track ───────────────────
step("5/6  Insert edit + upload bundle");
const editId = await api("POST", `/edits`, { accessToken, packageName });
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
console.log(`  ✓ versionCode di Play: ${versionCode}, SHA1: ${uploaded.sha1?.slice(0, 12)}…`);

step("6/6  Set track + commit");
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
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}