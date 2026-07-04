#!/usr/bin/env node
/**
 * Generator spec E2E APK dari template `tests/e2e/_helpers/apk-spec.template.ts`.
 *
 * Alur:
 *   1. Baca nama flow dari argumen CLI (--name) atau prompt interaktif.
 *   2. Validasi: kebab-case, tidak menabrak file .spec.ts yang sudah ada.
 *   3. Copy template → `tests/e2e/<flow>.spec.ts` dengan header ganti
 *      (judul describe, komentar rujukan).
 *   4. Sisipkan project baru di `playwright.config.ts` (auto-insert)
 *      TEPAT setelah project `apk-mount-quiescent-e2e` supaya semua
 *      spec APK berdekatan. Bila blok gagal ditemukan atau project
 *      sudah ada, skrip berhenti aman + instruksi manual.
 *
 * Pemakaian:
 *   node scripts/scaffold-apk-e2e-spec.mjs --name apk-focus-refetch-guard
 *   node scripts/scaffold-apk-e2e-spec.mjs            # prompt interaktif
 *   node scripts/scaffold-apk-e2e-spec.mjs --dry-run  # preview, no write
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const ROOT = process.cwd();
const TEMPLATE = path.join(
  ROOT,
  "tests/e2e/_helpers/apk-spec.template.ts",
);
const SPEC_DIR = path.join(ROOT, "tests/e2e");
const CONFIG = path.join(ROOT, "playwright.config.ts");

// Kebab-case: huruf kecil, angka, dash. Wajib diawali huruf; disarankan
// diawali prefix `apk-` supaya konvensi konsisten dengan spec lain.
const NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

function parseArgs(argv) {
  const out = { name: null, dryRun: false, mode: "terminal" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--mode") out.mode = argv[++i] ?? "";
    else if (a.startsWith("--mode=")) out.mode = a.slice("--mode=".length);
    else if (a === "--full") out.mode = "full";
    else if (a === "--terminal" || a === "--terminal-only") out.mode = "terminal";
    else if (a === "--name") out.name = argv[++i] ?? null;
    else if (a.startsWith("--name=")) out.name = a.slice("--name=".length);
    else if (!out.name && !a.startsWith("--")) out.name = a;
  }
  return out;
}

const VALID_MODES = new Set(["terminal", "full"]);

function validateMode(mode) {
  if (!VALID_MODES.has(mode))
    return `Mode "${mode}" tidak dikenal. Pilih salah satu: terminal | full.`;
  return null;
}

async function promptName() {
  const rl = readline.createInterface({ input, output });
  try {
    const raw = await rl.question(
      "Nama flow (kebab-case, mis. apk-focus-refetch-guard): ",
    );
    return raw.trim();
  } finally {
    rl.close();
  }
}

function validateName(name) {
  if (!name) return "Nama tidak boleh kosong.";
  if (!NAME_RE.test(name))
    return `Nama "${name}" bukan kebab-case valid (huruf kecil, angka, dash; diawali huruf).`;
  if (!name.startsWith("apk-"))
    return `Nama "${name}" tidak diawali "apk-" — konvensi spec APK butuh prefix ini.`;
  return null;
}

// Guard checks: pastikan spec hasil scaffolding tetap memakai pola
// deterministik. Setiap item = { id, test, msg }. `test(content)` return
// true bila pola ditemukan; kalau tidak, `msg` dilaporkan sebagai error.
//
// Pola yang WAJIB ada:
//   - primeInitial + assertPrimed  → priming stub sebelum navigasi.
//   - waitForServed                 → bukti handler sungguh dipanggil.
//   - trackedClick / trackedAction  → aksi yang memicu refetch di-wrap
//                                     (mereka yang menjalankan
//                                     `assertNoAdditionalRequests` per-aksi).
//   - assertQuiescent               → cek idle setelah aksi selesai.
//   - terminalGuard ATAU installServerFnPassthroughGuard → guard akhir spec.
const GUARD_CHECKS = [
  {
    id: "primeInitial",
    test: (s) => /\bstub\.primeInitial\s*\(/.test(s),
    msg: "spec tidak memanggil `stub.primeInitial(...)` — priming stub wajib sebelum `page.goto()`.",
  },
  {
    id: "assertPrimed",
    test: (s) => /\bstub\.assertPrimed\s*\(/.test(s),
    msg: "spec tidak memanggil `stub.assertPrimed()` — tanpa ini refetch pertama bisa lolos tanpa terdeteksi.",
  },
  {
    id: "waitForServed",
    test: (s) => /\bstub\.waitForServed\s*\(/.test(s),
    msg: "spec tidak memanggil `stub.waitForServed(...)` — dibutuhkan untuk memastikan handler dipanggil sebelum guard idle.",
  },
  {
    id: "trackedAction",
    test: (s) =>
      /\bstub\.trackedClick\s*\(/.test(s) || /\bstub\.trackedAction\s*\(/.test(s),
    msg: "spec tidak memakai `stub.trackedClick(...)` / `stub.trackedAction(...)` — aksi refetch wajib di-wrap agar `assertNoAdditionalRequests` berjalan per-aksi.",
  },
  {
    id: "assertQuiescent",
    test: (s) => /\bstub\.assertQuiescent\s*\(/.test(s),
    msg: "spec tidak memanggil `stub.assertQuiescent(...)` — cek idle akhir per-varian wajib ada.",
  },
  {
    id: "terminalOrPassthrough",
    test: (s) =>
      /\bstub\.terminalGuard\s*\(/.test(s) ||
      /\binstallServerFnPassthroughGuard\s*\(/.test(s),
    msg: "spec tidak menutup dengan `stub.terminalGuard()` atau `installServerFnPassthroughGuard(...)` — salah satu guard akhir wajib ada.",
  },
];

function validateSpecContent(content, { label } = { label: "spec" }) {
  const missing = GUARD_CHECKS.filter((c) => !c.test(content));
  if (missing.length === 0) return null;
  const lines = missing.map((c) => `  - [${c.id}] ${c.msg}`).join("\n");
  return `Guard hilang di ${label}:\n${lines}`;
}

function buildSpec(template, name, mode = "terminal") {
  // Ganti header komentar dari "TEMPLATE — ..." menjadi rujukan spec.
  const modeNote =
    mode === "full"
      ? ` Mode: FULL guards — memasang \`installServerFnPassthroughGuard\`
 * di setup dan menutup dengan \`stub.terminalGuard()\` + passthrough
 * assertion. Gunakan untuk flow yang menyentuh server function di luar
 * \`getApkVariantDetail\` (copy chat link, export, dll).`
      : ` Mode: TERMINAL-only — hanya \`stub.terminalGuard()\` di akhir.
 * Cukup untuk flow APK murni yang tidak menyentuh server function lain.`;
  const stampedHeader = `/**
 * Spec E2E APK — flow "${name}".
 *
 * Dibuat dari \`tests/e2e/_helpers/apk-spec.template.ts\` via
 * \`scripts/scaffold-apk-e2e-spec.mjs\` (--mode ${mode}).
 * Pola guard (\`trackedClick\`,
 * \`trackedAction\`, \`assertQuiescent\`, \`terminalGuard\`) sudah
 * terpasang — LENGKAPI, JANGAN HAPUS.
 *${modeNote}
 *
 * Detail pola & anti-pattern:
 * \`tests/e2e/_helpers/README.md\`.
 */`;

  // Buang blok komentar template asli (baris 1 s/d penutup pertama "*/")
  // lalu prepend stampedHeader.
  const closeIdx = template.indexOf("*/\n");
  if (closeIdx < 0) {
    throw new Error(
      "Template tidak mengandung penutup komentar `*/` — file rusak?",
    );
  }
  const body = template.slice(closeIdx + "*/\n".length);

  // Ganti judul describe placeholder.
  const withDescribe = body.replace(
    /test\.describe\("APK <flow-name> — deterministic guard"/,
    `test.describe("APK ${name} — deterministic guard"`,
  );

  // Rewrite import path: template ada di `tests/e2e/_helpers/`, sedangkan
  // spec hasil scaffold ada di `tests/e2e/` — jadi `../_apk-availability-stub`
  // harus jadi `./_apk-availability-stub` supaya import valid.
  const withImport = withDescribe.replace(
    /from "\.\.\/_apk-availability-stub"/g,
    'from "./_apk-availability-stub"',
  );

  const finalBody =
    mode === "full" ? applyFullGuardMode(withImport) : withImport;

  return `${stampedHeader}\n\n${finalBody}`;
}

// Mode FULL: inject `installServerFnPassthroughGuard` di setup + assertion
// akhir. Pola ini cocok untuk flow yang juga menyentuh server function di
// luar APK (mis. copy chat link, export). Regex anchor: baris
// `const stub = await installApkStub(page);` (setup) dan panggilan
// `await stub.terminalGuard();` (akhir).
function applyFullGuardMode(body) {
  const IMPORT_LINE =
    'import { installServerFnPassthroughGuard } from "./_helpers/serverfn-passthrough-guard";';
  const SETUP_ANCHOR = "const stub = await installApkStub(page);";
  const TERMINAL_ANCHOR = "await stub.terminalGuard();";

  if (!body.includes(SETUP_ANCHOR) || !body.includes(TERMINAL_ANCHOR)) {
    throw new Error(
      "Mode --full membutuhkan anchor `installApkStub(page)` dan `stub.terminalGuard()` di template — template rusak?",
    );
  }

  // Sisipkan import setelah baris import stub APK yang sudah di-rewrite.
  const withImport = body.replace(
    /(import \{ installApkStub[^}]*\} from "\.\/_apk-availability-stub";\n)/,
    `$1${IMPORT_LINE}\n`,
  );

  // Sisipkan pemasangan passthrough guard tepat SETELAH stub setup.
  const passthroughSetup = `${SETUP_ANCHOR}
    // Mode FULL: pantau SEMUA server function (bukan hanya
    // getApkVariantDetail). Wajib bila flow menyentuh copy/export/link.
    const passthrough = await installServerFnPassthroughGuard(page);`;
  const withSetup = withImport.replace(SETUP_ANCHOR, passthroughSetup);

  // Sisipkan assertion + dispose SETELAH terminalGuard.
  const passthroughTail = `${TERMINAL_ANCHOR}

    // Mode FULL: verifikasi tidak ada server-fn asing (selain APK) yang
    // firing setelah semua aksi selesai. windowMs default 750ms.
    await passthrough.assertNoAdditionalRequests({ windowMs: 750 });
    await passthrough.dispose();`;
  const withTail = withSetup.replace(TERMINAL_ANCHOR, passthroughTail);

  return withTail;
}

function buildProjectBlock(name) {
  // Nama project mengikuti konvensi `<flow>-e2e` (lihat project APK lain).
  const projectName = `${name}-e2e`;
  // Escape titik untuk regex `testMatch`.
  const testMatch = `/${name.replace(/-/g, "-")}\\.spec\\.ts/`;
  return `    {
      // TODO(scaffold): jelaskan skenario spec "${name}" — apa yang
      // diuji, harness mana yang dipakai, dan invariant guard-nya.
      name: "${projectName}",
      testDir: "./tests/e2e",
      testMatch: ${testMatch},
      use: { ...devices["iPhone 14"], viewport: { width: 390, height: 844 } },
    },
`;
}

function insertProject(configText, name, projectBlock) {
  const projectName = `${name}-e2e`;
  if (configText.includes(`name: "${projectName}"`)) {
    return { text: configText, inserted: false, reason: "already-registered" };
  }

  // Anchor: akhir blok project `apk-mount-quiescent-e2e`.
  const anchor = `      name: "apk-mount-quiescent-e2e",`;
  const anchorIdx = configText.indexOf(anchor);
  if (anchorIdx < 0) {
    return { text: configText, inserted: false, reason: "anchor-missing" };
  }

  // Cari `},\n` pertama SETELAH anchor — itu penutup project tersebut.
  const closeIdx = configText.indexOf("    },\n", anchorIdx);
  if (closeIdx < 0) {
    return { text: configText, inserted: false, reason: "close-missing" };
  }
  const insertAt = closeIdx + "    },\n".length;
  const next = configText.slice(0, insertAt) + projectBlock + configText.slice(insertAt);
  return { text: next, inserted: true, insertAt };
}

// Ubah offset karakter → nomor baris (1-based).
function offsetToLine(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

// Render diff mini untuk penyisipan project di playwright.config.ts.
// Menampilkan 3 baris konteks sebelum & sesudah insertAt, dengan setiap
// baris projectBlock diberi prefix "+".
function renderConfigDiff(configText, insertAt, projectBlock, contextLines = 3) {
  const before = configText.slice(0, insertAt).split("\n");
  const after = configText.slice(insertAt).split("\n");
  const startLine = Math.max(1, before.length - contextLines);
  const contextBefore = before.slice(-contextLines - 1, -1); // exclude empty tail after trailing \n
  const contextAfter = after.slice(0, contextLines);
  const insertedLines = projectBlock.replace(/\n$/, "").split("\n");
  const out = [];
  out.push(`  @@ playwright.config.ts (sekitar baris ${before.length}) @@`);
  contextBefore.forEach((l, i) =>
    out.push(`  ${String(startLine + i).padStart(4)}    ${l}`),
  );
  insertedLines.forEach((l) => out.push(`       + ${l}`));
  contextAfter.forEach((l, i) =>
    out.push(`  ${String(before.length + i).padStart(4)}    ${l}`),
  );
  return out.join("\n");
}

// Ringkasan hasil guard-check per rule (✓/✗) untuk log dry-run.
function renderGuardSummary(content) {
  return GUARD_CHECKS.map(
    (c) => `    ${c.test(content) ? "✓" : "✗"} ${c.id}`,
  ).join("\n");
}

// Preview head+tail dari file spec supaya user tahu isi yang akan ditulis
// tanpa harus print seluruh 200+ baris.
function renderSpecPreview(content, headLines = 6, tailLines = 4) {
  const lines = content.split("\n");
  if (lines.length <= headLines + tailLines + 2) {
    return lines.map((l, i) => `  ${String(i + 1).padStart(3)}  ${l}`).join("\n");
  }
  const head = lines.slice(0, headLines);
  const tail = lines.slice(-tailLines);
  const headStr = head
    .map((l, i) => `  ${String(i + 1).padStart(3)}  ${l}`)
    .join("\n");
  const tailStr = tail
    .map((l, i) =>
      `  ${String(lines.length - tailLines + i + 1).padStart(3)}  ${l}`,
    )
    .join("\n");
  return `${headStr}\n       …  (${lines.length - headLines - tailLines} baris tengah dilewati)\n${tailStr}`;
}

async function main() {
  const args = parseArgs(process.argv);
  let name = args.name;
  if (!name) name = await promptName();

  const invalid = validateName(name);
  if (invalid) {
    console.error(`✗ ${invalid}`);
    process.exit(1);
  }

  const specPath = path.join(SPEC_DIR, `${name}.spec.ts`);
  try {
    await fs.access(specPath);
    console.error(`✗ File spec sudah ada: ${path.relative(ROOT, specPath)}`);
    process.exit(1);
  } catch {
    // OK — belum ada.
  }

  const template = await fs.readFile(TEMPLATE, "utf8");
  const templateInvalid = validateSpecContent(template, { label: "template" });
  if (templateInvalid) {
    console.error(`✗ ${templateInvalid}`);
    console.error(
      `  Perbaiki \`tests/e2e/_helpers/apk-spec.template.ts\` dulu sebelum scaffold.`,
    );
    process.exit(1);
  }

  const specContent = buildSpec(template, name);
  const specInvalid = validateSpecContent(specContent, {
    label: `spec hasil scaffolding (${name}.spec.ts)`,
  });
  if (specInvalid) {
    console.error(`✗ ${specInvalid}`);
    console.error(
      `  Ini seharusnya tidak terjadi — buildSpec() menghapus pola guard. Laporkan bug generator.`,
    );
    process.exit(1);
  }

  const projectBlock = buildProjectBlock(name);
  const configText = await fs.readFile(CONFIG, "utf8");
  const { text: nextConfig, inserted, reason, insertAt } = insertProject(
    configText,
    name,
    projectBlock,
  );

  if (args.dryRun) {
    const specLines = specContent.split("\n").length;
    const projectLines = projectBlock.replace(/\n$/, "").split("\n").length;
    console.log(`── DRY RUN — tidak ada file yang diubah ──\n`);

    console.log(`▸ Spec baru`);
    console.log(`  path  : ${path.relative(ROOT, specPath)}`);
    console.log(`  size  : ${specLines} baris, ${specContent.length} chars`);
    console.log(`  guards:`);
    console.log(renderGuardSummary(specContent));
    console.log(`  preview:`);
    console.log(renderSpecPreview(specContent));
    console.log();

    console.log(`▸ playwright.config.ts`);
    if (inserted) {
      const insertLine = offsetToLine(configText, insertAt);
      console.log(
        `  aksi  : akan menambah project "${name}-e2e" (+${projectLines} baris) di baris ${insertLine}`,
      );
      console.log(renderConfigDiff(configText, insertAt, projectBlock));
    } else if (reason === "already-registered") {
      console.log(`  aksi  : LEWAT — project "${name}-e2e" sudah terdaftar.`);
    } else {
      console.log(`  aksi  : LEWAT — auto-insert gagal (${reason}).`);
      console.log(`  fallback: tambahkan blok berikut manual —`);
      console.log(
        projectBlock
          .replace(/\n$/, "")
          .split("\n")
          .map((l) => `       + ${l}`)
          .join("\n"),
      );
    }
    console.log(`\nJalankan tanpa --dry-run untuk menulis perubahan di atas.`);
    return;
  }

  await fs.writeFile(specPath, specContent, "utf8");
  console.log(`✓ Spec dibuat: ${path.relative(ROOT, specPath)}`);

  if (inserted) {
    await fs.writeFile(CONFIG, nextConfig, "utf8");
    console.log(`✓ Project "${name}-e2e" terdaftar di playwright.config.ts`);
  } else if (reason === "already-registered") {
    console.log(`• Project "${name}-e2e" sudah ada di playwright.config.ts — tidak diubah.`);
  } else {
    console.warn(
      `! Gagal auto-insert project (${reason}). Tambahkan manual di playwright.config.ts:\n${projectBlock}`,
    );
  }

  console.log(`\nLangkah berikutnya:`);
  console.log(`  1. Isi TODO(scaffold) di playwright.config.ts dengan deskripsi skenario.`);
  console.log(`  2. Lengkapi <skenario> di describe/test dan sesuaikan URL harness bila perlu.`);
  console.log(`  3. Jalankan: bunx playwright test --project=${name}-e2e`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});