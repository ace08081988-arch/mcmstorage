/**
 * Guard SSRF untuk rescrape sosial: hanya URL milik situs sendiri, skema
 * https, tanpa kredensial/port aneh, dan path yang masuk allowlist.
 */
import { SITE_URL } from "./seo-meta";

export const ALLOWED_RESCRAPE_PATH_PREFIXES = [
  "/",
  "/produk",
  "/katalog",
  "/download",
  "/blog",
] as const;

export function allowedRescrapeHosts(siteUrl = SITE_URL): string[] {
  let host = "";
  try {
    host = new URL(siteUrl).hostname.toLowerCase();
  } catch {
    /* abaikan */
  }
  const extra = [
    "mcmstorage.lovable.app",
    "mcmstorage.app",
    "www.mcmstorage.app",
    "mcmstorage.biz",
    "www.mcmstorage.biz",
  ];
  return Array.from(new Set([host, ...extra].filter(Boolean)));
}

export type SsrfCheck = { ok: true; url: string } | { ok: false; reason: string };

/** Validasi satu URL target rescrape. Menolak apa pun di luar situs sendiri. */
export function checkRescrapeUrl(input: string, siteUrl = SITE_URL): SsrfCheck {
  let u: URL;
  try {
    u = new URL(input, siteUrl);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "protocol_not_allowed" };
  if (u.username || u.password) return { ok: false, reason: "credentials_not_allowed" };
  if (u.port && u.port !== "443") return { ok: false, reason: "port_not_allowed" };
  const host = u.hostname.toLowerCase();
  // Tolak literal IP & host internal secara eksplisit (defense in depth).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host === "localhost") {
    return { ok: false, reason: "host_not_allowed" };
  }
  if (!allowedRescrapeHosts(siteUrl).includes(host)) {
    return { ok: false, reason: "host_not_allowed" };
  }
  const path = u.pathname;
  const allowed = ALLOWED_RESCRAPE_PATH_PREFIXES.some(
    (p) => path === p || path.startsWith(p === "/" ? "/" : `${p}/`) || path === p,
  );
  const isRoot = path === "/";
  if (!isRoot && !allowed) return { ok: false, reason: "path_not_allowed" };
  if (path.startsWith("/api/")) return { ok: false, reason: "path_not_allowed" };
  return { ok: true, url: `${u.origin}${u.pathname}${u.search}` };
}

/** Saring daftar URL; kembalikan yang aman + alasan penolakan. */
export function filterRescrapeUrls(urls: string[], siteUrl = SITE_URL) {
  const safe: string[] = [];
  const rejected: { url: string; reason: string }[] = [];
  for (const raw of urls) {
    const res = checkRescrapeUrl(raw, siteUrl);
    if (res.ok) safe.push(res.url);
    else rejected.push({ url: raw, reason: res.reason });
  }
  return { safe, rejected };
}
