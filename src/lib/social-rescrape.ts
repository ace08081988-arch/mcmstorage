/**
 * Mekanisme rescrape otomatis pratinjau tautan sosial.
 *
 * Masalah: setelah `og:image` berubah (atau cache-buster versinya dinaikkan),
 * Facebook/WhatsApp dan X tetap menyajikan kartu lama sampai crawler mereka
 * mengunjungi ulang halamannya — bisa berhari-hari. Modul ini memaksa
 * kunjungan itu terjadi segera setelah publish:
 *
 *  - **Facebook/WhatsApp**: Graph API `POST /?id=<url>&scrape=true` benar-benar
 *    membuang cache dan mengambil ulang tag head (butuh access token app).
 *    WhatsApp memakai cache pratinjau Facebook, jadi ikut segar.
 *  - **X/Twitter**: tidak ada API rescrape publik; yang efektif adalah
 *    memanggil halaman dengan UA `Twitterbot` sehingga kartu diperbarui saat
 *    Twitterbot memvalidasi ulang.
 *  - **LinkedIn/Telegram**: warm-up dengan UA masing-masing.
 *
 * Murni tanpa I/O global: `fetch` disuntikkan supaya bisa diuji.
 */
import { BRAND_ASSET_VERSION } from "./asset-version";
import { SITE_URL } from "./seo-meta";

export type RescrapePlatform = "facebook" | "twitter" | "linkedin" | "telegram";

export const CRAWLER_USER_AGENTS: Record<Exclude<RescrapePlatform, "facebook">, string> = {
  twitter: "Twitterbot/1.0",
  linkedin: "LinkedInBot/1.0 (+https://www.linkedin.com)",
  telegram: "TelegramBot (like TwitterBot)",
};

/** UA resmi crawler Facebook — dipakai untuk warm-up saat token tidak ada. */
export const FACEBOOK_USER_AGENT =
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

export type RescrapeResult = {
  url: string;
  platform: RescrapePlatform;
  ok: boolean;
  status?: number;
  /** "graph" = rescrape sungguhan, "warm" = kunjungan crawler-UA. */
  method: "graph" | "warm";
  /** og:image yang dilihat crawler setelah rescrape (bila terbaca). */
  image?: string;
  error?: string;
};

export type RescrapeReport = {
  ok: boolean;
  version: string;
  results: RescrapeResult[];
  /** Tautan manual bila ada yang gagal / tidak bisa otomatis. */
  manual: { url: string; facebook: string; twitter: string; linkedin: string }[];
};

type FetchLike = typeof fetch;

export function absolute(url: string, base = SITE_URL): string {
  if (url.startsWith("http")) return url;
  return `${base.replace(/\/$/, "")}${url.startsWith("/") ? url : `/${url}`}`;
}

/** Tautan debugger manual — selalu berguna untuk verifikasi mata. */
export function debuggerLinks(url: string) {
  const enc = encodeURIComponent(url);
  return {
    url,
    facebook: `https://developers.facebook.com/tools/debug/?q=${enc}`,
    twitter: `https://cards-dev.twitter.com/validator?url=${enc}`,
    linkedin: `https://www.linkedin.com/post-inspector/inspect/${enc}`,
  };
}

/** Ambil `og:image` dari HTML mentah (untuk laporan verifikasi). */
export function extractOgImage(html: string): string | undefined {
  const m =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return m?.[1];
}

/** Endpoint Graph API untuk memaksa rescrape sebuah URL. */
export function facebookScrapeEndpoint(url: string, token: string, version = "v21.0"): string {
  return `https://graph.facebook.com/${version}/?id=${encodeURIComponent(url)}&scrape=true&access_token=${encodeURIComponent(token)}`;
}

