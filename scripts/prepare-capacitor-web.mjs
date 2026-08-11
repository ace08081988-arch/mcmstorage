#!/usr/bin/env node
/**
 * Menyiapkan folder `dist/` (webDir Capacitor) dari hasil build mobile
 * TanStack Start (mode SPA/static) di `.output/public`.
 *
 * Deterministik: hanya ROOT/dist yang dibersihkan, lalu seluruh isi
 * `.output/public` disalin. Jika TanStack menghasilkan `_shell.html`
 * (bukan `index.html`), file itu disalin menjadi `index.html`.
 * Gagal cepat bila entrypoint statis tidak valid.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, ".output", "public");
const DEST = path.join(ROOT, "dist");

function fail(msg) {
  console.error(`[prepare-capacitor-web] ERROR: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(SRC) || !fs.statSync(SRC).isDirectory()) {
  fail(
    `Direktori hasil build client tidak ditemukan: ${SRC}. ` +
      `Jalankan build mobile (CAPACITOR_BUILD=1 vite build) terlebih dahulu.`,
  );
}

// Bersihkan HANYA ROOT/dist.
if (DEST !== path.join(ROOT, "dist")) fail("Target dist tidak aman.");
fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });
fs.cpSync(SRC, DEST, { recursive: true });

const indexPath = path.join(DEST, "index.html");
if (!fs.existsSync(indexPath)) {
  const shell = ["_shell.html", "_shell/index.html", "index.html"]
    .map((p) => path.join(DEST, p))
    .find((p) => fs.existsSync(p));
  if (!shell) {
    fail(
      "Tidak ada index.html maupun _shell.html di hasil build. " +
        "Pastikan mode SPA TanStack Start aktif (CAPACITOR_BUILD=1).",
    );
  }
  fs.copyFileSync(shell, indexPath);
}

const html = fs.readFileSync(indexPath, "utf8");
if (html.trim().length < 50) fail("dist/index.html kosong/tidak valid.");
if (!/<script[\s>]/i.test(html)) {
  fail("dist/index.html tidak memuat <script> — bundle klien tidak tertaut.");
}
if (!fs.existsSync(path.join(DEST, "_build")) && !fs.existsSync(path.join(DEST, "assets"))) {
  fail("Aset utama (_build/ atau assets/) tidak ditemukan di dist/.");
}

console.log(`[prepare-capacitor-web] OK — dist/ siap (${html.length} B index.html)`);
