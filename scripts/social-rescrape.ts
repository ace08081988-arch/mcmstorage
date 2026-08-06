/**
 * Paksa refresh pratinjau tautan setelah publish / ganti og:image.
 *
 * Pakai:
 *   bun scripts/social-rescrape.ts                          # semua URL sitemap (maks 20)
 *   bun scripts/social-rescrape.ts --base https://mcmstorage.app
 *   bun scripts/social-rescrape.ts / /harga /katalog/toko
 *   bun scripts/social-rescrape.ts --limit 5 --platforms facebook,twitter
 *
 * Env opsional:
 *   FACEBOOK_GRAPH_TOKEN — access token app Facebook. Bila ada, cache
 *   Facebook/WhatsApp benar-benar dibuang (scrape=true). Tanpa token, skrip
 *   hanya melakukan warm-up crawler dan mencetak tautan debugger manual.
 */
import {
  formatRescrapeReport,
  rescrapeUrls,
  selectRescrapeUrls,
  urlsFromSitemapXml,
  type RescrapePlatform,
} from "../src/lib/social-rescrape";
import { SITE_URL } from "../src/lib/seo-meta";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
};
const base = (flag("base") ?? SITE_URL).replace(/\/$/, "");
const limit = Number(flag("limit") ?? 20);
const platforms = (flag("platforms")?.split(",").filter(Boolean) as RescrapePlatform[]) ?? undefined;
const explicit = args.filter((a, i) => {
  if (a.startsWith("--")) return false;
  const prev = args[i - 1];
  return !(prev === "--base" || prev === "--limit" || prev === "--platforms");
});

const abs = (u: string) => (u.startsWith("http") ? u : `${base}${u.startsWith("/") ? u : `/${u}`}`);

async function collect(): Promise<string[]> {
  if (explicit.length) return explicit.map(abs);
  const res = await fetch(abs("/sitemap.xml"));
  if (!res.ok) throw new Error(`gagal membaca sitemap.xml (${res.status})`);
  const urls = urlsFromSitemapXml(await res.text()).map((u) => {
    try {
      return abs(new URL(u).pathname);
    } catch {
      return abs(u);
    }
  });
  return selectRescrapeUrls(urls, limit);
}

const token = process.env["FACEBOOK_GRAPH_TOKEN"];
if (!token) {
  console.warn(
    "⚠ FACEBOOK_GRAPH_TOKEN belum diset — Facebook/WhatsApp hanya di-warm-up, bukan dibuang cache-nya.\n",
  );
}

const urls = await collect();
const report = await rescrapeUrls(urls, {
  facebookToken: token,
  ...(platforms ? { platforms } : {}),
});
console.log(formatRescrapeReport(report));
if (!report.ok) process.exit(1);