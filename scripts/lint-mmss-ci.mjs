#!/usr/bin/env node
// CI enforcer untuk aturan mm:ss di src/components/chat/**.
// - Mode wajib: fail bila ada warning atau error (--max-warnings=0).
// - Laporan ringkas: hanya baris `path:line:col  ruleId  message-singkat`.
// Exit 1 kalau ada pelanggaran, 0 kalau bersih.
import { ESLint } from "eslint";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.resolve(__dirname, "..");

const eslint = new ESLint({
  cwd,
  overrideConfigFile: path.resolve(cwd, "eslint.config.js"),
  errorOnUnmatchedPattern: false,
});

const results = await eslint.lintFiles(["src/components/chat/**/*.{ts,tsx}"]);

const violations = [];
for (const r of results) {
  for (const m of r.messages) {
    if (m.ruleId !== "no-restricted-syntax") continue;
    violations.push({
      file: path.relative(cwd, r.filePath),
      line: m.line,
      col: m.column,
      severity: m.severity, // 1=warn, 2=error
      rule: m.ruleId,
      // Ambil baris pertama pesan (pola: `[mm:ss] ...`) supaya ringkas.
      msg: (m.message || "").split("\n")[0],
    });
  }
}

if (violations.length === 0) {
  console.log("✓ mm:ss lint bersih — semua komponen chat memakai formatDurationMMSS.");
  process.exit(0);
}

// Header + ringkasan per file.
const byFile = new Map();
for (const v of violations) {
  if (!byFile.has(v.file)) byFile.set(v.file, []);
  byFile.get(v.file).push(v);
}

console.error(`✗ mm:ss lint gagal: ${violations.length} pelanggaran di ${byFile.size} file.\n`);
for (const [file, list] of byFile) {
  console.error(`  ${file}  (${list.length})`);
  for (const v of list) {
    const sev = v.severity === 2 ? "error" : "warn";
    console.error(`    ${v.line}:${v.col}  ${sev}  ${v.msg}`);
  }
}
console.error(
  `\nPerbaiki dengan: bun run codemod:mmss  (atau tambahkan file ke eslint.mmss-allowlist.json dengan reason).`,
);
process.exit(1);
