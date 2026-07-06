#!/usr/bin/env bun
/**
 * Codemod: ganti predikat literal `sold_at` di komponen/route/lib dengan
 * helper SSOT dari `@/lib/prep-active-selector`.
 *
 * Konversi konservatif (hanya pola yang aman ditulis ulang):
 *   1. `!!<ident>.sold_at`                → `isSentPrep(<ident>)`
 *   2. `!<ident>.sold_at`                 → `isActivePrep(<ident>)`
 *   3. `<ident>.sold_at === null`         → `isActivePrep(<ident>)`
 *   4. `<ident>.sold_at !== null`         → `isSentPrep(<ident>)`
 *   5. `<ident>.sold_at == null`          → `isActivePrep(<ident>)`
 *   6. `<ident>.sold_at != null`          → `isSentPrep(<ident>)`
 *   7. `.is("sold_at", null)`             → `.is` dihapus dari chain, panggilan
 *      di-wrap `withActivePrepsFilter(...)` (perbaikan otomatis DILEWATI —
 *      cukup dilaporkan; refactor chain builder aman hanya lewat tangan).
 *
 * Pola yang tidak dikenali dilaporkan sebagai "manual". Import helper
 * disisipkan otomatis bila belum ada.
 *
 * Pakai:
 *   bun run codemod:sold-at            # tulis perubahan
 *   bun run codemod:sold-at --dry      # tampilkan file terdampak saja
 *
 * File yang dilewati (sesuai `ignores` ESLint):
 *   - src/lib/prep-active-selector.ts  (definisi resmi)
 *   - src/lib/prep-readonly-guard.ts   (baca sold_at untuk formatting)
 *   - test files (*.test.ts / *.test.tsx) dan folder __tests__
 *   - src/routeTree.gen.ts, src/integrations/supabase/types.ts
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const DRY = process.argv.includes("--dry");

const ROOTS = ["src/components", "src/routes", "src/lib"];
const SKIP_FILES = new Set([
  "src/lib/prep-active-selector.ts",
  "src/lib/prep-readonly-guard.ts",
  "src/routeTree.gen.ts",
  "src/integrations/supabase/types.ts",
]);

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "__tests__") continue;
      out.push(...walk(p));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      const norm = p.replace(/\\/g, "/");
      if (SKIP_FILES.has(norm)) continue;
      out.push(norm);
    }
  }
  return out;
}

// Identifier yang aman diganti (huruf/angka/_/$, chain `.` diperbolehkan).
// Contoh yang match: `p`, `prep`, `p.foo`, `items[i]` TIDAK match (index expr).
const ID = String.raw`[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*`;

const PATTERNS = [
  // `!!<id>.sold_at`  (harus dicek dulu sebelum `!<id>.sold_at`)
  {
    re: new RegExp(String.raw`!!(${ID})\.sold_at\b`, "g"),
    helper: "isSentPrep",
    replace: (_m, id) => `isSentPrep(${id})`,
  },
  // `!<id>.sold_at`
  {
    re: new RegExp(String.raw`(?<![!])!(${ID})\.sold_at\b`, "g"),
    helper: "isActivePrep",
    replace: (_m, id) => `isActivePrep(${id})`,
  },
  // `<id>.sold_at === null`, `== null`
  {
    re: new RegExp(String.raw`(${ID})\.sold_at\s*={2,3}\s*null\b`, "g"),
    helper: "isActivePrep",
    replace: (_m, id) => `isActivePrep(${id})`,
  },
  // `<id>.sold_at !== null`, `!= null`
  {
    re: new RegExp(String.raw`(${ID})\.sold_at\s*!={1,2}\s*null\b`, "g"),
    helper: "isSentPrep",
    replace: (_m, id) => `isSentPrep(${id})`,
  },
];

const IMPORT_PATH = `@/lib/prep-active-selector`;

function ensureImport(src, helpers) {
  // Sudah punya import dari path?
  const importRe = new RegExp(
    String.raw`import\s*\{([^}]*)\}\s*from\s*["']${IMPORT_PATH}["'];?`,
  );
  const m = src.match(importRe);
  if (m) {
    const existing = new Set(
      m[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    for (const h of helpers) existing.add(h);
    const merged = Array.from(existing).sort().join(", ");
    return src.replace(importRe, `import { ${merged} } from "${IMPORT_PATH}";`);
  }
  const line = `import { ${Array.from(helpers).sort().join(", ")} } from "${IMPORT_PATH}";`;
  if (/^import\s.+?;\s*$/m.test(src)) {
    return src.replace(/^(import\s.+?;\s*)/, `$1${line}\n`);
  }
  return `${line}\n${src}`;
}

let changedCount = 0;
let manualCount = 0;
const files = ROOTS.flatMap((r) => walk(r));

for (const file of files) {
  const src = readFileSync(file, "utf8");
  let out = src;
  const needed = new Set();

  for (const { re, helper, replace } of PATTERNS) {
    out = out.replace(re, (...args) => {
      needed.add(helper);
      return replace(...args);
    });
  }

  if (out !== src) {
    out = ensureImport(out, needed);
    changedCount++;
    if (DRY) {
      console.log(`— ${file} (dry) · +${Array.from(needed).join(", ")}`);
    } else {
      writeFileSync(file, out);
      console.log(`✔ ${file} · +${Array.from(needed).join(", ")}`);
    }
  }

  // Pelaporan manual: pola `.is("sold_at", null)` — refactor chain
  // builder tidak aman diotomasi (butuh membungkus builder dengan
  // `withActivePrepsFilter(...)`).
  if (/\.is\(\s*["']sold_at["']\s*,\s*null\s*\)/.test(src)) {
    manualCount++;
    console.log(
      `⚠ ${file}: \`.is("sold_at", null)\` terdeteksi — bungkus builder dengan withActivePrepsFilter(...) secara manual.`,
    );
  }
}

console.log(
  `\nSelesai. Auto-fix: ${changedCount} file. Manual: ${manualCount} file.`,
);
if (manualCount > 0) process.exitCode = 1;