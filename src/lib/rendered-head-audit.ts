/**
 * Audit tag head pada HTML yang benar-benar dirender, untuk URL konkret —
 * termasuk rute dinamis seperti `/katalog/$slug` dan halaman produk
 * `/katalog/$slug/$itemId`.
 *
 * Audit statis (`route-seo-audit`) hanya bisa memastikan sebuah rute
 * *mendeklarasikan* head(); ia tidak tahu apakah nilai yang dihasilkan loader
 * benar (judul produk kosong, canonical menunjuk induk, og:image relatif, dsb).
 * Modul ini menutup celah itu dengan memeriksa HTML hasil render per-URL.
 *
 * Murni tanpa I/O: pemanggil (skrip CI / test) yang mengambil HTML-nya.
 */
import { SITE_URL } from "./seo-meta";

export type RenderedPage = {
  /** URL yang diminta, absolut atau path (mis. "/katalog/toko/123"). */
  url: string;
  html: string;
  /** Status HTTP, bila tersedia. */
  status?: number;
};

export type RenderedHeadIssueId =
  | "http"
  | "title"
  | "title-generic"
  | "description"
  | "og:title"
  | "og:description"
  | "og:image"
  | "og:image-absolute"
  | "og:image:secure_url"
  | "og:image:width"
  | "og:image:height"
  | "og:image:type"
  | "og:url"
  | "twitter:card"
  | "canonical"
  | "canonical-self";

export type RenderedHeadIssue = {
  url: string;
  id: RenderedHeadIssueId;
  message: string;
};

export type RenderedHeadReport = {
  ok: boolean;
  checked: string[];
  issues: RenderedHeadIssue[];
};

/** Judul default root yang tidak boleh bocor ke halaman dinamis. */
const GENERIC_TITLES = [
  "Ace Storage",
  "Lovable App",
  "Lovable Generated Project",
  "Ace Storage — Ace Storage",
];

function headOf(html: string): string {
  const m = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  return m ? m[1] : html;
}

export function parseHead(html: string): {
  title: string | null;
  meta: Record<string, string>;
  canonical: string | null;
  robots: string | null;
} {
  const head = headOf(html);
  const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null;

  const meta: Record<string, string> = {};
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const key =
      tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1] ??
      tag.match(/\bitemprop\s*=\s*["']([^"']+)["']/i)?.[1];
    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1];
    if (key && content !== undefined && meta[key] === undefined) meta[key] = content;
  }

  let canonical: string | null = null;
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    if (/\brel\s*=\s*["']canonical["']/i.test(tag)) {
      canonical = tag.match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1] ?? null;
      break;
    }
  }

  return { title, meta, canonical, robots: meta["robots"] ?? null };
}

/** Samakan bentuk URL agar perbandingan canonical/og:url tidak palsu-gagal. */
export function normalizeUrl(url: string, base = SITE_URL): string {
  const abs = url.startsWith("http") ? url : `${base}${url.startsWith("/") ? url : `/${url}`}`;
  try {
    const u = new URL(abs);
    u.hash = "";
    u.search = "";
    u.protocol = "https:";
    u.host = new URL(base).host;
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString().replace(/\/$/, "") || u.origin;
  } catch {
    return abs;
  }
}

