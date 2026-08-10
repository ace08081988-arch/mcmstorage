#!/usr/bin/env node
/**
 * Validator otomatis untuk header project block APK di
 * `playwright.config.ts` + kecocokan checklist Guards vs mode aktual
 * spec (`terminal` / `full` / `form-only`).
 *
 * Aturan yang divalidasi PER spec `tests/e2e/apk-*.spec.ts`:
 *
 *   1. Blok project dengan `name: "<flow>-e2e"` ada di playwright.config.ts.
 *   2. Komentar header di atas `name:` memuat KEEMPAT kolom:
 *        // Skenario :
 *        // Harness  :
 *        // Tujuan   :
 *        // Guards   :
 *   3. Setiap kolom terisi (tidak boleh mengandung placeholder
 *      "TODO —" / "TODO(scaffold)").
 *   4. Guards checklist konsisten dengan mode spec:
 *        - form-only  (spec tidak memakai installApkStub)
 *              → Guards eksplisit menyebut "tidak memakai apk-stub"
 *                / "tidak memakai terminalGuard".
 *        - terminal   (installApkStub, TANPA installServerFnPassthroughGuard)
 *              → memuat `(mode: terminal)`,
 *                base checklist: primeInitial+assertPrimed, waitForServed,
 *                assertQuiescent, terminalGuard();
 *                TIDAK memuat `passthrough.assertNoAdditionalRequests`.
 *        - full       (installServerFnPassthroughGuard aktif)
 *              → memuat `(mode: full)` DAN
 *                `✓ passthrough.assertNoAdditionalRequests`.
 *
 * Exit code: 0 bila semua lulus, 1 bila ada masalah.
 *
 * npm: `bun run e2e:apk:validate` (dry-check di CI / pre-commit).
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SPEC_DIR = path.join(ROOT, "tests/e2e");
const CONFIG = path.join(ROOT, "playwright.config.ts");

const REQUIRED_COLUMNS = ["Skenario", "Harness", "Tujuan", "Guards"];
const PLACEHOLDER_RE = /TODO\s*(?:—|-|\(scaffold\))/i;

// Checklist marker yang wajib untuk mode stub (terminal / full).
const BASE_STUB_MARKERS = [
  { id: "primeInitial", re: /primeInitial/ },
  { id: "assertPrimed", re: /assertPrimed/ },
  { id: "waitForServed", re: /waitForServed/ },
  { id: "assertQuiescent", re: /assertQuiescent/ },
  { id: "terminalGuard", re: /terminalGuard\(\)/ },
];

function detectSpecMode(src) {
  const usesStub = /\binstallApkStub\s*\(/.test(src);
  if (!usesStub) return "form-only";
  return /\binstallServerFnPassthroughGuard\s*\(/.test(src) ? "full" : "terminal";
}

/**
 * Ambil komentar header (baris `// ...` berturut-turut) yang mendahului
 * `name: "<project>",` di dalam blok project terdekat. Mengembalikan
 * teks komentar mentah + offset baris awal untuk pesan error.
 */
function extractProjectHeader(configText, projectName) {
  const anchor = `name: "${projectName}",`;
  const nameIdx = configText.indexOf(anchor);
  if (nameIdx < 0) return { found: false };

  const blockStart = configText.lastIndexOf("    {", nameIdx);
  if (blockStart < 0) return { found: false, reason: "block-start-missing" };

  const between = configText.slice(blockStart, nameIdx);
  // Ambil hanya baris yang murni komentar `// ...` di area antara `{`
  // dan `name:`.
  const lines = between.split("\n").map((l) => l.trim());
  const commentLines = [];
  for (const l of lines) {
    if (l.startsWith("//")) commentLines.push(l.replace(/^\/\/\s?/, ""));
  }

  // Line number awal blok (1-based) untuk pesan error.
  let line = 1;
  for (let i = 0; i < blockStart; i++) if (configText[i] === "\n") line++;

  return { found: true, header: commentLines.join("\n"), lineStart: line };
}

/**
 * Bagi teks header menjadi map kolom → isi (multi-line). Kolom baru
 * dimulai pada baris yang cocok `<Kolom> :` (setelah trim), sisanya
 * dianggap continuation baris kolom sebelumnya.
 */
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
      cols[current] += (cols[current] ? "\n" : "") + raw;
    }
  }
  return cols;
}