async function rescrapeFacebook(
  url: string,
  token: string | undefined,
  fetchImpl: FetchLike,
): Promise<RescrapeResult> {
  if (!token) {
    // Tanpa token: warm-up dengan UA facebookexternalhit. Tidak membuang cache,
    // tapi mempercepat refresh saat TTL cache habis.
    return warm(url, "facebook", FACEBOOK_USER_AGENT, fetchImpl);
  }
  try {
    const res = await fetchImpl(facebookScrapeEndpoint(url, token), { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as {
      image?: { url: string }[];
      error?: { message?: string };
    };
    return {
      url,
      platform: "facebook",
      method: "graph",
      ok: res.ok && !body?.error,
      status: res.status,
      ...(body?.image?.[0]?.url ? { image: body.image[0].url } : {}),
      ...(body?.error?.message ? { error: body.error.message } : {}),
    };
  } catch (e) {
    return {
      url,
      platform: "facebook",
      method: "graph",
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function warm(
  url: string,
  platform: RescrapePlatform,
  ua: string,
  fetchImpl: FetchLike,
): Promise<RescrapeResult> {
  try {
    const res = await fetchImpl(url, {
      headers: { "user-agent": ua, "cache-control": "no-cache" },
    });
    const html = await res.text().catch(() => "");
    const image = extractOgImage(html);
    return {
      url,
      platform,
      method: "warm",
      ok: res.ok,
      status: res.status,
      ...(image ? { image } : {}),
    };
  } catch (e) {
    return {
      url,
      platform,
      method: "warm",
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export type RescrapeOptions = {
  /** Access token app Facebook (`FACEBOOK_GRAPH_TOKEN`). Opsional. */
  facebookToken?: string | undefined;
  platforms?: RescrapePlatform[];
  fetchImpl?: FetchLike;
  version?: string;
};

/** Jalankan rescrape untuk sekumpulan URL di semua platform yang diminta. */
export async function rescrapeUrls(
  urls: string[],
  opts: RescrapeOptions = {},
): Promise<RescrapeReport> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const platforms = opts.platforms ?? (["facebook", "twitter", "linkedin", "telegram"] as const);
  const targets = urls.map((u) => absolute(u));
  const results: RescrapeResult[] = [];
  for (const url of targets) {
    for (const platform of platforms) {
      results.push(
        platform === "facebook"
          ? await rescrapeFacebook(url, opts.facebookToken, fetchImpl)
          : await warm(url, platform, CRAWLER_USER_AGENTS[platform], fetchImpl),
      );
    }
  }
  const failed = new Set(results.filter((r) => !r.ok).map((r) => r.url));
  return {
    ok: results.every((r) => r.ok),
    version: opts.version ?? BRAND_ASSET_VERSION,
    results,
    manual: [...failed].map(debuggerLinks),
  };
}

/** Laporan ringkas untuk CLI/CI. */
export function formatRescrapeReport(report: RescrapeReport): string {
  const lines = [`Rescrape sosial (versi aset ${report.version})`, ""];
  const byUrl = new Map<string, RescrapeResult[]>();
  for (const r of report.results) {
    const list = byUrl.get(r.url) ?? [];
    list.push(r);
    byUrl.set(r.url, list);
  }
  for (const [url, list] of byUrl) {
    lines.push(url);
    for (const r of list) {
      const mark = r.ok ? "✓" : "✗";
      const detail = r.error ? ` — ${r.error}` : r.image ? ` — og:image ${r.image}` : "";
      lines.push(`  ${mark} ${r.platform} (${r.method}, ${r.status ?? "-"})${detail}`);
    }
  }
  if (report.manual.length) {
    lines.push("", "Perlu verifikasi manual:");
    for (const m of report.manual) {
      lines.push(`  ${m.url}`, `    FB: ${m.facebook}`, `    X : ${m.twitter}`);
    }
  }
  lines.push("", report.ok ? "OK — semua crawler merespons." : "GAGAL — lihat detail di atas.");
  return lines.join("\n");
}

/** Ambil daftar URL publik dari sitemap.xml (dipakai CLI & webhook). */
export function urlsFromSitemapXml(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
}

/**
 * Batasi jumlah URL yang di-rescrape: beranda + rute statis penting, lalu
 * beberapa contoh halaman dinamis. Graph API punya rate limit, jadi jangan
 * kirim ratusan URL sekaligus.
 */
export function selectRescrapeUrls(urls: string[], limit = 20): string[] {
  const uniq = [...new Set(urls)];
  const depth = (u: string) => {
    try {
      return new URL(u).pathname.split("/").filter(Boolean).length;
    } catch {
      return 99;
    }
  };
  return uniq.sort((a, b) => depth(a) - depth(b) || a.localeCompare(b)).slice(0, limit);
}