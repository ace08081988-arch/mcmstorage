#!/usr/bin/env node
/**
 * Guardrail typecheck for `src/routes/_authenticated.gudang.reset-effect-trigger.test.ts`
 * dan sibling suites yang berbagi pipeline reset+derived+warnings.
 *
 * Tujuan: mencegah regresi TS7053 ("element implicitly has an 'any' type
 * because expression of type ... can't be used to index type ...") dan error
 * indexing-type terkait pada file-file kunci yang kita jaga.
 *
 * Menjalankan `tsgo --noEmit` untuk seluruh project (agar konteks import
 * tetap terselesaikan), lalu MENYARING output ke daftar file yang dijaga
 * dan MENOLAK jika ditemukan salah satu kode error berikut:
 *
 *  - TS7053  implicit any dari index signature
 *  - TS7052  implicit any pada indexed access
 *  - TS7015  indexed access dengan tipe non-numeric
 *  - TS2322  (indexer-related) dari assign ke union index
 *  - TS2536  index type tidak assignable
 *  - TS2538  tidak bisa dipakai sebagai index type
 *  - TS2339  property does not exist (proxy: implicit any indexing)
 *
 * Catatan: filter di sini SENGAJA sempit — TS2339/TS2322 hanya diflag jika
 * berasal dari file terjaga; typecheck utama sudah menangkap error project
 * secara umum. Guard ini adalah "canary" khusus untuk skenario TS7053.
 */
import { spawnSync } from "node:child_process";
import { relative, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

/** File yang wajib bebas error indexing-type. */
const GUARDED = new Set(
  [
    "src/routes/_authenticated.gudang.reset-effect-trigger.test.ts",
    "src/routes/_authenticated.gudang.effective-fields-refetch.test.ts",
    "src/routes/_authenticated.gudang.effective-fields-deepequal-refetch.test.ts",
    "src/routes/_authenticated.gudang.interleave-supporting-effective.test.ts",
    "src/routes/_authenticated.gudang.selecteditem-burst-refetch.test.ts",
    "src/routes/_authenticated.gudang.warnings-only-recompute.test.ts",
    "src/routes/_authenticated.gudang.resetkey-burst-refetch.test.ts",
    "src/routes/_authenticated.gudang.zero-empty-reset.test.ts",
    "src/routes/_authenticated.gudang.pipeline-consumers-audit.test.ts",
    "src/lib/beli-derived.ts",
    "src/lib/beli-compute.ts",
  ].map((p) => p.replace(/\\/g, "/")),
);

/** Kode error TS yang diperlakukan sebagai regresi indexing-type. */
const INDEXING_CODES = new Set([
  "TS7053",
  "TS7052",
  "TS7015",
  "TS2536",
  "TS2538",
]);

/** Kode yang hanya diflag jika berasal dari file terjaga. */
const GUARDED_ONLY_CODES = new Set(["TS2322", "TS2339"]);

function run() {
  const res = spawnSync("bunx", ["tsgo", "--noEmit"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;

  // Format tsgo/tsc: "path/to/file.ts(line,col): error TSxxxx: message"
  const lineRe = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/gm;
  const regressions = [];
  const globalIndexing = [];

  for (const m of out.matchAll(lineRe)) {
    const [, fileAbs, lineNo, colNo, code, msg] = m;
    const rel = relative(ROOT, resolve(fileAbs)).replace(/\\/g, "/");
    const inGuarded = GUARDED.has(rel);
    if (INDEXING_CODES.has(code)) {
      if (inGuarded) regressions.push({ rel, lineNo, colNo, code, msg });
      else globalIndexing.push({ rel, lineNo, colNo, code, msg });
    } else if (GUARDED_ONLY_CODES.has(code) && inGuarded) {
      regressions.push({ rel, lineNo, colNo, code, msg });
    }
  }

  if (regressions.length === 0 && globalIndexing.length === 0) {
    console.log(
      `[reset-effect-trigger:types] OK — 0 error indexing-type pada ${GUARDED.size} file terjaga.`,
    );
    process.exit(0);
  }

  if (regressions.length > 0) {
    console.error(
      `\n[reset-effect-trigger:types] ✖ ${regressions.length} error indexing-type pada file TERJAGA:`,
    );
    for (const r of regressions) {
      console.error(`  ${r.rel}(${r.lineNo},${r.colNo}) ${r.code}: ${r.msg}`);
    }
  }

  if (globalIndexing.length > 0) {
    console.error(
      `\n[reset-effect-trigger:types] ⚠ ${globalIndexing.length} error indexing-type di file LAIN (informatif — bukan file terjaga, tapi tetap gagal untuk mencegah drift):`,
    );
    for (const r of globalIndexing) {
      console.error(`  ${r.rel}(${r.lineNo},${r.colNo}) ${r.code}: ${r.msg}`);
    }
  }

  process.exit(1);
}

run();