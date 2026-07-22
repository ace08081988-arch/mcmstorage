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

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ROUTES_DIR = join(ROOT, "src/routes");
const SITEMAP_FILE = join(ROUTES_DIR, "sitemap[.]xml.ts");
const ROBOTS_FILE = join(ROOT, "public/robots.txt");

// Rute yang sengaja tidak diindeks dan tidak perlu di-sitemap.
// Tambahkan di sini bila ada rute internal/utility baru.
const ALLOWLIST_NO_SITEMAP = new Set([
  "/sitemap.xml",
  "/robots.txt",
  "/lovable",
  "/lovable/*",
  "/email/unsubscribe",
  // MCP server (@lovable.dev/mcp-js) — endpoint infra, bukan halaman publik.
  "/mcp",
  "/.mcp/list-tools",
  "/.well-known/oauth-protected-resource",
  // Halaman consent OAuth — hanya dipanggil via authorization_id, tidak indexable.
  "/.lovable/oauth/consent",
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
  return extractSitemapPaths(src);
}

/**
 * Ekstrak path sitemap dari sumber file — hanya dari literal array
 * `entries` (SitemapEntry[]), sehingga komentar/dokumentasi/regex lain
 * tidak dianggap sebagai entri sitemap.
 */
export function extractSitemapPaths(src) {
  const paths = new Set();
  const m = src.match(/entries\s*:\s*SitemapEntry\[\]\s*=\s*\[([\s\S]*?)\];/);
  if (!m) return paths;
  for (const p of m[1].matchAll(/path:\s*["'`]([^"'`]+)["'`]/g)) {
    paths.add(p[1]);
  }
  return paths;
}

/**
 * Ekstrak daftar aturan Disallow untuk User-agent: * dari robots.txt.
 * Baris komentar (#…) diabaikan. Hanya blok wildcard `*` yang dipakai —
 * itu yang berlaku untuk mayoritas crawler dan menjadi sumber kebenaran
 * untuk audit konsistensi ini.
 */
export function extractRobotsDisallows(src) {
  const rules = [];
  let inStar = false;
  for (const rawLine of src.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const ua = line.match(/^User-agent:\s*(.+)$/i);
    if (ua) {
      inStar = ua[1].trim() === "*";
      continue;
    }
    if (!inStar) continue;
    const d = line.match(/^Disallow:\s*(.*)$/i);
    if (d && d[1].trim()) rules.push(d[1].trim());
  }
  return rules;
}

/**
 * Apakah URL cocok dengan salah satu aturan Disallow (prefix match sesuai
 * spesifikasi robots.txt: `Disallow: /foo` menutup semua yang diawali `/foo`).
 */
export function robotsMatches(url, rules) {
  return rules.some((r) => url === r || url.startsWith(r));
}

/**
 * Auto-fix robots.txt berdasarkan daftar konflik yang terdeteksi audit.
 *
 * - `add`: URL noindex yang belum di-Disallow → tambahkan `Disallow: <url>`
 *   pada blok `User-agent: *` (buat blok bila belum ada).
 * - `remove`: URL yang masuk sitemap tapi keblokir Disallow → hapus baris
 *   Disallow yang persis cocok. Aturan prefix yang menutup URL lain tidak
 *   disentuh otomatis (butuh keputusan manusia — kami cetak saran saja).
 *
 * Fungsi ini murni: menerima teks robots.txt + patch, mengembalikan teks
 * baru + daftar perubahan yang benar-benar diterapkan / dilewati. Dipisah
 * dari I/O supaya bisa di-self-test.
 */
export function applyRobotsFix(src, { add = [], remove = [] } = {}) {
  const addSet = new Set(add);
  const removeSet = new Set(remove);
  const applied = { added: [], removed: [], skipped: [] };

  const lines = src.split(/\r?\n/);
  // Tandai baris yang akan dibuang: Disallow eksak untuk URL di removeSet
  // di dalam blok `User-agent: *`.
  let inStar = false;
  const kept = [];
  for (const rawLine of lines) {
    const stripped = rawLine.replace(/#.*$/, "").trim();
    const ua = stripped.match(/^User-agent:\s*(.+)$/i);
    if (ua) {
      inStar = ua[1].trim() === "*";
      kept.push(rawLine);
      continue;
    }
    if (inStar) {
      const d = stripped.match(/^Disallow:\s*(.*)$/i);
      if (d && removeSet.has(d[1].trim())) {
        applied.removed.push(d[1].trim());
        continue; // drop baris ini
      }
    }
    kept.push(rawLine);
  }

  // Konflik yang tak bisa dihapus otomatis (prefix, bukan exact) → skip.
  for (const url of removeSet) {
    if (!applied.removed.includes(url)) applied.skipped.push({ op: "remove", url, reason: "no exact Disallow line (prefix rule)" });
  }

  // Sisipkan Disallow baru di blok `User-agent: *`. Bila blok belum ada,
  // append blok baru di akhir file.
  let out = kept.join("\n");
  const toAdd = [...addSet];
  if (toAdd.length) {
    const starIdx = out.search(/^User-agent:\s*\*\s*$/im);
    if (starIdx >= 0) {
      // Cari posisi akhir blok `*` (baris kosong atau `User-agent:` berikutnya).
      const after = out.slice(starIdx);
      const blockEndRel = after.search(/\n\s*\n|\nUser-agent:/i);
      const blockEnd = blockEndRel >= 0 ? starIdx + blockEndRel : out.length;
      const insertion = toAdd.map((u) => `Disallow: ${u}`).join("\n");
      out = `${out.slice(0, blockEnd).replace(/\s+$/, "")}\n${insertion}${out.slice(blockEnd)}`;
      applied.added.push(...toAdd);
    } else {
      const block = ["", "User-agent: *", "Allow: /", ...toAdd.map((u) => `Disallow: ${u}`), ""].join("\n");
      out = `${out.replace(/\s+$/, "")}\n${block}`;
      applied.added.push(...toAdd);
    }
  }

  if (!out.endsWith("\n")) out += "\n";
  return { text: out, applied };
}

/**
 * Klasifikasikan satu rute berdasarkan sinyal-sinyal yang sudah diekstrak.
 * Dipisah dari I/O supaya bisa di-self-test tanpa menyentuh disk.
 * Mengembalikan { status, error? } — error hanya diisi bila benar-benar salah.
 */
export function classifyRoute({
  routeId,
  url,
  inSitemap,
  noindex,
  allowlisted,
  robotsDisallowed,
}) {
  const isDynamic = /\$/.test(url);
  const isAuthGated = /\/_authenticated(\/|$)/.test(routeId);
  if (isDynamic) return { status: "DYNAMIC (skip)" };
  if (routeId === "/_authenticated") return { status: "layout (skip)" };
  // CONFLICT diperiksa lebih dulu supaya rute auth-gated yang keliru
  // masuk sitemap tetap ketahuan (mis. /reset-password bila di-sitemap-kan
  // padahal ber-noindex).
  if (inSitemap && noindex) {
    return {
      status: "CONFLICT",
      error: `${url} — masuk sitemap TAPI bertanda noindex`,
    };
  }
  if (inSitemap && robotsDisallowed) {
    return {
      status: "CONFLICT-ROBOTS",
      error: `${url} — masuk sitemap TAPI Disallow di robots.txt`,
    };
  }
  if (noindex && !robotsDisallowed && !isAuthGated) {
    return {
      status: "MISSING-ROBOTS",
      error: `${url} — noindex tetapi tidak Disallow di robots.txt`,
    };
  }
  if (isAuthGated) return { status: "auth-gated" };
  if (inSitemap) return { status: "sitemap" };
  if (noindex) return { status: "noindex" };
  if (allowlisted) return { status: "allowlist" };
  return {
    status: "MISSING",
    error: `${url} — tidak ada di sitemap & tidak noindex`,
  };
}

/**
 * Self-test: memastikan logika audit sendiri masih benar. Berjalan setiap
 * kali script dipanggil supaya regresi di classifier langsung menggagalkan
 * build — bukan menunggu scanner SEO menemukannya di produksi.
 */
function runSelfTests() {
  const cases = [
    {
      name: "/reset-password noindex + TIDAK di sitemap → noindex (ok)",
      input: { routeId: "/reset-password", url: "/reset-password", inSitemap: false, noindex: true, allowlisted: false, robotsDisallowed: true },
      expect: "noindex",
    },
    {
      name: "/reset-password di sitemap + noindex → CONFLICT",
      input: { routeId: "/reset-password", url: "/reset-password", inSitemap: true, noindex: true, allowlisted: false, robotsDisallowed: true },
      expect: "CONFLICT",
      expectError: true,
    },
    {
      name: "/forgot-password noindex + TIDAK di sitemap → noindex (ok)",
      input: { routeId: "/forgot-password", url: "/forgot-password", inSitemap: false, noindex: true, allowlisted: false, robotsDisallowed: true },
      expect: "noindex",
    },
    {
      name: "/forgot-password tanpa noindex & tanpa sitemap → MISSING",
      input: { routeId: "/forgot-password", url: "/forgot-password", inSitemap: false, noindex: false, allowlisted: false, robotsDisallowed: false },
      expect: "MISSING",
      expectError: true,
    },
    {
      name: "/forgot-password di sitemap + noindex → CONFLICT",
      input: { routeId: "/forgot-password", url: "/forgot-password", inSitemap: true, noindex: true, allowlisted: false, robotsDisallowed: true },
      expect: "CONFLICT",
      expectError: true,
    },
    {
      name: "/change-email noindex + TIDAK di sitemap → noindex (ok)",
      input: { routeId: "/change-email", url: "/change-email", inSitemap: false, noindex: true, allowlisted: false, robotsDisallowed: true },
      expect: "noindex",
    },
    {
      name: "/change-email tanpa noindex & tanpa sitemap → MISSING",
      input: { routeId: "/change-email", url: "/change-email", inSitemap: false, noindex: false, allowlisted: false, robotsDisallowed: false },
      expect: "MISSING",
      expectError: true,
    },
    {
      name: "/change-email di sitemap + noindex → CONFLICT",
      input: { routeId: "/change-email", url: "/change-email", inSitemap: true, noindex: true, allowlisted: false, robotsDisallowed: true },
      expect: "CONFLICT",
      expectError: true,
    },
    {
      name: "/change-email auth-gated tanpa sitemap → auth-gated (ok)",
      input: { routeId: "/_authenticated/change-email", url: "/change-email", inSitemap: false, noindex: false, allowlisted: false, robotsDisallowed: true },
      expect: "auth-gated",
    },
    {
      name: "/refund di sitemap tanpa noindex → sitemap (ok)",
      input: { routeId: "/refund", url: "/refund", inSitemap: true, noindex: false, allowlisted: false, robotsDisallowed: false },
      expect: "sitemap",
    },
    {
      name: "rute publik tanpa sitemap & tanpa noindex → MISSING",
      input: { routeId: "/foo", url: "/foo", inSitemap: false, noindex: false, allowlisted: false, robotsDisallowed: false },
      expect: "MISSING",
      expectError: true,
    },
    {
      name: "rute auth-gated tanpa sitemap → auth-gated (ok)",
      input: { routeId: "/_authenticated/audit", url: "/audit", inSitemap: false, noindex: false, allowlisted: false, robotsDisallowed: true },
      expect: "auth-gated",
    },
    {
      name: "rute dinamis dilewati",
      input: { routeId: "/t/$token", url: "/t/$token", inSitemap: false, noindex: false, allowlisted: false, robotsDisallowed: true },
      expect: "DYNAMIC (skip)",
    },
    {
      name: "sitemap TAPI Disallow di robots.txt → CONFLICT-ROBOTS",
      input: { routeId: "/refund", url: "/refund", inSitemap: true, noindex: false, allowlisted: false, robotsDisallowed: true },
      expect: "CONFLICT-ROBOTS",
      expectError: true,
    },
    {
      name: "noindex TAPI tidak Disallow → MISSING-ROBOTS",
      input: { routeId: "/forgot-password", url: "/forgot-password", inSitemap: false, noindex: true, allowlisted: false, robotsDisallowed: false },
      expect: "MISSING-ROBOTS",
      expectError: true,
    },
    {
      name: "noindex + Disallow → noindex (ok, konsisten)",
      input: { routeId: "/change-email", url: "/change-email", inSitemap: false, noindex: true, allowlisted: false, robotsDisallowed: true },
      expect: "noindex",
    },
  ];
  const failed = [];
  for (const c of cases) {
    const got = classifyRoute(c.input);
    const hasErr = Boolean(got.error);
    if (got.status !== c.expect || hasErr !== Boolean(c.expectError)) {
      failed.push(
        `  ✗ ${c.name}: expected status=${c.expect} error=${Boolean(c.expectError)}, got status=${got.status} error=${hasErr}`,
      );
    }
  }
  if (failed.length) {
    console.error("\n❌ SEO audit self-test gagal (classifier rusak):");
    for (const f of failed) console.error(f);
    process.exit(2);
  }
  runAutofixSelfTests();
}

function runAutofixSelfTests() {
  const failed = [];
  // add: sisipkan Disallow ke blok wildcard yang sudah ada.
  {
    const src = "User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: /sitemap.xml\n";
    const { text, applied } = applyRobotsFix(src, { add: ["/forgot-password"] });
    if (!text.includes("Disallow: /forgot-password") || !applied.added.includes("/forgot-password")) {
      failed.push("  ✗ add existing block: tidak menambahkan Disallow ke blok *");
    }
  }
  // add: buat blok baru bila belum ada wildcard.
  {
    const src = "User-agent: Googlebot\nAllow: /\n";
    const { text, applied } = applyRobotsFix(src, { add: ["/private"] });
    if (!/User-agent:\s*\*/i.test(text) || !applied.added.includes("/private")) {
      failed.push("  ✗ add no block: tidak membuat blok User-agent: *");
    }
  }
  // remove: hapus baris Disallow yang persis cocok.
  {
    const src = "User-agent: *\nDisallow: /refund\nDisallow: /admin\n";
    const { text, applied } = applyRobotsFix(src, { remove: ["/refund"] });
    if (/Disallow:\s*\/refund\b/.test(text) || !applied.removed.includes("/refund")) {
      failed.push("  ✗ remove exact: baris Disallow: /refund tidak dihapus");
    }
  }
  // remove: aturan prefix tidak dihapus otomatis → skip dengan alasan.
  {
    const src = "User-agent: *\nDisallow: /admin\n";
    const { applied } = applyRobotsFix(src, { remove: ["/admin/panel"] });
    if (!applied.skipped.some((s) => s.url === "/admin/panel")) {
      failed.push("  ✗ remove prefix: konflik prefix seharusnya dilewati (skipped)");
    }
  }
  if (failed.length) {
    console.error("\n❌ Autofix self-test gagal:");
    for (const f of failed) console.error(f);
    process.exit(2);
  }
}

function main() {
  runSelfTests();
  const argv = process.argv.slice(2);
  const doFix = argv.includes("--fix");
  const suggestOnly = argv.includes("--suggest") || (!doFix && argv.includes("--auto-fix"));
  // Default: audit murni. `--fix` = tulis perubahan ke disk. `--suggest`
  // (atau `--auto-fix` tanpa --fix) = cetak patch tanpa menulis.
  const sitemapPaths = readSitemapPaths();
  const robotsSrc = readFileSync(ROBOTS_FILE, "utf8");
  const robotsRules = extractRobotsDisallows(robotsSrc);
  const files = listRouteFiles(ROUTES_DIR);
  const rows = [];
  const errors = [];
  const fixAdd = new Set();
  const fixRemove = new Set();

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const id = extractRoutePath(src);
    if (!id) continue;
    const url = routeIdToUrl(id);
    const inSitemap = sitemapPaths.has(url);
    const noindex = hasNoindex(src);
    const allowlisted = ALLOWLIST_NO_SITEMAP.has(url);
    const robotsDisallowed = robotsMatches(url, robotsRules);
    const { status, error } = classifyRoute({
      routeId: id,
      url,
      inSitemap,
      noindex,
      allowlisted,
      robotsDisallowed,
    });
    if (error) errors.push(`  ${error} (${relative(ROOT, file)})`);
    if (status === "MISSING-ROBOTS") fixAdd.add(url);
    if (status === "CONFLICT-ROBOTS") fixRemove.add(url);
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

  // Auto-fix / suggest robots.txt bila terdeteksi konflik yang menyangkut
  // robots.txt (MISSING-ROBOTS / CONFLICT-ROBOTS).
  if (fixAdd.size || fixRemove.size) {
    const { text, applied } = applyRobotsFix(robotsSrc, {
      add: [...fixAdd],
      remove: [...fixRemove],
    });
    console.log("\n🛠  robots.txt auto-fix");
    if (applied.added.length) console.log(`   + Disallow: ${applied.added.join(", ")}`);
    if (applied.removed.length) console.log(`   - Disallow: ${applied.removed.join(", ")}`);
    for (const s of applied.skipped) {
      console.log(`   ⚠︎ skip ${s.op} ${s.url} — ${s.reason} (perbaiki manual)`);
    }
    if (doFix) {
      if (text !== robotsSrc) {
        writeFileSync(ROBOTS_FILE, text);
        console.log(`   ✅ ditulis ke ${relative(ROOT, ROBOTS_FILE)}`);
        // Anggap error yang otomatis-terselesaikan sebagai fixed.
        for (const url of applied.added) {
          const idx = errors.findIndex((e) => e.includes(`${url} — noindex tetapi tidak Disallow`));
          if (idx >= 0) errors.splice(idx, 1);
        }
        for (const url of applied.removed) {
          const idx = errors.findIndex((e) => e.includes(`${url} — masuk sitemap TAPI Disallow`));
          if (idx >= 0) errors.splice(idx, 1);
        }
      } else {
        console.log("   (tidak ada perubahan yang bisa diterapkan otomatis)");
      }
    } else if (suggestOnly) {
      console.log("   (mode --suggest — jalankan lagi dengan --fix untuk menulis perubahan)");
    } else {
      console.log("   Jalankan dengan `--fix` untuk menerapkan otomatis, atau `--suggest` untuk lihat patch.");
    }
  }

  if (errors.length) {
    console.error("\n❌ SEO audit gagal:");
    for (const e of errors) console.error(e);
    console.error(
      "\nPerbaiki dengan menambah rute ke sitemap (src/routes/sitemap[.]xml.ts), menambah meta robots noindex,nofollow di head() rute, atau jalankan `node scripts/audit-seo-routes.mjs --fix` untuk perbaiki robots.txt otomatis.",
    );
    process.exit(1);
  }
  console.log("\n✅ SEO audit lulus.");
}

// Hanya jalankan audit saat script di-invoke langsung (bukan saat di-import
// oleh test/self-check yang me-reuse classifier).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}