/**
 * Validasi pra-deploy: og:image tiap route wajib PNG 1200×630 dan HTTP 200.
 *
 * Pakai:
 *   bun scripts/audit-og-image.ts                                # dev server lokal (sitemap)
 *   bun scripts/audit-og-image.ts --base https://mcmstorage.app
 *   bun scripts/audit-og-image.ts /harga /produk                 # route eksplisit
 *
 * Byte gambar benar-benar diunduh (hanya header) lalu dibaca formatnya, jadi
 * tag width/height yang keliru tetap ketahuan. Pengecualian per-route diambil
 * dari `seo-audit.policy.json` (mis. foto produk katalog yang bukan PNG).
 */
import { parseHead, urlsFromSitemap, selectAuditUrls } from "../src/lib/rendered-head-audit";
import { formatOgImageReport, validateOgImages, type OgImageFetch } from "../src/lib/og-image-validate";
import { loadAuditPolicy } from "../src/lib/seo-audit-policy.load";
import { formatPolicy, resolvePolicy } from "../src/lib/seo-audit-policy";
import {
  SCAN_FLAGS_WITH_VALUE,
  capUrls,
  fetchPagesPooled,
  formatScanOptions,
  parseScanOptions,
} from "../src/lib/audit-scan-options";

const args = process.argv.slice(2);
const valueOf = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 ? args[i + 1] : undefined;
};
const base = (valueOf("base") ?? process.env["AUDIT_BASE"] ?? "http://localhost:8080").replace(/\/$/, "");
const scan = parseScanOptions(args, process.env);
const FLAGS_WITH_VALUE = new Set(["--base", "--include", "--exclude", ...SCAN_FLAGS_WITH_VALUE]);
const listFlag = (n: string) => valueOf(n)?.split(",").filter(Boolean);
const explicit = args.filter((a, i) => !a.startsWith("--") && !FLAGS_WITH_VALUE.has(args[i - 1] ?? ""));

const filePolicy = loadAuditPolicy();
const policy = resolvePolicy({
  ...filePolicy,
  include: listFlag("include") ?? filePolicy.include,
  exclude: listFlag("exclude") ?? filePolicy.exclude,
});

const abs = (u: string) => (u.startsWith("http") ? u : `${base}${u.startsWith("/") ? u : `/${u}`}`);

async function collectUrls(): Promise<string[]> {
  if (explicit.length) return explicit.map(abs);
  const res = await fetch(abs("/sitemap.xml"));
  if (!res.ok) throw new Error(`gagal membaca sitemap.xml (${res.status})`);
  const urls = urlsFromSitemap(await res.text()).map((u) => {
    try {
      return abs(new URL(u).pathname);
    } catch {
      return abs(u);
    }
  });
  return selectAuditUrls(urls, { perDynamicPattern: scan.perDynamicPattern, policy });
}

/** Unduh header berkas gambar (64KB pertama sudah cukup untuk semua format). */
async function fetchImageHead(routeUrl: string, imageUrl: string): Promise<OgImageFetch> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), scan.timeoutMs);
  try {
    const res = await fetch(imageUrl, {
      headers: { "user-agent": "AceStorageOgImageAudit/1.0", range: "bytes=0-65535" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    return {
      routeUrl,
      imageUrl,
      // 206 Partial Content tetap berarti sumbernya sehat.
      status: res.status === 206 ? 200 : res.status,
      contentType: res.headers.get("content-type"),
      bytes: buf,
    };
  } catch (e) {
    return { routeUrl, imageUrl, status: 599, contentType: null, bytes: null };
  } finally {
    clearTimeout(timer);
  }
}

console.log(`Validasi og:image — base ${base}`);
console.log(`Kebijakan audit — ${formatPolicy(policy)}`);
console.log(`Pemindaian — ${formatScanOptions(scan)}`);

const all = await collectUrls();
const { urls, dropped } = capUrls(all, scan.maxUrls);
if (dropped.length) console.log(`↷ ${dropped.length} URL di luar --max-urls (${scan.maxUrls}).`);

const pages = await fetchPagesPooled(urls, scan);
console.log(`↳ ${pages.length} route diambil.`);

const cache = new Map<string, Promise<OgImageFetch>>();
const fetched = await Promise.all(
  pages.map(async (p) => {
    const img = parseHead(p.html).meta["og:image"] ?? null;
    if (!img) return { routeUrl: p.url, imageUrl: null, status: 0 } satisfies OgImageFetch;
    const absImg = abs(img);
    if (!cache.has(absImg)) cache.set(absImg, fetchImageHead(p.url, absImg));
    const shared = await cache.get(absImg)!;
    return { ...shared, routeUrl: p.url, imageUrl: absImg };
  }),
);
console.log(`↳ ${cache.size} berkas og:image unik diperiksa.`);

const report = validateOgImages(fetched, policy);
console.log(formatOgImageReport(report));
if (!report.ok) process.exit(1);
