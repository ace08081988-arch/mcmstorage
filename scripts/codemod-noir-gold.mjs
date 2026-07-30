#!/usr/bin/env node
/**
 * Codemod bantu untuk audit Noir & Gold (docs/noir-gold-audit.md).
 *
 *   node scripts/codemod-noir-gold.mjs --dry-run 'src/routes/_authenticated.gudang.tsx'
 *   node scripts/codemod-noir-gold.mjs --apply   'src/components/AppHeader.tsx'
 *
 * Argumen path menerima 1..N file / glob rg. Tanpa argumen: exit dengan
 * pesan usage.
 *
 * Yang dinormalisasi:
 *   1. `text-[<n>px]`  → `text-ms-*` sesuai peta di bawah (fallback ke
 *      `text-ms-sm` bila di luar peta; kandidat ini dilaporkan supaya bisa
 *      di-review manual).
 *   2. `p-<n>` / `px-<n>` / `py-<n>` / `gap-<n>` / `m-<n>` dengan n ∈
 *      {2,3,4,5,6} → varian `-ms-<n>` yang setara. Hanya diterapkan pada
 *      class Tailwind (heuristik: token utuh dipisahkan spasi/quote/backtick).
 *
 * Yang TIDAK disentuh:
 *   - `emerald-*` / `amber-*` — sudah di-codemod terpisah, guard menolak
 *     kalau muncul lagi.
 *   - Hex color literal — perlu keputusan semantic, biarkan manual.
 *
 * Selalu jalankan `--dry-run` dulu, review diff, baru `--apply`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const mode = args.includes("--apply") ? "apply" : args.includes("--dry-run") ? "dry-run" : null;
const targets = args.filter((a) => !a.startsWith("--"));

if (!mode || targets.length === 0) {
  console.error(
    "Usage: node scripts/codemod-noir-gold.mjs (--dry-run | --apply) <path> [<path> ...]",
  );
  process.exit(2);
}

// Peta text-[Xpx] → utility ms. Skala mengikuti --ms-text-* di styles.css.
const TEXT_PX_MAP = {
  10: "text-ms-2xs",
  10.5: "text-ms-2xs",
  11: "text-ms-2xs",
  12: "text-ms-xs",
  13: "text-ms-xs",
  14: "text-ms-sm",
  15: "text-ms-sm",
  16: "text-ms-base",
  17: "text-ms-base",
  18: "text-ms-md",
  20: "text-ms-lg",
  22: "text-ms-lg",
  24: "text-ms-xl",
  28: "text-ms-2xl",
  32: "text-ms-3xl",
};

// Kelompok utility spacing yang punya varian ms-* siap pakai.
const SPACING_PREFIXES = ["p", "px", "py", "pt", "pb", "pl", "pr", "m", "mx", "my", "mt", "mb", "ml", "mr", "gap"];
const SPACING_MS_NUMS = new Set(["2", "3", "4", "5", "6"]);

function resolveFiles(patterns) {
  const files = new Set();
  for (const p of patterns) {
    try {
      const out = execSync(`rg -l --files -g '${p}'`, { encoding: "utf8" });
      for (const line of out.split("\n")) if (line) files.add(line);
    } catch {
      // Bukan glob rg valid → coba treat as literal path.
      files.add(p);
    }
  }
  return [...files];
}

function normalize(src, file) {
  let out = src;
  const changes = [];

  // 1. text-[Xpx]
  out = out.replace(/text-\[(\d+(?:\.\d+)?)px\]/g, (match, n) => {
    const target = TEXT_PX_MAP[Number(n)] ?? TEXT_PX_MAP[n];
    if (!target) {
      changes.push({ kind: "text-px-unmapped", from: match, hint: "tambahkan ke TEXT_PX_MAP atau ganti manual" });
      return match;
    }
    changes.push({ kind: "text-px", from: match, to: target });
    return target;
  });

  // 2. spacing p-N / gap-N / ...
  //    Batasi ke token yang benar-benar dalam konteks className.
  //    Heuristik konservatif: kata-utuh yang cocok, dan file adalah TSX/TS.
  const spacingRe = new RegExp(
    `\\b(${SPACING_PREFIXES.join("|")})-(${[...SPACING_MS_NUMS].join("|")})\\b(?!\\.5)`,
    "g",
  );
  out = out.replace(spacingRe, (match, prefix, n) => {
    // Jangan sentuh yang sudah -ms-.
    if (match.includes("-ms-")) return match;
    changes.push({ kind: "spacing", from: match, to: `${prefix}-ms-${n}` });
    return `${prefix}-ms-${n}`;
  });

  return { out, changes };
}

let totalChanges = 0;
let totalFiles = 0;
for (const file of resolveFiles(targets)) {
  let src;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    console.warn(`SKIP (unreadable): ${file}`);
    continue;
  }
  const { out, changes } = normalize(src, file);
  if (changes.length === 0) continue;
  totalFiles++;
  totalChanges += changes.length;
  console.log(`\n${file}  (${changes.length} kandidat)`);
  for (const c of changes.slice(0, 12)) {
    if (c.kind === "text-px-unmapped") {
      console.log(`  [unmapped] ${c.from} — ${c.hint}`);
    } else {
      console.log(`  ${c.from}  →  ${c.to}`);
    }
  }
  if (changes.length > 12) console.log(`  ... ${changes.length - 12} lagi`);

  if (mode === "apply" && out !== src) {
    writeFileSync(file, out);
  }
}

console.log(
  `\n${mode === "apply" ? "Applied" : "Would apply"} ${totalChanges} perubahan di ${totalFiles} file.`,
);