#!/usr/bin/env node
/**
 * Regenerator batch untuk seluruh spec E2E APK.
 *
 * Untuk tiap `tests/e2e/apk-*.spec.ts`:
 *   1. Tentukan mode target — `--mode terminal|full|preserve` (default:
 *      preserve = pertahankan mode masing-masing spec).
 *   2. Bangun ulang isi spec dari `tests/e2e/_helpers/apk-spec.template.ts`
 *      via `buildSpec()` (fungsi dipakai bersama scaffold generator).
 *   3. Sinkronkan blok project yang bersangkutan di `playwright.config.ts`:
 *      baris `Guards ...` diperbarui sesuai mode. Bila blok belum ada,
 *      disisipkan seperti scaffold generator.
 *
 * PERHATIAN: Regenerasi MENIMPA isi spec. Konten kustom di dalam file
 * akan hilang — mode ini ditujukan untuk spec hasil scaffold yang
 * belum banyak dimodifikasi, ATAU untuk memaksa ulang pola guard.
 * Wajib pakai `--force` untuk menulis; tanpa itu skrip dry-run.
 *
 * Pemakaian:
 *   node scripts/regen-apk-scaffolds.mjs                 # dry-run, preserve
 *   node scripts/regen-apk-scaffolds.mjs --mode terminal # dry-run, semua → terminal
 *   node scripts/regen-apk-scaffolds.mjs --mode full --force
 *   node scripts/regen-apk-scaffolds.mjs --only "^apk-availability" --force
 *
 * npm: `bun run e2e:apk:regen` (lihat package.json).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildSpec,
  buildProjectBlock,
  validateName,
  validateMode,
  validateSpecContent,
  TEMPLATE,
  SPEC_DIR,
  CONFIG,
} from "./scaffold-apk-e2e-spec.mjs";

const ROOT = process.cwd();

function parseArgs(argv) {
  const out = { mode: "preserve", dryRun: true, only: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") out.dryRun = false;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--mode") out.mode = argv[++i] ?? "";
    else if (a.startsWith("--mode=")) out.mode = a.slice("--mode=".length);
    else if (a === "--full") out.mode = "full";
    else if (a === "--terminal" || a === "--terminal-only") out.mode = "terminal";
    else if (a === "--preserve") out.mode = "preserve";
    else if (a === "--only") out.only = argv[++i] ?? null;
    else if (a.startsWith("--only=")) out.only = a.slice("--only=".length);
  }
  return out;
}

function detectMode(src) {
  return /\binstallServerFnPassthroughGuard\s*\(/.test(src) ? "full" : "terminal";
}

/**
 * Update baris Guards di blok project yang sudah ada. Bila baris tidak
 * ditemukan (blok pakai format lama), block dibiarkan apa adanya dan
 * kita cukup log warning — user bisa jalankan `--force` ulang setelah
 * merapikan komentar manual.
 */
