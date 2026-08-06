/**
 * Audit tag head untuk URL nyata (termasuk rute dinamis & halaman produk).
 *
 * Pakai:
 *   bun scripts/audit-rendered-head.ts                       # dev server lokal
 *   bun scripts/audit-rendered-head.ts --base https://mcmstorage.app
 *   bun scripts/audit-rendered-head.ts /katalog/toko/123 /harga
 *   bun scripts/audit-rendered-head.ts --include "/katalog/**" --exclude "/harga"
 *   bun scripts/audit-rendered-head.ts --max-urls 20 --timeout 8000 --concurrency 8 --retries 2
 *
 * Semua parameter pemindaian juga bisa lewat env: AUDIT_MAX_URLS, AUDIT_TIMEOUT_MS,
 * AUDIT_CONCURRENCY, AUDIT_RETRIES, AUDIT_PER_PATTERN.
 *
 * Whitelist/blacklist default dibaca dari `seo-audit.policy.json` (bila ada);
 * flag --include/--exclude menimpanya untuk satu kali jalan.
 *
 * Tanpa daftar URL eksplisit, skrip membaca `sitemap.xml` dari base URL dan
 * memilih semua rute statis plus beberapa contoh per pola dinamis.
 */
import {
  auditRenderedPages,
  formatRenderedHeadAudit,
  selectAuditUrls,
  urlsFromSitemap,
} from "../src/lib/rendered-head-audit";
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
const baseIdx = args.indexOf("--base");
const base = baseIdx !== -1 ? args[baseIdx + 1] : "http://localhost:8080";
const scan = parseScanOptions(args, process.env);
const { perDynamicPattern } = scan;
const listFlag = (name: string): string[] | undefined => {
  const out: string[] = [];
  args.forEach((a, i) => {
    if (a === `--${name}` && args[i + 1]) out.push(...args[i + 1].split(",").filter(Boolean));
  });
  return out.length ? out : undefined;
};
const FLAGS_WITH_VALUE = new Set(["--base", "--include", "--exclude", ...SCAN_FLAGS_WITH_VALUE]);
const explicit = args.filter((a, i) => {
  if (a.startsWith("--")) return false;
  if (FLAGS_WITH_VALUE.has(args[i - 1] ?? "")) return false;
  return true;
});

const filePolicy = loadAuditPolicy();
const policy = resolvePolicy({
  ...filePolicy,
  include: listFlag("include") ?? filePolicy.include,
  exclude: listFlag("exclude") ?? filePolicy.exclude,
});
console.log(`Kebijakan audit — ${formatPolicy(policy)}`);
console.log(`Pemindaian — ${formatScanOptions(scan)}`);

function abs(u: string): string {
  return u.startsWith("http") ? u : `${base.replace(/\/$/, "")}${u.startsWith("/") ? u : `/${u}`}`;
}

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
  return selectAuditUrls(urls, { perDynamicPattern, policy });
}

const allUrls = await collectUrls();
const { urls, dropped } = capUrls(allUrls, scan.maxUrls);
if (dropped.length) {
  console.log(`↷ ${dropped.length} URL di luar batas --max-urls (${scan.maxUrls}) tidak diperiksa.`);
}
const started = Date.now();
const pages = await fetchPagesPooled(urls, scan);
console.log(`↳ ${pages.length} URL diambil dalam ${Date.now() - started}ms.`);

const report = auditRenderedPages(pages, base, policy);
if (report.skipped.length) {
  console.log(`↷ ${report.skipped.length} URL dilewati kebijakan: ${report.skipped.join(", ")}`);
}
console.log(formatRenderedHeadAudit(report));
if (!report.ok) process.exit(1);
