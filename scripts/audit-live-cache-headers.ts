/**
 * Verifikasi header Cache-Control aset brand pada situs live.
 *
 * Pakai:
 *   bun scripts/audit-live-cache-headers.ts                       # dev lokal
 *   bun scripts/audit-live-cache-headers.ts --base https://mcmstorage.app
 *   bun scripts/audit-live-cache-headers.ts --base <url> --pages /,/harga
 *
 * Selain aset brand statis, skrip membaca og:image dan og:image:secure_url
 * dari halaman yang disebut lalu memeriksa header gambar itu sendiri.
 */
import {
  BRAND_ASSET_PATTERNS,
  auditBrandCacheHeaders,
  formatBrandCacheAudit,
  ogImageUrlsFromHtml,
  type HeaderProbe,
} from "../src/lib/brand-cache-headers";
import { fetchPagesPooled, parseScanOptions } from "../src/lib/audit-scan-options";

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const base = (flag("base", "http://localhost:8080") as string).replace(/\/$/, "");
const pages = (flag("pages", "/,/harga") as string).split(",").filter(Boolean);
const scan = parseScanOptions(args, process.env);

const abs = (u: string) => (u.startsWith("http") ? u : `${base}${u.startsWith("/") ? u : `/${u}`}`);

// 1) Aset brand statis (pola tanpa wildcard bisa diprobe langsung).
const staticAssets = BRAND_ASSET_PATTERNS.filter((p) => !p.includes("*")).map(abs);

// 2) og:image dari halaman publik.
const html = await fetchPagesPooled(pages.map(abs), scan);
// og:image selalu absolut ke domain produksi; saat mengaudit base lain
// (dev/preview) pathnya dipetakan ke base tersebut agar yang diuji benar.
const toBase = (u: string) => {
  try {
    const parsed = new URL(u, base);
    return `${base}${parsed.pathname}${parsed.search}`;
  } catch {
    return abs(u);
  }
};
const ogUrls = [...new Set(html.flatMap((p) => ogImageUrlsFromHtml(p.html)))].map(toBase);
if (!ogUrls.length) console.log("⚠ tidak ada og:image ditemukan pada halaman contoh.");

const targets = [...new Set([...staticAssets, ...ogUrls])];
console.log(`Memeriksa ${targets.length} URL aset brand di ${base} …`);

const probes: HeaderProbe[] = await Promise.all(
  targets.map(async (url): Promise<HeaderProbe> => {
    try {
      const res = await fetch(url, { method: "GET", headers: { "user-agent": "AceStorageCacheAudit/1.0" } });
      return {
        url,
        status: res.status,
        cacheControl: res.headers.get("cache-control"),
        contentType: res.headers.get("content-type"),
      };
    } catch {
      return { url, status: 599, cacheControl: null, contentType: null };
    }
  }),
);

const report = auditBrandCacheHeaders(probes);
console.log(formatBrandCacheAudit(report));
if (!report.ok) process.exit(1);