function updateProjectGuardsLine(configText, projectName, mode) {
  const nameAnchor = `name: "${projectName}",`;
  const nameIdx = configText.indexOf(nameAnchor);
  if (nameIdx < 0) return { text: configText, updated: false, reason: "not-found" };

  // Cari awal blok project (baris `    {` sebelum `name:`).
  const blockStart = configText.lastIndexOf("    {", nameIdx);
  if (blockStart < 0) return { text: configText, updated: false, reason: "block-start-missing" };

  const header = configText.slice(blockStart, nameIdx);
  const guardsLineRe =
    /(\/\/\s+Guards\s+:[^\n]*\n(?:\s*\/\/[^\n]*\n)*?)/;
  // Regex sederhana: cari "// Guards" lalu ganti seluruh baris yang
  // memuat penanda mode (terminal / full) dalam kurung.
  const modeRe = /\((mode:\s*(terminal|full))\)/;

  if (!modeRe.test(header) && !/\/\/\s+Guards\s+:/.test(header)) {
    return { text: configText, updated: false, reason: "guards-comment-missing" };
  }

  const targetTag = `(mode: ${mode})`;
  let newHeader = header;
  if (modeRe.test(header)) {
    newHeader = header.replace(modeRe, targetTag);
  }

  // Ganti checklist singkat: full → tambahkan passthrough marker; terminal → hapus.
  const passthroughMarker = "✓ passthrough.assertNoAdditionalRequests";
  if (mode === "full") {
    if (!newHeader.includes(passthroughMarker)) {
      newHeader = newHeader.replace(
        /(✓ terminalGuard\(\))(\s*)/,
        `$1  ${passthroughMarker}$2`,
      );
    }
  } else {
    newHeader = newHeader.replace(
      new RegExp(`\\s*${passthroughMarker.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`),
      "",
    );
  }

  if (newHeader === header) return { text: configText, updated: false, reason: "no-change" };

  const nextText = configText.slice(0, blockStart) + newHeader + configText.slice(nameIdx);
  return { text: nextText, updated: true };
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.mode !== "preserve") {
    const modeInvalid = validateMode(args.mode);
    if (modeInvalid) {
      console.error(`✗ ${modeInvalid} (atau gunakan --mode preserve)`);
      process.exit(1);
    }
  }

  const onlyRe = args.only ? new RegExp(args.only) : null;

  const entries = await fs.readdir(SPEC_DIR);
  const specs = entries
    .filter((f) => f.startsWith("apk-") && f.endsWith(".spec.ts"))
    .sort();

  if (specs.length === 0) {
    console.log("(Tidak ada spec `apk-*.spec.ts` — tidak ada yang di-regen.)");
    return;
  }

  const template = await fs.readFile(TEMPLATE, "utf8");
  const templateInvalid = validateSpecContent(template, { label: "template" });
  if (templateInvalid) {
    console.error(`✗ ${templateInvalid}`);
    process.exit(1);
  }

  let configText = await fs.readFile(CONFIG, "utf8");
  const configOriginal = configText;

  const summary = [];
  for (const file of specs) {
    const name = file.replace(/\.spec\.ts$/, "");
    if (onlyRe && !onlyRe.test(name)) {
      summary.push({ name, skipped: true, reason: "filter" });
      continue;
    }
    const invalid = validateName(name);
    if (invalid) {
      summary.push({ name, skipped: true, reason: `nama tidak valid: ${invalid}` });
      continue;
    }

    const absPath = path.join(SPEC_DIR, file);
    const currentSrc = await fs.readFile(absPath, "utf8");
    const currentMode = detectMode(currentSrc);
    const targetMode = args.mode === "preserve" ? currentMode : args.mode;

    const nextSpec = buildSpec(template, name, targetMode);
    const specInvalid = validateSpecContent(nextSpec, { label: `regen ${file}` });
    if (specInvalid) {
      summary.push({ name, skipped: true, reason: specInvalid });
      continue;
    }

    const specChanged = nextSpec !== currentSrc;
    let projectAction = "unchanged";
    const projectName = `${name}-e2e`;
    if (configText.includes(`name: "${projectName}"`)) {
      const upd = updateProjectGuardsLine(configText, projectName, targetMode);
      if (upd.updated) {
        configText = upd.text;
        projectAction = `guards→${targetMode}`;
      } else {
        projectAction = `skip(${upd.reason})`;
      }
    } else {
      // Belum terdaftar → sisipkan via helper scaffold.
      const block = buildProjectBlock(name, targetMode);
      const anchor = `      name: "apk-mount-quiescent-e2e",`;
      const anchorIdx = configText.indexOf(anchor);
      if (anchorIdx >= 0) {
        const closeIdx = configText.indexOf("    },\n", anchorIdx);
        if (closeIdx >= 0) {
          const insertAt = closeIdx + "    },\n".length;
          configText =
            configText.slice(0, insertAt) + block + configText.slice(insertAt);
          projectAction = "inserted";
        } else projectAction = "insert-failed(close-missing)";
      } else projectAction = "insert-failed(anchor-missing)";
    }

    summary.push({
      name,
      fromMode: currentMode,
      toMode: targetMode,
      specChanged,
      projectAction,
      nextSpec,
      absPath,
    });
  }

  const changedSpecs = summary.filter((s) => !s.skipped && s.specChanged);
  const configChanged = configText !== configOriginal;

  console.log(`── Regen APK scaffold ${args.dryRun ? "(DRY RUN)" : "(WRITE)"} ──`);
  console.log(`mode target : ${args.mode}${args.only ? `   filter: /${args.only}/` : ""}`);
  console.log(`total spec  : ${specs.length}`);
  console.log(`ubah spec   : ${changedSpecs.length}`);
  console.log(`config      : ${configChanged ? "berubah" : "tetap"}`);
  console.log();
  for (const s of summary) {
    if (s.skipped) {
      console.log(`  · ${s.name}  — skip (${s.reason})`);
      continue;
    }
    const modeTag =
      s.fromMode === s.toMode
        ? s.toMode
        : `${s.fromMode} → ${s.toMode}`;
    const specTag = s.specChanged ? "spec:UPDATE" : "spec:sama";
    console.log(
      `  ${s.specChanged ? "✎" : "·"} ${s.name}  [${modeTag}]  ${specTag}  project:${s.projectAction}`,
    );
  }

  if (args.dryRun) {
    console.log(
      `\n(dry-run) Jalankan ulang dengan --force untuk menulis perubahan di atas.`,
    );
    return;
  }

  for (const s of summary) {
    if (s.skipped || !s.specChanged) continue;
    await fs.writeFile(s.absPath, s.nextSpec, "utf8");
  }
  if (configChanged) {
    await fs.writeFile(CONFIG, configText, "utf8");
  }
  console.log(
    `\n✓ Selesai. ${changedSpecs.length} spec ditulis, config ${configChanged ? "diperbarui" : "tidak berubah"}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});