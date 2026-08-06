/**
 * Uji pratinjau WhatsApp otomatis sebelum publish.
 *
 * Pakai:
 *   bun scripts/audit-wa-preview.ts                                  # dev server lokal (sitemap)
 *   bun scripts/audit-wa-preview.ts --base https://mcmstorage.app
 *   bun scripts/audit-wa-preview.ts /katalog/toko /katalog/toko/123  # URL target eksplisit
 *   bun scripts/audit-wa-preview.ts --strict                         # peringatan ikut menggagalkan
 *
 * Memeriksa untuk tiap URL: og:image (ada, absolut https, bisa diambil,
 * tipe & ukuran berkas), dimensi og:image:width/height + rasio 1.91:1,
 * canonical self-referensial + og:url selaras, dan cache-buster pada og:image.
 */
import {
  auditWaPreviews,
  formatWaPreviewReport,
  type WaImageProbe,
} from "../src/lib/wa-preview-audit";
import { parseHead, urlsFromSitemap, selectAuditUrls } from "../src/lib/rendered-head-audit";
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
const valueOf = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
};
const base = (valueOf("base") ?? process.env["AUDIT_BASE"] ?? "http://localhost:8080").replace(/\/$/, "");
const strict = args.includes("--strict");
const scan = parseScanOptions(args, process.env);

const FLAGS_WITH_VALUE = new Set(["--base", "--include", "--exclude", ...SCAN_FLAGS_WITH_VALUE]);
const listFlag = (name: string): string[] | undefined => {
  const v = valueOf(name);
  return v ? v.split(",").filter(Boolean) : undefined;
};
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

/** Ambil header gambar seperti crawler WA (HEAD, fallback GET Range). */
async function probeImage(url: string): Promise<WaImageProbe> {
  const headers = { "user-agent": "WhatsApp/2.24 AceStoragePreviewAudit/1.0" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), scan.timeoutMs);
  try {
    let res = await fetch(url, { method: "HEAD", headers, redirect: "follow", signal: ctrl.signal });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: "GET",
        headers: { ...headers, range: "bytes=0-2048" },
        redirect: "follow",
        signal: ctrl.signal,
      });
    }
    const len = res.headers.get("content-range")?.split("/")[1] ?? res.headers.get("content-length");
    return {
      url,
      status: res.status,
      contentType: res.headers.get("content-type"),
      contentLength: len ? Number(len) : null,
      finalUrl: res.url,
    };
  } catch {
    return { url, status: 599, contentType: null, contentLength: null };
  } finally {
    clearTimeout(timer);
  }
}

console.log(`Pratinjau WA — base ${base}`);
console.log(`Kebijakan audit — ${formatPolicy(policy)}`);
console.log(`Pemindaian — ${formatScanOptions(scan)}`);

const all = await collectUrls();
const { urls, dropped } = capUrls(all, scan.maxUrls);
if (dropped.length) console.log(`↷ ${dropped.length} URL di luar --max-urls (${scan.maxUrls}).`);

const pages = await fetchPagesPooled(urls, scan);
console.log(`↳ ${pages.length} URL diambil.`);

const imageUrls = [
  ...new Set(
    pages
      .map((p) => parseHead(p.html).meta["og:image"])
      .filter((u): u is string => Boolean(u) && /^https?:\/\//i.test(u)),
  ),
];
const probeList = await Promise.all(imageUrls.map(probeImage));
const probes = Object.fromEntries(probeList.map((p) => [p.url, p]));
console.log(`↳ ${probeList.length} og:image diperiksa.`);

const report = auditWaPreviews(pages, probes, base);
console.log(formatWaPreviewReport(report));

if (!report.ok || (strict && report.warnings.length)) process.exit(1);
