#!/usr/bin/env node
// Build-time SEO audit.
//
// Memastikan setiap rute publik di src/routes/ memenuhi salah satu syarat:
//   1. Terdaftar di sitemap (src/routes/sitemap[.]xml.ts), atau
//   2. Mempunyai meta robots noindex,nofollow di head() rutenya, atau
//   3. Berada di daftar pengecualian (utility/infra routes).
//
// Tujuan: mencegah finding "Sitemap needs attention" berulang setelah
// menambah/mengubah rute.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ROUTES_DIR = join(ROOT, "src/routes");
const SITEMAP_FILE = join(ROUTES_DIR, "sitemap[.]xml.ts");

// Rute yang sengaja tidak diindeks dan tidak perlu di-sitemap.
// Tambahkan di sini bila ada rute internal/utility baru.
const ALLOWLIST_NO_SITEMAP = new Set([
  "/sitemap.xml",
  "/robots.txt",
  "/lovable",
  "/lovable/*",
]);

/** Cari semua file rute *.tsx / *.ts di src/routes (rekursif). */
function listRouteFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "api" || name === "lovable") continue;
      out.push(...listRouteFiles(full));
      continue;
    }
    if (!/\.(tsx?|jsx?)$/.test(name)) continue;
    if (name.startsWith("__")) continue; // __root.tsx
    if (name === "README.md") continue;
    if (name.startsWith("sitemap[.]")) continue;
    out.push(full);
  }
  return out;
}

/** Ambil path createFileRoute("...") dari isi file. */
function extractRoutePath(src) {
  const m = src.match(/createFileRoute\(\s*["'`]([^"'`]+)["'`]\s*\)/);
  return m ? m[1] : null;
}

/** Konversi route id ke URL publik (drop segmen _layout). */
function routeIdToUrl(routeId) {
  // /_authenticated/audit -> /audit
  // /posts/$slug         -> /posts/$slug (tetap)
  return routeId
    .split("/")
    .filter((seg) => !seg.startsWith("_"))
    .join("/") || "/";
}

/** Apakah rute punya meta robots noindex di head()? */
function hasNoindex(src) {
  // Cocokkan name:"robots", content:"noindex..."
  return /name:\s*["'`]robots["'`][^}]*content:\s*["'`][^"'`]*noindex/i.test(
    src,
  );
}

/** Baca daftar path yang ada di sitemap. */
function readSitemapPaths() {
  const src = readFileSync(SITEMAP_FILE, "utf8");
  // Tangkap setiap path: "..." di dalam objek entries.
  const paths = new Set();
  for (const m of src.matchAll(/path:\s*["'`]([^"'`]+)["'`]/g)) {
    paths.add(m[1]);
  }
  return paths;
}

function main() {
  const sitemapPaths = readSitemapPaths();
  const files = listRouteFiles(ROUTES_DIR);
  const rows = [];
  const errors = [];

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const id = extractRoutePath(src);
    if (!id) continue;
    const url = routeIdToUrl(id);

    // Lewati rute dinamis ($param/$splat) — tidak harus per-URL di sitemap;
    // entri dinamis (jika ada) di-generate dari loader.
    const isDynamic = /\$/.test(url);
    // Rute di bawah layout _authenticated bersifat auth-gated: tidak boleh
    // terindeks dan tidak masuk sitemap publik.
    const isAuthGated = /\/_authenticated(\/|$)/.test(id);
    const inSitemap = sitemapPaths.has(url);
    const noindex = hasNoindex(src);
    const allowlisted = ALLOWLIST_NO_SITEMAP.has(url);

    let status;
    if (isDynamic) status = "DYNAMIC (skip)";
    else if (isAuthGated && inSitemap) {
      status = "CONFLICT";
      errors.push(
        `  ${url}  — rute auth-gated tidak boleh masuk sitemap (${relative(ROOT, file)})`,
      );
    } else if (isAuthGated) status = "auth-gated";
    else if (inSitemap && noindex) {
      status = "CONFLICT";
      errors.push(
        `  ${url}  — masuk sitemap TAPI bertanda noindex (${relative(ROOT, file)})`,
      );
    } else if (inSitemap) status = "sitemap";
    else if (noindex) status = "noindex";
    else if (allowlisted) status = "allowlist";
    else {
      status = "MISSING";
      errors.push(
        `  ${url}  — tidak ada di sitemap & tidak noindex (${relative(ROOT, file)})`,
      );
    }

    rows.push({ url, status, file: relative(ROOT, file) });
  }

  // Cetak ringkasan
  rows.sort((a, b) => a.url.localeCompare(b.url));
  const pad = (s, n) => String(s).padEnd(n);
  console.log("SEO route audit");
  console.log("─".repeat(72));
  for (const r of rows) {
    console.log(`  ${pad(r.url, 36)} ${pad(r.status, 16)} ${r.file}`);
  }
  console.log("─".repeat(72));
  console.log(
    `  total=${rows.length}  sitemap=${rows.filter((r) => r.status === "sitemap").length}  noindex=${rows.filter((r) => r.status === "noindex").length}  dynamic=${rows.filter((r) => r.status === "DYNAMIC (skip)").length}  allowlist=${rows.filter((r) => r.status === "allowlist").length}`,
  );

  if (errors.length) {
    console.error("\n❌ SEO audit gagal:");
    for (const e of errors) console.error(e);
    console.error(
      "\nPerbaiki dengan menambah rute ke sitemap (src/routes/sitemap[.]xml.ts) atau menambah meta robots noindex,nofollow di head() rute.",
    );
    process.exit(1);
  }
  console.log("\n✅ SEO audit lulus.");
}

main();