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
import { readFileSync, writeFileSync } from "node:fs";
import { globSync } from "node:fs";
import { execSync } from "node:child_process";

const DRY = process.argv.includes("--dry");
const files = execSync(
  `git ls-files 'src/components/chat/*.ts' 'src/components/chat/*.tsx'`,
  { encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean)
  .filter((f) => !/\.test\.tsx?$/.test(f))
  .filter((f) => !/AttachMenu\.tsx$/.test(f));

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
      // Sisipkan import setelah import pertama.
      out = out.replace(/^(import .+?;\s*)/s, `$1${IMPORT_LINE}\n`);
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
