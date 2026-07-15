#!/usr/bin/env node
/**
 * CI guard untuk kontrak audit Noir & Gold (lihat docs/noir-gold-audit.md).
 *
 * Menolak PR yang re-introduce:
 *  1. `emerald-<digit>` / `amber-<digit>` di src/ (di luar snapshot).
 *  2. `text-[<digit>px]` di JSX di luar allowlist textPxAllow.
 *  3. Hex color literal (`#RRGGBB` / `#RGB`) di file .tsx/.ts di luar
 *     allowlist hexColorAllow — kecuali kalau muncul di komentar atau di
 *     file *.snap.
 *
 * Pola opt-out inline: `// noir-gold-allow: <alasan>` pada baris yang sama
 * mem-ekspresi keterlibatan yang disengaja (harness demo, dsb.).
 *
 * Jalankan lokal: `node scripts/check-noir-gold.mjs`
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const ALLOWLIST_PATH = resolve(REPO_ROOT, "src/lib/noir-gold-allowlist.json");

function loadAllowlist() {
  const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  const validate = (list, key) => {
    if (!Array.isArray(list)) throw new Error(`${key} harus array`);
    for (const entry of list) {
      if (!entry?.path || typeof entry.path !== "string") {
        throw new Error(`${key}: entry tanpa 'path' string`);
      }
      if (
        !entry?.reason ||
        typeof entry.reason !== "string" ||
        entry.reason.trim().length < 20
      ) {
        throw new Error(
          `${key}: entry '${entry.path}' butuh 'reason' >= 20 karakter`,
        );
      }
    }
    return list.map((e) => e.path);
  };
  return {
    textPxAllow: validate(raw.textPxAllow ?? [], "textPxAllow"),
    hexColorAllow: validate(raw.hexColorAllow ?? [], "hexColorAllow"),
  };
}

const ALLOW = loadAllowlist();

function isAllowed(list, filePath) {
  return list.some((allowed) => filePath === allowed || filePath.startsWith(allowed));
}

function inlineAllow(line) {
  return /\bnoir-gold-allow:/.test(line);
}

const violations = [];

function scan(pattern, { skip = () => false, label } = {}) {
  let out = "";
  try {
    out = execSync(`rg -n --no-heading --glob '!*.snap' ${pattern} src`, {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });
  } catch (err) {
    // rg exits 1 when no matches — success for us.
    if (err.status === 1) return;
    throw err;
  }
  for (const raw of out.split("\n")) {
    if (!raw) continue;
    const m = raw.match(/^([^:]+):(\d+):(.*)$/);
    if (!m) continue;
    const [, file, lineNo, content] = m;
    if (skip(file, content)) continue;
    if (inlineAllow(content)) continue;
    violations.push({ label, file, line: Number(lineNo), content: content.trim() });
  }
}

// 1. emerald-*/amber-*
scan(`"\\b(emerald|amber)-[0-9]+\\b"`, {
  label: "emerald/amber",
});

// 2. text-[Xpx] di JSX/TS
scan(`"text-\\[[0-9]+(\\.[0-9]+)?px\\]"`, {
  label: "text-[Xpx]",
  skip: (file) => isAllowed(ALLOW.textPxAllow, file),
});

// 3. Hex color literal di .ts/.tsx (bukan komentar heuristik: skip baris
//    yang isinya adalah komentar `//` atau di dalam `/* ... */` satu-baris).
scan(`--glob '*.ts' --glob '*.tsx' "#[0-9a-fA-F]{6}\\b|#[0-9a-fA-F]{3}\\b"`, {
  label: "hex color",
  skip: (file, content) => {
    if (isAllowed(ALLOW.hexColorAllow, file)) return true;
    // Skip komentar single-line dan blok komentar sederhana.
    const trimmed = content.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return true;
    // Skip string yang jelas bukan color literal (mis. URL hash, koordinat SVG).
    // Heuristik: kalau tidak ada substring 'color', 'bg', 'fill', 'stroke',
    // 'border', 'shadow', 'ring', 'gradient', 'linear-', 'radial-' — anggap
    // bukan color literal.
    if (!/color|bg|fill|stroke|border|shadow|ring|gradient|linear-|radial-|hsl|rgb|oklch|palette|swatch|hex|theme|--/i.test(content)) {
      return true;
    }
    return false;
  },
});

if (violations.length === 0) {
  console.log("noir-gold guard OK — tidak ada pelanggaran.");
  process.exit(0);
}

const grouped = new Map();
for (const v of violations) {
  const key = v.label;
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(v);
}

console.error("noir-gold guard FAILED — pelanggaran ditemukan:\n");
for (const [label, rows] of grouped) {
  console.error(`# ${label} (${rows.length}):`);
  for (const r of rows.slice(0, 20)) {
    console.error(`  ${r.file}:${r.line}  ${r.content}`);
  }
  if (rows.length > 20) {
    console.error(`  ... ${rows.length - 20} baris lagi`);
  }
  console.error("");
}
console.error(
  "Perbaiki dengan:\n" +
    "  - Ganti emerald-*/amber-* → success/warning (lihat docs/noir-gold-audit.md).\n" +
    "  - Ganti text-[Xpx] → text-ms-* atau tambahkan file ke textPxAllow (src/lib/noir-gold-allowlist.json).\n" +
    "  - Ganti hex color literal → token semantic; kalau memang perlu (harness), tambahkan prefix path ke hexColorAllow.\n" +
    "  - Untuk pengecualian per-baris: tambah komentar '// noir-gold-allow: <alasan>' di baris itu.\n",
);
process.exit(1);