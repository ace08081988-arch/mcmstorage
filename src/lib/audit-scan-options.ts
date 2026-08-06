/**
 * Opsi pemindaian URL untuk audit head/SEO langsung (`audit:head:live`).
 *
 * Tujuan: membuat audit cepat & stabil di CI dengan parameter yang bisa diatur
 * lewat flag CLI atau environment variable:
 *   --max-urls / AUDIT_MAX_URLS         batas jumlah URL yang di-fetch
 *   --timeout  / AUDIT_TIMEOUT_MS       timeout per request (ms)
 *   --concurrency / AUDIT_CONCURRENCY   jumlah request paralel
 *   --retries  / AUDIT_RETRIES          percobaan ulang saat gagal/timeout
 *   --per-pattern / AUDIT_PER_PATTERN   contoh URL per pola rute dinamis
 */

export type ScanOptions = {
  maxUrls: number;
  timeoutMs: number;
  concurrency: number;
  retries: number;
  perDynamicPattern: number;
};

export const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  maxUrls: 40,
  timeoutMs: 15_000,
  concurrency: 6,
  retries: 1,
  perDynamicPattern: 3,
};

const LIMITS: Record<keyof ScanOptions, { min: number; max: number }> = {
  maxUrls: { min: 1, max: 500 },
  timeoutMs: { min: 1_000, max: 120_000 },
  concurrency: { min: 1, max: 32 },
  retries: { min: 0, max: 5 },
  perDynamicPattern: { min: 1, max: 20 },
};

/** Bulatkan nilai ke rentang aman; kembalikan fallback bila tidak valid. */
export function clampOption(key: keyof ScanOptions, value: unknown, fallback: number): number {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return fallback;
  const { min, max } = LIMITS[key];
  return Math.min(max, Math.max(min, Math.round(n)));
}

function flagValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
}

/** Gabungkan default + env + flag CLI (flag menang). */
export function parseScanOptions(
  argv: string[] = [],
  env: Record<string, string | undefined> = {},
  defaults: ScanOptions = DEFAULT_SCAN_OPTIONS,
): ScanOptions {
  const pick = (key: keyof ScanOptions, flag: string, envKey: string) =>
    clampOption(key, flagValue(argv, flag) ?? env[envKey], defaults[key]);
  return {
    maxUrls: pick("maxUrls", "max-urls", "AUDIT_MAX_URLS"),
    timeoutMs: pick("timeoutMs", "timeout", "AUDIT_TIMEOUT_MS"),
    concurrency: pick("concurrency", "concurrency", "AUDIT_CONCURRENCY"),
    retries: pick("retries", "retries", "AUDIT_RETRIES"),
    perDynamicPattern: pick("perDynamicPattern", "per-pattern", "AUDIT_PER_PATTERN"),
  };
}

/** Nama flag yang memakai nilai terpisah (dipakai saat memfilter argumen posisional). */
export const SCAN_FLAGS_WITH_VALUE = [
  "--max-urls",
  "--timeout",
  "--concurrency",
  "--retries",
  "--per-pattern",
];

/** Potong daftar URL ke batas maksimum, tetap mempertahankan urutan. */
export function capUrls(urls: string[], maxUrls: number): { urls: string[]; dropped: string[] } {
  if (urls.length <= maxUrls) return { urls, dropped: [] };
  return { urls: urls.slice(0, maxUrls), dropped: urls.slice(maxUrls) };
}

export type FetchedPage = { url: string; html: string; status: number };

/**
 * Ambil banyak URL dengan pool paralel + timeout + retry.
 * Selalu resolve (status 599 saat gagal total) agar audit tetap melaporkan.
 */
export async function fetchPagesPooled(
  urls: string[],
  opts: Pick<ScanOptions, "timeoutMs" | "concurrency" | "retries">,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchedPage[]> {
  const results = new Array<FetchedPage>(urls.length);
  let cursor = 0;

  const one = async (url: string): Promise<FetchedPage> => {
    for (let attempt = 0; attempt <= opts.retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
      try {
        const res = await fetchImpl(url, {
          signal: ctrl.signal,
          headers: { "user-agent": "AceStorageHeadAudit/1.0" },
        });
        const html = await res.text();
        if (res.status >= 500 && attempt < opts.retries) continue;
        return { url, html, status: res.status };
      } catch {
        if (attempt >= opts.retries) return { url, html: "", status: 599 };
      } finally {
        clearTimeout(timer);
      }
    }
    return { url, html: "", status: 599 };
  };

  const worker = async () => {
    while (cursor < urls.length) {
      const i = cursor++;
      results[i] = await one(urls[i]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(opts.concurrency, urls.length || 1) }, worker),
  );
  return results.filter(Boolean);
}

export function formatScanOptions(o: ScanOptions): string {
  return `maks ${o.maxUrls} URL, timeout ${o.timeoutMs}ms, paralel ${o.concurrency}, retry ${o.retries}, ${o.perDynamicPattern}/pola`;
}
