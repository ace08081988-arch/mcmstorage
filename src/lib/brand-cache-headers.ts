/**
 * Header cache untuk aset brand (ikon, manifest, kartu OG).
 *
 * `public/_headers` hanya dihormati oleh sebagian host; di lingkungan kita
 * berkas itu ikut ter-deploy sebagai file biasa sehingga aturannya tidak
 * pernah diterapkan. Karena itu header no-cache dipasang ulang di lapisan
 * worker (src/server.ts) untuk setiap permintaan aset brand yang lewat.
 *
 * Tujuan: pratinjau WhatsApp/X (og:image + og:image:secure_url), favicon,
 * dan launcher PWA tidak tersangkut versi lama setelah publish.
 */

export const BRAND_CACHE_CONTROL = "no-cache, must-revalidate";

/** Pola path aset brand yang wajib no-cache (glob sederhana: `*`). */
export const BRAND_ASSET_PATTERNS = [
  "/manifest.webmanifest",
  "/manifest-chat.webmanifest",
  "/browserconfig.xml",
  "/mask-icon.svg",
  "/favicon.ico",
  "/favicon-*.png",
  "/apple-touch-icon.png",
  "/icon-*.png",
  "/mstile-*.png",
  "/og-ace-storage.png",
  "/og-image.jpg",
];

/** Content-Type eksplisit untuk berkas yang sering salah ditebak host. */
export const BRAND_CONTENT_TYPES: Record<string, string> = {
  "/manifest.webmanifest": "application/manifest+json; charset=utf-8",
  "/manifest-chat.webmanifest": "application/manifest+json; charset=utf-8",
  "/browserconfig.xml": "application/xml; charset=utf-8",
};

function matches(pattern: string, path: string): boolean {
  if (!pattern.includes("*")) return pattern === path;
  const rx = new RegExp(
    `^${pattern.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}$`,
  );
  return rx.test(path);
}

/** Apakah path (tanpa query) termasuk aset brand yang harus no-cache. */
export function isBrandAssetPath(pathname: string): boolean {
  return BRAND_ASSET_PATTERNS.some((p) => matches(p, pathname));
}

/** Ambil pathname dari URL apa pun (query `?v=` diabaikan). */
export function pathnameOf(url: string): string {
  try {
    return new URL(url, "https://x.invalid").pathname;
  } catch {
    return url.split("?")[0] ?? url;
  }
}

/** Apakah nilai Cache-Control sudah memaksa revalidasi tiap permintaan. */
export function isNoCacheValue(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.toLowerCase();
  if (/(^|[,\s])no-store([,\s]|$)/.test(v)) return true;
  if (/(^|[,\s])no-cache([,\s]|$)/.test(v)) return true;
  return /max-age\s*=\s*0/.test(v) && /must-revalidate/.test(v);
}

/**
 * Kembalikan respons dengan header cache brand bila perlu.
 * Respons non-2xx dan path non-brand dibiarkan apa adanya.
 */
export function withBrandCacheHeaders(request: Request, response: Response): Response {
  const path = pathnameOf(request.url);
  if (!isBrandAssetPath(path)) return response;
  if (!response.ok) return response;
  if (isNoCacheValue(response.headers.get("cache-control"))) {
    const ct = BRAND_CONTENT_TYPES[path];
    if (!ct || response.headers.get("content-type") === ct) return response;
  }
  const headers = new Headers(response.headers);
  headers.set("cache-control", BRAND_CACHE_CONTROL);
  const ct = BRAND_CONTENT_TYPES[path];
  if (ct) headers.set("content-type", ct);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// ————— Audit live —————

export type HeaderProbe = {
  url: string;
  status: number;
  cacheControl: string | null;
  contentType: string | null;
};

export type HeaderIssue = { url: string; id: string; message: string };

/** Validasi hasil probe header aset brand pada situs live. */
export function auditBrandCacheHeaders(probes: HeaderProbe[]): {
  ok: boolean;
  checked: string[];
  issues: HeaderIssue[];
} {
  const issues: HeaderIssue[] = [];
  for (const p of probes) {
    if (p.status !== 200) {
      issues.push({ url: p.url, id: "unreachable", message: `status ${p.status}` });
      continue;
    }
    if (!isNoCacheValue(p.cacheControl)) {
      issues.push({
        url: p.url,
        id: "cache-control",
        message: `Cache-Control="${p.cacheControl ?? "(kosong)"}" — harus no-cache/must-revalidate`,
      });
    }
    const expectCt = BRAND_CONTENT_TYPES[pathnameOf(p.url)];
    // XML boleh disajikan sebagai text/xml maupun application/xml.
    const ctOk =
      !expectCt ||
      (expectCt.startsWith("application/xml")
        ? /(application|text)\/xml/.test(p.contentType ?? "")
        : (p.contentType ?? "").startsWith(expectCt.split(";")[0]));
    if (!ctOk) {
      issues.push({
        url: p.url,
        id: "content-type",
        message: `Content-Type="${p.contentType ?? "(kosong)"}" — harus ${expectCt}`,
      });
    }
  }
  return { ok: issues.length === 0, checked: probes.map((p) => p.url), issues };
}

export function formatBrandCacheAudit(report: ReturnType<typeof auditBrandCacheHeaders>): string {
  if (report.ok) return `Header cache aset brand OK — ${report.checked.length} URL diperiksa.`;
  return [
    `Header cache: ${report.issues.length} masalah pada ${report.checked.length} URL.`,
    ...report.issues.map((i) => `  • ${i.url} — ${i.id}: ${i.message}`),
  ].join("\n");
}

/** Ambil URL og:image & og:image:secure_url dari HTML terender. */
export function ogImageUrlsFromHtml(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(
    /<meta[^>]+property=["'](og:image|og:image:secure_url)["'][^>]*content=["']([^"']+)["']/gi,
  )) {
    out.add(m[2]);
  }
  for (const m of html.matchAll(
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["'](og:image|og:image:secure_url)["']/gi,
  )) {
    out.add(m[1]);
  }
  return [...out];
}