function validateOne({ file, specSrc, configText }) {
  const name = file.replace(/\.spec\.ts$/, "");
  const projectName = `${name}-e2e`;
  const errors = [];

  const { found, header, reason, lineStart } = extractProjectHeader(
    configText,
    projectName,
  );
  if (!found) {
    errors.push(
      `project "${projectName}" tidak ditemukan di playwright.config.ts` +
        (reason ? ` (${reason})` : ""),
    );
    return { name, projectName, mode: null, errors, lineStart: null };
  }

  const mode = detectSpecMode(specSrc);
  const cols = splitColumns(header);

  // 1. Semua kolom wajib ada.
  for (const key of REQUIRED_COLUMNS) {
    if (!(key in cols)) {
      errors.push(`kolom "// ${key} :" hilang di header project`);
    } else if (!cols[key].trim()) {
      errors.push(`kolom "// ${key} :" kosong`);
    } else if (PLACEHOLDER_RE.test(cols[key])) {
      errors.push(`kolom "// ${key} :" masih memuat placeholder TODO`);
    }
  }

  // 2. Validasi Guards vs mode.
  const guards = cols.Guards ?? "";
  const hasPassthroughMarker = /passthrough\.assertNoAdditionalRequests/.test(
    guards,
  );
  const modeTagMatch = guards.match(/\(mode:\s*(terminal|full)\)/);

  if (mode === "form-only") {
    const acknowledgesNoStub =
      /tidak memakai apk-stub|tidak memakai terminalGuard|bukan flow getApkVariantDetail/i.test(
        guards,
      );
    if (!acknowledgesNoStub) {
      errors.push(
        `spec form-only (tanpa installApkStub) — Guards harus eksplisit menyebut "tidak memakai apk-stub / terminalGuard"`,
      );
    }
    if (modeTagMatch) {
      errors.push(
        `spec form-only tidak boleh memuat "(mode: ${modeTagMatch[1]})" di Guards`,
      );
    }
  } else {
    // Mode stub (terminal / full): checklist wajib.
    if (!modeTagMatch) {
      errors.push(
        `Guards tidak memuat penanda "(mode: terminal)" / "(mode: full)"`,
      );
    } else if (modeTagMatch[1] !== mode) {
      errors.push(
        `Guards menandai "(mode: ${modeTagMatch[1]})" tapi spec sebenarnya "${mode}"`,
      );
    }

    for (const m of BASE_STUB_MARKERS) {
      // apk-mount-quiescent secara eksplisit menandai "tidak ada trackedClick";
      // jadi kita tidak mem-force trackedClick pada base checklist.
      if (!m.re.test(guards)) {
        errors.push(`Guards tidak memuat penanda \`${m.id}\``);
      }
    }

    if (mode === "full") {
      if (!hasPassthroughMarker) {
        errors.push(
          `mode full: Guards WAJIB memuat "✓ passthrough.assertNoAdditionalRequests"`,
        );
      }
    } else if (mode === "terminal") {
      if (hasPassthroughMarker) {
        errors.push(
          `mode terminal: Guards TIDAK boleh memuat "passthrough.assertNoAdditionalRequests" (khusus mode full)`,
        );
      }
    }
  }

  return { name, projectName, mode, errors, lineStart };
}

async function main() {
  const entries = await fs.readdir(SPEC_DIR);
  const specs = entries
    .filter((f) => f.startsWith("apk-") && f.endsWith(".spec.ts"))
    .sort();
  const configText = await fs.readFile(CONFIG, "utf8");

  const results = [];
  for (const file of specs) {
    const specSrc = await fs.readFile(path.join(SPEC_DIR, file), "utf8");
    results.push(validateOne({ file, specSrc, configText }));
  }

  const failing = results.filter((r) => r.errors.length > 0);
  console.log(`── Validasi header project block APK ──`);
  console.log(`total spec  : ${specs.length}`);
  console.log(`OK          : ${specs.length - failing.length}`);
  console.log(`gagal       : ${failing.length}`);
  console.log();

  for (const r of results) {
    const tag = r.errors.length === 0 ? "✓" : "✗";
    const modeLbl = r.mode ?? "?";
    const locLbl =
      r.lineStart != null ? `playwright.config.ts:${r.lineStart}` : "(no block)";
    console.log(`  ${tag} ${r.name}  [${modeLbl}]  ${locLbl}`);
    for (const e of r.errors) console.log(`      · ${e}`);
  }

  if (failing.length > 0) {
    console.log(
      `\n✗ ${failing.length} project block gagal validasi. Perbaiki komentar header di playwright.config.ts atau jalankan \`bun run e2e:apk:regen:apply\` untuk sinkron ulang.`,
    );
    process.exit(1);
  }
  console.log(`\n✓ Semua project block APK lolos validasi kolom & guards.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});