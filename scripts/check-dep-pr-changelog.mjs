#!/usr/bin/env node
/**
 * Gate merge: validasi bahwa komentar changelog PR dependency mengikuti
 * template wajib sebelum boleh di-merge.
 *
 * Aturan template:
 *  1. Judul `## 📦 Ringkasan update dependency`.
 *  2. Tabel versi `| Paket | Perubahan | Info |` + separator, minimal satu baris,
 *     dan tiap baris memuat transisi versi (`lama` → `baru`) atau penanda
 *     `baru`/`dihapus`. Boleh diganti kalimat eksplisit "Tidak ada perubahan
 *     versi di `package.json`" saat PR hanya menyentuh lockfile.
 *  3. Bagian advisory (`🛡️ Security fix`, `⚠️ Advisory baru muncul`): tiap butir
 *     wajib punya badge severity (critical/high/moderate/low/info) DAN link
 *     advisory (http/https). Bagian security fix wajib ada — minimal versi
 *     "tidak ada advisory yang hilang".
 *  4. Baris gate merge (`audit:deps:ci` + `audit:router-versions`).
 *
 * Pemakaian:
 *   node scripts/check-dep-pr-changelog.mjs dep-changelog.md
 *   cat body.md | node scripts/check-dep-pr-changelog.mjs -
 *   ... --json    (output mesin)
 */
import { readFileSync, existsSync, appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const file = args.find((a) => !a.startsWith("--")) ?? "dep-changelog.md";

function readInput() {
  if (file === "-") return readFileSync(0, "utf8");
  if (!existsSync(file)) {
    fail([`Berkas changelog \`${file}\` tidak ditemukan. Jalankan \`node scripts/dep-pr-changelog.mjs --out ${file}\` lebih dulu.`]);
  }
  return readFileSync(file, "utf8");
}

const SEVERITIES = ["critical", "high", "moderate", "medium", "low", "info"];
const SEVERITY_RE = new RegExp(`\\*\\*[^*]*\\b(${SEVERITIES.join("|")})\\b[^*]*\\*\\*`, "i");
const LINK_RE = /\((https?:\/\/[^\s)]+)\)/;
const ARROW_RE = /`[^`]+`\s*(?:→|->)\s*`[^`]+`/;

const errors = [];
const warnings = [];

function fail(list) {
  const payload = { ok: false, errors: list, warnings };
  if (JSON_OUT) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.error("❌ Format changelog PR dependency tidak sesuai template:\n");
    for (const e of list) console.error(`  • ${e}`);
    console.error("\nPerbaiki dengan menjalankan ulang `node scripts/dep-pr-changelog.mjs` (jangan edit komentar manual).");
  }
  summarize(payload);
  process.exit(1);
}

function summarize(payload) {
  if (!process.env["GITHUB_STEP_SUMMARY"]) return;
  const lines = payload.ok
    ? ["## ✅ Format changelog dependency valid", ""]
    : ["## ❌ Format changelog dependency tidak valid", "", ...payload.errors.map((e) => `- ${e}`), ""];
  try {
    appendFileSync(process.env["GITHUB_STEP_SUMMARY"], lines.join("\n") + "\n");
  } catch {
    /* summary opsional */
  }
}

const md = readInput();
const lines = md.split("\n");

// 1. Judul wajib.
if (!/^## 📦 Ringkasan update dependency\s*$/m.test(md)) {
  errors.push("Judul `## 📦 Ringkasan update dependency` tidak ditemukan.");
}

// 2. Tabel versi.
const headerIdx = lines.findIndex((l) => /^\|\s*Paket\s*\|\s*Perubahan\s*\|\s*Info\s*\|$/.test(l.trim()));
const lockfileOnly = /Tidak ada perubahan versi di `package\.json`/.test(md);

