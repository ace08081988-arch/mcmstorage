#!/usr/bin/env bun
/**
 * Codemod: ganti formatter mm:ss ad-hoc di src/components/chat/** dengan
 * `formatDurationMMSS` dari `@/lib/format-duration`.
 *
 * Menangani pola yang paling umum (regex, konservatif):
 *   1. `${Math.floor(<X>/60)}:${(<X>%60).toString().padStart(2,"0")}`
 *   2. `${Math.floor(<X>/60).toString().padStart(2,"0")}:${(<X>%60).toString().padStart(2,"0")}`
 *   3. Deklarasi lokal:
 *        const m = Math.floor(<X> / 60);
 *        const s = <X> % 60;
 *        `${m}:${String(s).padStart(2, "0")}`  → `${formatDurationMMSS(<X>)}`
 *
 * Pola lain akan dilaporkan sebagai "manual" — perbaiki tangan lalu jalankan
 * ulang lint. Import `formatDurationMMSS` disisipkan bila belum ada.
 *
 * Pakai:  bun run codemod:mmss              # tulis perubahan
 *         bun run codemod:mmss --dry        # tampilkan diff, tidak menulis
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const DRY = process.argv.includes("--dry");
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== "AttachMenu.tsx") {
      out.push(p);
    }
  }
  return out;
}
const files = walk("src/components/chat");

const IMPORT_LINE = `import { formatDurationMMSS } from "@/lib/format-duration";`;

// Pola 1 + 2 (template literal in-place). Grup 1 = expr X.
const TEMPLATE_INLINE = new RegExp(
  String.raw`\$\{\s*Math\.floor\(\s*([^)]+?)\s*\/\s*60\s*\)(?:\.toString\(\)\.padStart\(\s*2\s*,\s*["']0["']\s*\))?\s*\}\s*:\s*\$\{\s*\(\s*\1\s*%\s*60\s*\)\.toString\(\)\.padStart\(\s*2\s*,\s*["']0["']\s*\)\s*\}`,
  "g",
);

let changed = 0;
let manual = 0;

for (const file of files) {
  const src = readFileSync(file, "utf8");
  let out = src;

  out = out.replace(TEMPLATE_INLINE, (_m, expr) => `\${formatDurationMMSS(${expr.trim()})}`);

  if (out !== src) {
    if (!out.includes("format-duration")) {
      // Sisipkan import setelah import pertama; bila tidak ada, prepend.
      if (/^import\s.+?;/m.test(out)) {
        out = out.replace(/^(import\s.+?;\s*)/, `$1${IMPORT_LINE}\n`);
      } else {
        out = `${IMPORT_LINE}\n${out}`;
      }
    }
    changed++;
    if (DRY) {
      console.log(`--- ${file} (dry)`);
    } else {
      writeFileSync(file, out);
      console.log(`✔ ${file}`);
    }
  } else if (/Math\.floor\([^)]+\/\s*60\)|%\s*60|padStart\(\s*2\s*,\s*["']0["']\s*\)/.test(src)) {
    // Pola tidak dikenali secara konservatif — laporkan supaya diperbaiki manual.
    manual++;
    console.log(`⚠ ${file}: pola mm:ss ad-hoc terdeteksi tapi tidak match auto-fix. Perbaiki manual → formatDurationMMSS(sec).`);
  }
}

console.log(`\nSelesai. Auto-fix: ${changed} file. Manual: ${manual} file.`);
if (manual > 0) process.exitCode = 1;
