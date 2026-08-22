#!/usr/bin/env node
/**
 * Menyiapkan folder `dist/` (webDir Capacitor) dari hasil build mobile
 * TanStack Start mode SPA/static (`CAPACITOR_BUILD=1 vite build`).
 *
 * Sumber: `.output/public` bila ada, jika tidak `dist/client`
 * (layout output TanStack Start tanpa Nitro).
 *
 * Deterministik: hanya ROOT/dist yang dibersihkan, seluruh isi output client
 * disalin, dan `_shell.html` dipromosikan menjadi `index.html` bila perlu.
 * Gagal cepat bila entrypoint statis tidak valid. TIDAK PERNAH menunjuk
 * Capacitor ke bundle SSR (`.output/server` / `dist/server`).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEST = path.join(ROOT, "dist");

function fail(msg) {
  console.error(`[prepare-capacitor-web] ERROR: ${msg}`);
  process.exit(1);
}

const candidates = [
  path.join(ROOT, ".output", "public"),
  path.join(DEST, "client"),
];
const SRC = candidates.find(
  (p) => fs.existsSync(p) && fs.statSync(p).isDirectory(),
);
if (!SRC) {
  fail(
    `Output client tidak ditemukan (${candidates.join(" | ")}). ` +
      `Jalankan build mobile: CAPACITOR_BUILD=1 vite build`,
  );
}

// Salin ke staging di luar dist dulu, karena sumbernya bisa berada DI DALAM dist.
const STAGING = fs.mkdtempSync(path.join(os.tmpdir(), "cap-web-"));
fs.cpSync(SRC, STAGING, { recursive: true });

// Bersihkan HANYA ROOT/dist.
fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });
fs.cpSync(STAGING, DEST, { recursive: true });
fs.rmSync(STAGING, { recursive: true, force: true });

const indexPath = path.join(DEST, "index.html");
if (!fs.existsSync(indexPath)) {
  const shell = ["_shell.html", "_shell/index.html"]
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

let html = fs.readFileSync(indexPath, "utf8");
if (html.trim().length < 50) fail("dist/index.html kosong/tidak valid.");
if (!/<script[\s>]/i.test(html)) {
  fail("dist/index.html tidak memuat <script> — bundle klien tidak tertaut.");
}

// Shell SPA bisa terbit tanpa <meta name="viewport"> karena head() baru
// dipasang setelah hidrasi. Di Android WebView itu berarti frame pertama
// memakai layout viewport lebar (~980px), sehingga UI tampak mengecil di
// satu kolom sempit. Sisipkan meta viewport secara idempoten.
const VIEWPORT_META =
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"/>';
if (!/<meta[^>]+name=["']viewport["']/i.test(html)) {
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => `${m}${VIEWPORT_META}`);
  } else {
    html = `${VIEWPORT_META}${html}`;
  }
  fs.writeFileSync(indexPath, html);
  console.log("[prepare-capacitor-web] meta viewport disisipkan ke index.html");
}

// ── Boot watchdog: bikin layar hitam APK bisa didiagnosis dari HP ──────
// Di APK tidak ada DevTools/adb. Skrip inline ini menangkap error boot
// (script gagal load, error hidrasi, promise reject) dan — bila setelah
// 9 detik aplikasi belum ter-hidrasi — menampilkan overlay berisi pesan
// error + info build, supaya cukup di-screenshot. Tidak berjalan sama
// sekali kalau aplikasi berhasil boot.
const WATCHDOG_MARK = "ace-boot-watchdog";
const WATCHDOG = `<script id="${WATCHDOG_MARK}">(function(){
try{
 var errs=[];
 function push(m){try{errs.push(String(m).slice(0,500));localStorage.setItem("ace:boot-errors",JSON.stringify(errs.slice(-10)))}catch(e){}}
 addEventListener("error",function(e){
   var t=e.target;
   if(t&&(t.tagName==="SCRIPT"||t.tagName==="LINK"))push("Gagal memuat aset: "+(t.src||t.href));
   else push("JS error: "+(e.message||"")+" @ "+(e.filename||"")+":"+(e.lineno||0));
 },true);
 addEventListener("unhandledrejection",function(e){push("Promise ditolak: "+((e.reason&&(e.reason.stack||e.reason.message))||e.reason))});
 setTimeout(function(){
   if(document.documentElement.hasAttribute("data-ace-hydrated"))return;
   if(!errs.length)push("Aplikasi tidak selesai dimuat dalam 9 detik (tidak ada error JS).");
   var d=document.createElement("div");
   d.setAttribute("style","position:fixed;inset:0;z-index:2147483647;background:#0b0b0c;color:#f4f4f5;font:13px/1.5 system-ui,sans-serif;padding:16px;overflow:auto;-webkit-user-select:text;user-select:text");
   d.innerHTML='<div style="font-weight:700;font-size:15px;margin-bottom:8px;color:#e5b567">Ace Storage gagal dimuat</div>'
     +'<div style="opacity:.8;margin-bottom:12px">Screenshot layar ini dan kirim ke pengembang.</div>'
     +'<pre style="white-space:pre-wrap;word-break:break-word;background:#161618;padding:10px;border-radius:8px">'
     +errs.map(function(x){return x.replace(/[<>&]/g,"")}).join("\\n\\n")+'</pre>'
     +'<div style="opacity:.6;margin-top:12px;font-size:11px">URL: '+location.href+'<br>UA: '+navigator.userAgent+'</div>'
     +'<button id="ace-boot-retry" style="margin-top:14px;padding:10px 16px;border-radius:8px;border:0;background:#e5b567;color:#111;font-weight:700">Muat ulang</button>';
   document.body.appendChild(d);
   var b=document.getElementById("ace-boot-retry");
   if(b)b.addEventListener("click",function(){location.reload()});
 },9000);
}catch(e){}
})()</script>`;
if (!html.includes(WATCHDOG_MARK)) {
  html = /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, `${WATCHDOG}</head>`)
    : `${WATCHDOG}${html}`;
  fs.writeFileSync(indexPath, html);
  console.log("[prepare-capacitor-web] boot watchdog disisipkan ke index.html");
}


if (
  !fs.existsSync(path.join(DEST, "assets")) &&
  !fs.existsSync(path.join(DEST, "_build"))
) {
  fail("Aset utama (assets/ atau _build/) tidak ditemukan di dist/.");
}

console.log(
  `[prepare-capacitor-web] OK — dist/ siap dari ${path.relative(ROOT, SRC)} ` +
    `(index.html ${html.length} B)`,
);