if (headerIdx === -1) {
  if (!lockfileOnly) {
    errors.push(
      "Tabel versi wajib ada dengan header `| Paket | Perubahan | Info |`, atau kalimat eksplisit \"Tidak ada perubahan versi di `package.json`\" bila PR hanya mengubah lockfile.",
    );
  }
} else {
  const sep = (lines[headerIdx + 1] ?? "").trim();
  if (!/^\|(\s*:?-{3,}:?\s*\|){3}$/.test(sep)) {
    errors.push("Baris pemisah tabel versi (`| --- | --- | --- |`) hilang atau kolomnya tidak berjumlah tiga.");
  }
  const rows = [];
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const row = lines[i].trim();
    if (!row.startsWith("|")) break;
    rows.push({ row, line: i + 1 });
  }
  if (rows.length === 0) {
    errors.push("Tabel versi kosong — minimal satu baris paket harus tercantum.");
  }
  for (const { row, line } of rows) {
    const cells = row.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length !== 3) {
      errors.push(`Baris ${line}: tabel versi harus punya 3 kolom (Paket | Perubahan | Info).`);
      continue;
    }
    const [pkg, change] = cells;
    if (!pkg) errors.push(`Baris ${line}: kolom Paket kosong.`);
    const hasTransition = ARROW_RE.test(change) || /^baru\s+`[^`]+`$/.test(change) || /^dihapus\s+\(`[^`]+`\)$/.test(change);
    if (!hasTransition) {
      errors.push(
        `Baris ${line}: kolom Perubahan harus memuat versi lama → baru (mis. \`1.0.0\` → \`1.1.0\`), atau penanda \`baru\`/\`dihapus\`. Ditemukan: "${change}".`,
      );
    }
  }
}

// 3. Bagian advisory.
function sectionBullets(headingRe) {
  const start = lines.findIndex((l) => headingRe.test(l.trim()));
  if (start === -1) return null;
  const bullets = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^#{2,3}\s/.test(l) || l === "---") break;
    if (l.startsWith("- ")) bullets.push({ text: l, line: i + 1 });
  }
  return { start, bullets };
}

const fixedSection = sectionBullets(/^### 🛡️ Security fix( \(\d+\))?$/);
const introducedSection = sectionBullets(/^### ⚠️ Advisory baru muncul \(\d+\)$/);

if (!fixedSection) {
  errors.push(
    "Bagian `### 🛡️ Security fix` wajib ada (boleh berisi keterangan bahwa tidak ada advisory yang tertutup PR ini).",
  );
} else if (fixedSection.bullets.length === 0) {
  const body = lines.slice(fixedSection.start + 1, fixedSection.start + 5).join(" ");
  if (!/Tidak ada advisory/i.test(body)) {
    errors.push(
      "Bagian `### 🛡️ Security fix` kosong tanpa daftar advisory maupun keterangan \"Tidak ada advisory ...\".",
    );
  }
}

for (const [label, section] of [
  ["🛡️ Security fix", fixedSection],
  ["⚠️ Advisory baru muncul", introducedSection],
]) {
  if (!section) continue;
  for (const { text, line } of section.bullets) {
    if (!SEVERITY_RE.test(text)) {
      errors.push(`Baris ${line} (${label}): butir advisory wajib menyebut severity (${SEVERITIES.join("/")}) dalam **tebal**.`);
    }
    if (!LINK_RE.test(text)) {
      errors.push(`Baris ${line} (${label}): butir advisory wajib menyertakan link advisory (http/https).`);
    }
  }
}

// 4. Gate merge.
if (!/audit:deps:ci/.test(md) || !/audit:router-versions/.test(md)) {
  errors.push("Baris gate merge wajib menyebut `bun run audit:deps:ci` dan `bun run audit:router-versions`.");
}

if (errors.length) fail(errors);

const payload = { ok: true, errors: [], warnings };
if (JSON_OUT) console.log(JSON.stringify(payload, null, 2));
else console.log("✅ Format changelog PR dependency sesuai template.");
summarize(payload);
