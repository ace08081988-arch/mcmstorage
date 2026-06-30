/**
 * Konfigurasi runtime portal pegawai (`/t/$token`).
 *
 * Semua nilai bisa disetel via tiga sumber, urutan prioritas:
 *   1. `window.__WORKER_PORTAL_CONFIG__` — override runtime (mis. dari
 *      remote config / kill switch / DevTools saat troubleshooting).
 *   2. `import.meta.env.VITE_WORKER_PORTAL_*` — diset saat build /
 *      deploy via `.env` agar berlaku global tanpa code change.
 *   3. Default operasional yang sudah teruji (fallback).
 *
 * Hindari import dari file ini di server function. Ini murni nilai
 * client-side yang dipakai komponen React di portal pegawai.
 */

export type WorkerPortalConfig = {
  /** TTL sesi PIN di sessionStorage (ms). Setelah lewat ini, pegawai
   *  harus input PIN lagi meski tab tidak ditutup. */
  sessionTtlMs: number;
  /** Maksimum percobaan PIN salah berturut-turut sebelum input PIN
   *  dikunci sementara di sisi klien. */
  maxAttempts: number;
  /** Lama penguncian klien (detik) setelah `maxAttempts` tercapai. */
  lockSeconds: number;
  /** Berapa kali `silentRefresh` harus gagal dengan kategori error
   *  yang sama sebelum benar-benar memantulkan pegawai ke layar
   *  "tugas ditutup". Toleransi terhadap error transien. */
  silentFailTolerance: number;
  /** Ambang umur sinkron terakhir (detik) sebelum dianggap "lag" dan
   *  dipicu auto-resync ringan. */
  lagThresholdSec: number;
  /** Ambang umur sinkron terakhir (detik) sebelum dianggap "stale"
   *  dan dipicu auto-resync agresif dengan backoff. */
  staleThresholdSec: number;
  /** Cooldown auto-resync saat lag (ms). */
  lagCooldownMs: number;
  /** Cooldown awal auto-resync saat stale (ms). Tiap kegagalan
   *  berturut-turut, cooldown dikali 2 sampai `staleCooldownMaxMs`. */
  staleCooldownBaseMs: number;
  /** Batas atas cooldown auto-resync saat stale (ms). */
  staleCooldownMaxMs: number;
};

export const WORKER_PORTAL_DEFAULTS: WorkerPortalConfig = {
  sessionTtlMs: 30 * 60 * 1000,
  maxAttempts: 3,
  lockSeconds: 60,
  silentFailTolerance: 2,
  lagThresholdSec: 30,
  staleThresholdSec: 90,
  lagCooldownMs: 10_000,
  staleCooldownBaseMs: 5_000,
  staleCooldownMaxMs: 30_000,
};

declare global {
  interface Window {
    __WORKER_PORTAL_CONFIG__?: Partial<WorkerPortalConfig>;
  }
}

function numFromEnv(key: string): number | undefined {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const raw = env?.[key];
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function pickPositive(...values: Array<number | undefined>): number | undefined {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return undefined;
}

function pickNonNegative(...values: Array<number | undefined>): number | undefined {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  }
  return undefined;
}

/** Resolusi konfigurasi efektif (override runtime > env build > default). */
export function getWorkerPortalConfig(): WorkerPortalConfig {
  const win =
    typeof window !== "undefined" ? window.__WORKER_PORTAL_CONFIG__ ?? {} : {};
  const d = WORKER_PORTAL_DEFAULTS;
  return {
    sessionTtlMs:
      pickPositive(win.sessionTtlMs, numFromEnv("VITE_WORKER_PORTAL_SESSION_TTL_MS")) ??
      d.sessionTtlMs,
    maxAttempts:
      pickPositive(win.maxAttempts, numFromEnv("VITE_WORKER_PORTAL_MAX_ATTEMPTS")) ??
      d.maxAttempts,
    lockSeconds:
      pickPositive(win.lockSeconds, numFromEnv("VITE_WORKER_PORTAL_LOCK_SECONDS")) ??
      d.lockSeconds,
    silentFailTolerance:
      pickPositive(
        win.silentFailTolerance,
        numFromEnv("VITE_WORKER_PORTAL_SILENT_FAIL_TOLERANCE"),
      ) ?? d.silentFailTolerance,
    lagThresholdSec:
      pickPositive(
        win.lagThresholdSec,
        numFromEnv("VITE_WORKER_PORTAL_LAG_THRESHOLD_SEC"),
      ) ?? d.lagThresholdSec,
    staleThresholdSec:
      pickPositive(
        win.staleThresholdSec,
        numFromEnv("VITE_WORKER_PORTAL_STALE_THRESHOLD_SEC"),
      ) ?? d.staleThresholdSec,
    lagCooldownMs:
      pickNonNegative(
        win.lagCooldownMs,
        numFromEnv("VITE_WORKER_PORTAL_LAG_COOLDOWN_MS"),
      ) ?? d.lagCooldownMs,
    staleCooldownBaseMs:
      pickNonNegative(
        win.staleCooldownBaseMs,
        numFromEnv("VITE_WORKER_PORTAL_STALE_COOLDOWN_BASE_MS"),
      ) ?? d.staleCooldownBaseMs,
    staleCooldownMaxMs:
      pickPositive(
        win.staleCooldownMaxMs,
        numFromEnv("VITE_WORKER_PORTAL_STALE_COOLDOWN_MAX_MS"),
      ) ?? d.staleCooldownMaxMs,
  };
}