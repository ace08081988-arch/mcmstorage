/**
 * Audit tag head untuk URL nyata (termasuk rute dinamis & halaman produk).
 *
 * Pakai:
 *   bun scripts/audit-rendered-head.ts                       # dev server lokal
 *   bun scripts/audit-rendered-head.ts --base https://mcmstorage.app
 *   bun scripts/audit-rendered-head.ts /katalog/toko/123 /harga
 *   bun scripts/audit-rendered-head.ts --include "/katalog/**" --exclude "/harga"
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

const args = process.argv.slice(2);
const baseIdx = args.indexOf("--base");
const base = baseIdx !== -1 ? args[baseIdx + 1] : "http://localhost:8080";
const perIdx = args.indexOf("--per-pattern");
const perDynamicPattern = perIdx !== -1 ? Number(args[perIdx + 1]) : 3;
const listFlag = (name: string): string[] | undefined => {
  const out: string[] = [];
  args.forEach((a, i) => {
    if (a === `--${name}` && args[i + 1]) out.push(...args[i + 1].split(",").filter(Boolean));
  });
  return out.length ? out : undefined;
};
const FLAGS_WITH_VALUE = new Set(["--base", "--per-pattern", "--include", "--exclude"]);
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

const urls = await collectUrls();
const pages = await Promise.all(
  urls.map(async (url) => {
    try {
      const res = await fetch(url, { headers: { "user-agent": "AceStorageHeadAudit/1.0" } });
      return { url, html: await res.text(), status: res.status };
    } catch {
      return { url, html: "", status: 599 };
    }
  }),
);

const report = auditRenderedPages(pages, base, policy);
if (report.skipped.length) {
  console.log(`↷ ${report.skipped.length} URL dilewati kebijakan: ${report.skipped.join(", ")}`);
}
console.log(formatRenderedHeadAudit(report));
if (!report.ok) process.exit(1);
