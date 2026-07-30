#!/usr/bin/env node
/**
 * CI enforcer untuk Rules of Hooks di seluruh `src/`.
 *
 * Latar belakang: halaman Gudang pernah stuck di skeleton karena `StokTab`
 * memanggil hook di bawah early-return (urutan hook berubah antar render →
 * React melempar dan boundary menangkapnya sebagai layar kosong). Gejalanya
 * di Android WebView cuma "halaman putih", jadi tanpa gerbang CI jenis bug
 * ini gampang lolos: `vite build` dan typecheck tetap hijau.
 *
 * Script ini hanya melaporkan pelanggaran `react-hooks/*` (rules-of-hooks
 * dan turunannya) supaya tidak ikut gagal karena warning gaya lain, dan
 * mengembalikan exit 1 begitu ada satu pelanggaran.
 */
import { ESLint } from "eslint";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.resolve(__dirname, "..");

const eslint = new ESLint({
  cwd,
  overrideConfigFile: path.resolve(cwd, "eslint.config.js"),
  errorOnUnmatchedPattern: false,
  // Naikkan rules-of-hooks ke error di semua file (bukan hanya gudang).
  overrideConfig: [{ rules: { "react-hooks/rules-of-hooks": "error" } }],
});

const results = await eslint.lintFiles(["src/**/*.{ts,tsx}"]);

const violations = [];
for (const r of results) {
  for (const m of r.messages) {
    if (!m.ruleId || !m.ruleId.startsWith("react-hooks/")) continue;
    // `exhaustive-deps` sengaja tetap warning global (hanya error di
    // gudang, lihat eslint.config.js) — gerbang ini soal urutan hook.
    if (m.ruleId === "react-hooks/exhaustive-deps") continue;
    violations.push({
      file: path.relative(cwd, r.filePath),
      line: m.line,
      col: m.column,
      rule: m.ruleId,
      msg: (m.message || "").split("\n")[0],
    });
  }
}

if (violations.length === 0) {
  console.log(`✓ Rules of Hooks bersih — ${results.length} file diperiksa.`);
  process.exit(0);
}

const byFile = new Map();
for (const v of violations) {
  if (!byFile.has(v.file)) byFile.set(v.file, []);
  byFile.get(v.file).push(v);
}

console.error(
  `✗ Rules of Hooks gagal: ${violations.length} pelanggaran di ${byFile.size} file.\n`,
);
for (const [file, list] of byFile) {
  console.error(`  ${file}  (${list.length})`);
  for (const v of list) {
    console.error(`    ${v.line}:${v.col}  ${v.rule}  ${v.msg}`);
  }
}
console.error(
  "\nHook harus dipanggil tanpa syarat di puncak komponen — pindahkan early-return\n" +
    "ke bawah semua pemanggilan hook, atau pecah jadi komponen anak.",
);
process.exit(1);
