#!/usr/bin/env node
/**
 * Generator otomatis untuk "Tabel pemetaan skenario APK aktual" di README.md.
 *
 * Sumber kebenaran (SSOT):
 *   - Daftar spec  : `tests/e2e/apk-*.spec.ts` + `copy-chat-apk-*.spec.ts`
 *   - Header project block: `playwright.config.ts` (kolom Skenario / Guards)
 *   - Mode aktual : dideteksi dari isi spec, aturan sama dengan
 *                   `scripts/validate-apk-scaffolds.mjs`:
 *       * `installApkStub` tidak dipakai              → form-only
 *       * `installApkStub` + `installServerFnPassthroughGuard` → full
 *       * `installApkStub` saja                        → terminal
 *
 * Table ditulis di antara marker:
 *   <!-- APK_TABLE:START (generated — jangan edit manual) -->
 *   ...
 *   <!-- APK_TABLE:END -->
 *
 * Flag:
 *   --check  → tidak menulis; exit 1 bila README drift dari hasil generate.
 *              Dipakai di CI / pre-commit agar tabel README tidak pernah
 *              melenceng dari validator.
 *
 * npm:
 *   `bun run e2e:apk:table`        (tulis ulang README)
 *   `bun run e2e:apk:table:check`  (dry-check, exit 1 bila drift)
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SPEC_DIR = path.join(ROOT, "tests/e2e");
const CONFIG = path.join(ROOT, "playwright.config.ts");
const README = path.join(ROOT, "README.md");
const START = "<!-- APK_TABLE:START (generated — jangan edit manual) -->";
const END = "<!-- APK_TABLE:END -->";

const REQUIRED_COLUMNS = ["Skenario", "Harness", "Tujuan", "Guards"];

function detectSpecMode(src) {
  const usesStub = /\binstallApkStub\s*\(/.test(src);
  if (!usesStub) return "form-only";
  return /\binstallServerFnPassthroughGuard\s*\(/.test(src) ? "full" : "terminal";
}

function extractProjectHeader(configText, projectName) {
  const anchor = `name: "${projectName}",`;
  const nameIdx = configText.indexOf(anchor);
  if (nameIdx < 0) return { found: false };
  const blockStart = configText.lastIndexOf("    {", nameIdx);
  if (blockStart < 0) return { found: false };
  const between = configText.slice(blockStart, nameIdx);
  const commentLines = [];
  for (const raw of between.split("\n")) {
    const l = raw.trim();
    if (l.startsWith("//")) commentLines.push(l.replace(/^\/\/\s?/, ""));
  }
  return { found: true, header: commentLines.join("\n") };
}

function splitColumns(header) {
  const cols = {};
  let current = null;
  const colRe = /^([A-Z][a-zA-Z]+)\s*:\s?(.*)$/;
  for (const raw of header.split("\n")) {
    const m = raw.match(colRe);
    if (m && REQUIRED_COLUMNS.includes(m[1])) {
      current = m[1];
      cols[current] = m[2] ?? "";
    } else if (current) {
      cols[current] += (cols[current] ? " " : "") + raw.trim();
    }
  }
  return cols;
}

function escapeCell(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function scenarioAnchor(specFile) {
  // Anchor mengikuti konvensi lama: `apk-scenario-<slug>` di mana `slug`
  // adalah basename spec tanpa akhiran `.spec.ts` dan tanpa prefix
  // `apk-` (karena "apk-scenario-" sudah menandai domain APK).
  const base = specFile.replace(/\.spec\.ts$/, "").replace(/^apk-/, "");
  return `apk-scenario-${base}`;
}
}

function modeLabel(mode) {
  if (mode === "form-only") return "*form-only*";
  if (mode === "terminal") return "`terminalGuard-only`";
  if (mode === "full") return "`terminalGuard + installServerFnPassthroughGuard`";
  return "?";
}

async function collectRows() {
  const entries = await fs.readdir(SPEC_DIR);
  // Ikuti konvensi validator: semua spec `apk-*.spec.ts`; ditambah
  // `copy-chat-apk-*.spec.ts` yang memiliki project block APK.
  // Ikuti persis scope validator (`scripts/validate-apk-scaffolds.mjs`):
  // hanya `apk-*.spec.ts`. Spec lain di luar scope validator tidak
  // dimasukkan ke tabel ini agar sumber kebenaran tetap tunggal.
  const specs = entries
    .filter((f) => f.startsWith("apk-") && f.endsWith(".spec.ts"))
    .sort();
  const configText = await fs.readFile(CONFIG, "utf8");
  const rows = [];
  for (const file of specs) {
    const src = await fs.readFile(path.join(SPEC_DIR, file), "utf8");
    const mode = detectSpecMode(src);
    const projectName = `${file.replace(/\.spec\.ts$/, "")}-e2e`;
    const { found, header } = extractProjectHeader(configText, projectName);
    const cols = found ? splitColumns(header) : {};
    rows.push({
      file,
      mode,
      skenario: cols.Skenario ?? "(header hilang di playwright.config.ts)",
      guards: cols.Guards ?? "(header hilang di playwright.config.ts)",
    });
  }
  return rows;
}

function renderTable(rows) {
  const lines = [
    START,
    "",
    "> Dihasilkan otomatis oleh `bun run e2e:apk:table` dari header project block APK di `playwright.config.ts` + deteksi mode di setiap spec (aturan sama dengan `bun run e2e:apk:validate`). Jangan edit blok ini secara manual — jalankan generator ulang.",
    "",
    "| Spec | Skenario | Mode | Guards checklist (aktual) |",
    "|---|---|---|---|",
  ];
  for (const r of rows) {
    const anchor = `<a id="${scenarioAnchor(r.file)}"></a>`;
    lines.push(
      `| ${anchor}\`${r.file}\` | ${escapeCell(r.skenario)} | ${modeLabel(r.mode)} | ${escapeCell(r.guards)} |`,
    );
  }
  lines.push("", END);
  return lines.join("\n");
}

function replaceBlock(readme, block) {
  const startIdx = readme.indexOf(START);
  const endIdx = readme.indexOf(END);
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) {
    throw new Error(
      `Marker APK_TABLE tidak ditemukan di README.md — pastikan blok\n  ${START}\n  ...\n  ${END}\nsudah ada.`,
    );
  }
  return (
    readme.slice(0, startIdx) + block + readme.slice(endIdx + END.length)
  );
}

async function main() {
  const check = process.argv.includes("--check");
  const rows = await collectRows();
  const block = renderTable(rows);
  const readme = await fs.readFile(README, "utf8");
  const next = replaceBlock(readme, block);

  if (check) {
    if (next !== readme) {
      console.error(
        "✗ README.md drift: tabel pemetaan APK sudah tidak sinkron dengan validator.\n" +
          "  Jalankan: bun run e2e:apk:table",
      );
      process.exit(1);
    }
    console.log("✓ README.md tabel pemetaan APK sinkron dengan validator.");
    return;
  }

  if (next === readme) {
    console.log("✓ README.md sudah up-to-date (tidak ada perubahan).");
    return;
  }
  await fs.writeFile(README, next, "utf8");
  console.log(
    `✓ README.md diperbarui: ${rows.length} baris tabel pemetaan APK.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});