export function auditRenderedPage(page: RenderedPage, base = SITE_URL): RenderedHeadIssue[] {
  const issues: RenderedHeadIssue[] = [];
  const url = page.url;
  const add = (id: RenderedHeadIssueId, message: string) => issues.push({ url, id, message });

  if (page.status !== undefined && (page.status < 200 || page.status >= 400)) {
    add("http", `status HTTP ${page.status} — halaman tidak bisa dirayapi`);
    return issues;
  }

  const { title, meta, canonical, robots } = parseHead(page.html);
  const noindex = !!robots && /noindex/i.test(robots);

  if (!title) add("title", "<title> kosong");
  else if (GENERIC_TITLES.includes(title))
    add("title-generic", `judul "${title}" masih judul default root, bukan judul halaman ini`);

  if (!meta["description"]?.trim()) add("description", "meta description kosong");

  if (noindex) return issues;

  if (!meta["og:title"]?.trim()) add("og:title", "og:title kosong");
  if (!meta["og:description"]?.trim()) add("og:description", "og:description kosong");
  if (!meta["twitter:card"]?.trim()) add("twitter:card", "twitter:card kosong");

  const image = meta["og:image"];
  if (!image?.trim()) add("og:image", "og:image kosong");
  else if (!/^https?:\/\//i.test(image))
    add("og:image-absolute", `og:image "${image}" harus URL absolut agar crawler bisa memuatnya`);
  else {
    const secure = meta["og:image:secure_url"];
    if (!secure?.trim()) add("og:image:secure_url", "og:image:secure_url kosong");
    else if (!/^https:\/\//i.test(secure))
      add("og:image:secure_url", `og:image:secure_url "${secure}" harus memakai https`);
    else if (secure !== image)
      add(
        "og:image:secure_url",
        `og:image:secure_url "${secure}" ≠ og:image "${image}" — termasuk versi cache-buster`,
      );

    const width = Number(meta["og:image:width"]);
    const height = Number(meta["og:image:height"]);
    if (!Number.isFinite(width) || width < 200)
      add("og:image:width", `og:image:width "${meta["og:image:width"] ?? ""}" tidak valid (≥200)`);
    if (!Number.isFinite(height) || height < 200)
      add(
        "og:image:height",
        `og:image:height "${meta["og:image:height"] ?? ""}" tidak valid (≥200)`,
      );

    const type = meta["og:image:type"];
    if (!type || !/^image\/(png|jpeg|jpg|webp)$/i.test(type))
      add("og:image:type", `og:image:type "${type ?? ""}" tidak valid (image/png|jpeg|webp)`);
  }

  const expected = normalizeUrl(url, base);
  if (!canonical) add("canonical", "link rel=canonical tidak ada");
  else if (normalizeUrl(canonical, base) !== expected)
    add(
      "canonical-self",
      `canonical "${canonical}" ≠ URL halaman "${expected}" — harus self-referensial`,
    );

  const ogUrl = meta["og:url"];
  if (ogUrl && normalizeUrl(ogUrl, base) !== expected)
    add("og:url", `og:url "${ogUrl}" ≠ URL halaman "${expected}"`);

  return issues;
}

export function auditRenderedPages(pages: RenderedPage[], base = SITE_URL): RenderedHeadReport {
  const issues = pages.flatMap((p) => auditRenderedPage(p, base));
  return { ok: issues.length === 0, checked: pages.map((p) => p.url), issues };
}

/** Ambil daftar <loc> dari sitemap.xml untuk dijadikan target audit. */
export function urlsFromSitemap(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
}

/**
 * Pilih himpunan URL yang relevan: semua rute statis, plus contoh untuk tiap
 * pola dinamis (satu katalog toko + beberapa halaman produk), supaya audit
 * tetap cepat walau sitemap berisi ratusan produk.
 */
export function selectAuditUrls(
  urls: string[],
  opts: { perDynamicPattern?: number } = {},
): string[] {
  const perPattern = opts.perDynamicPattern ?? 3;
  const seen = new Map<string, string[]>();
  for (const u of urls) {
    let path: string;
    try {
      path = new URL(u, SITE_URL).pathname;
    } catch {
      continue;
    }
    const segs = path.split("/").filter(Boolean);
    // Pola: dua segmen pertama statis, sisanya dianggap dinamis.
    const pattern =
      segs.length <= 1 ? path || "/" : `/${segs[0]}/${segs.slice(1).map(() => "*").join("/")}`;
    const bucket = seen.get(pattern) ?? [];
    if (bucket.length < (segs.length <= 1 ? 1 : perPattern)) bucket.push(u);
    seen.set(pattern, bucket);
  }
  return [...seen.values()].flat();
}

export function formatRenderedHeadAudit(report: RenderedHeadReport): string {
  if (report.ok) return `Head URL OK — ${report.checked.length} URL diperiksa.`;
  return [
    `Head URL: ${report.issues.length} masalah pada ${report.checked.length} URL.`,
    ...report.issues.map((i) => `  • ${i.url} — ${i.id}: ${i.message}`),
  ].join("\n");
}