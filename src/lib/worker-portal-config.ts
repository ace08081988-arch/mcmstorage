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

/** Bidang yang aman diset admin via halaman pengaturan. */
export const WORKER_PORTAL_CONFIG_FIELDS: Array<{
  key: keyof WorkerPortalConfig;
  label: string;
  unit: string;
  min: number;
  max: number;
  help: string;
}> = [
  { key: "sessionTtlMs", label: "TTL sesi PIN", unit: "ms", min: 60_000, max: 24 * 60 * 60 * 1000, help: "Berapa lama PIN pegawai tersimpan di perangkat sebelum diminta ulang. Disarankan 15–60 menit." },
  { key: "maxAttempts", label: "Maks. percobaan PIN salah", unit: "kali", min: 1, max: 10, help: "Setelah tercapai, input PIN dikunci sementara." },
  { key: "lockSeconds", label: "Lama kunci setelah salah", unit: "detik", min: 5, max: 3600, help: "Berapa lama input PIN dikunci di sisi klien." },
  { key: "silentFailTolerance", label: "Toleransi error sinkron", unit: "kegagalan", min: 1, max: 10, help: "Banyak kegagalan berturut-turut sebelum pegawai dipantulkan ke layar “tugas ditutup”." },
  { key: "lagThresholdSec", label: "Ambang lag sinkron", unit: "detik", min: 5, max: 600, help: "Umur sinkron sebelum auto-resync ringan." },
  { key: "staleThresholdSec", label: "Ambang stale sinkron", unit: "detik", min: 10, max: 3600, help: "Umur sinkron sebelum auto-resync agresif." },
  { key: "lagCooldownMs", label: "Cooldown auto-resync (lag)", unit: "ms", min: 1000, max: 600_000, help: "Jeda antar percobaan saat status “lag”." },
  { key: "staleCooldownBaseMs", label: "Cooldown awal (stale)", unit: "ms", min: 1000, max: 600_000, help: "Cooldown awal saat status “stale”; dilipat-duakan tiap kegagalan." },
  { key: "staleCooldownMaxMs", label: "Cooldown maks. (stale)", unit: "ms", min: 1000, max: 600_000, help: "Batas atas cooldown saat status “stale”." },
];

declare global {
  interface Window {
    __WORKER_PORTAL_CONFIG__?: Partial<WorkerPortalConfig>;
  }
}

/**
 * Cache override sederhana yang diisi setelah fetch dari `app_settings`.
 * Disimpan di module scope agar mount portal pegawai selanjutnya langsung
 * memakai nilai terbaru tanpa menunggu jaringan. Saat fresh mount (cold
 * load), nilai default operasional dipakai dulu, lalu di-upgrade async.
 */
let remoteOverride: Partial<WorkerPortalConfig> | null = null;

export function applyRemoteWorkerPortalConfig(partial: Partial<WorkerPortalConfig> | null) {
  remoteOverride = partial && typeof partial === "object" ? partial : null;
}

function numFromEnv(key: string): number | undefined {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const raw = env?.[key];
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Index field metadata (min/max) by key untuk lookup cepat. */
const FIELD_BOUNDS: Record<keyof WorkerPortalConfig, { min: number; max: number }> =
  WORKER_PORTAL_CONFIG_FIELDS.reduce(
    (acc, f) => {
      acc[f.key] = { min: f.min, max: f.max };
      return acc;
    },
    {} as Record<keyof WorkerPortalConfig, { min: number; max: number }>,
  );

/**
 * Validasi nilai terhadap bounds field. Mengembalikan `undefined` saat
 * nilai bukan angka, non-finite, atau di luar rentang — sehingga jalur
 * resolusi otomatis lanjut ke kandidat berikutnya (env → default).
 */
function pickValid(
  key: keyof WorkerPortalConfig,
  ...values: Array<number | undefined>
): number | undefined {
  const b = FIELD_BOUNDS[key];
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (b && (v < b.min || v > b.max)) continue;
    return v;
  }
  return undefined;
}

/**
 * Validasi satu objek kandidat config; nilai tidak valid dihilangkan
 * sehingga otomatis fallback ke sumber berikutnya. Berguna untuk admin
 * UI dan unit test.
 */
export function sanitizeWorkerPortalConfig(
  input: Partial<WorkerPortalConfig> | null | undefined,
): Partial<WorkerPortalConfig> {
  if (!input || typeof input !== "object") return {};
  const out: Partial<WorkerPortalConfig> = {};
  for (const f of WORKER_PORTAL_CONFIG_FIELDS) {
    const v = (input as Record<string, unknown>)[f.key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (v < f.min || v > f.max) continue;
    out[f.key] = v;
  }
  return out;
}

/** Resolusi konfigurasi efektif (override runtime > env build > default). */
export function getWorkerPortalConfig(): WorkerPortalConfig {
  const win =
    typeof window !== "undefined" ? window.__WORKER_PORTAL_CONFIG__ ?? {} : {};
  const remote = remoteOverride ?? {};
  const d = WORKER_PORTAL_DEFAULTS;
  const envMap: Record<keyof WorkerPortalConfig, string> = {
    sessionTtlMs: "VITE_WORKER_PORTAL_SESSION_TTL_MS",
    maxAttempts: "VITE_WORKER_PORTAL_MAX_ATTEMPTS",
    lockSeconds: "VITE_WORKER_PORTAL_LOCK_SECONDS",
    silentFailTolerance: "VITE_WORKER_PORTAL_SILENT_FAIL_TOLERANCE",
    lagThresholdSec: "VITE_WORKER_PORTAL_LAG_THRESHOLD_SEC",
    staleThresholdSec: "VITE_WORKER_PORTAL_STALE_THRESHOLD_SEC",
    lagCooldownMs: "VITE_WORKER_PORTAL_LAG_COOLDOWN_MS",
    staleCooldownBaseMs: "VITE_WORKER_PORTAL_STALE_COOLDOWN_BASE_MS",
    staleCooldownMaxMs: "VITE_WORKER_PORTAL_STALE_COOLDOWN_MAX_MS",
  };
  const resolve = (key: keyof WorkerPortalConfig): number =>
    pickValid(
      key,
      (win as Record<string, number | undefined>)[key],
      (remote as Record<string, number | undefined>)[key],
      numFromEnv(envMap[key]),
    ) ?? d[key];

  const out: WorkerPortalConfig = {
    sessionTtlMs: resolve("sessionTtlMs"),
    maxAttempts: resolve("maxAttempts"),
    lockSeconds: resolve("lockSeconds"),
    silentFailTolerance: resolve("silentFailTolerance"),
    lagThresholdSec: resolve("lagThresholdSec"),
    staleThresholdSec: resolve("staleThresholdSec"),
    lagCooldownMs: resolve("lagCooldownMs"),
    staleCooldownBaseMs: resolve("staleCooldownBaseMs"),
    staleCooldownMaxMs: resolve("staleCooldownMaxMs"),
  };

  // Cross-field invariants — kalau dilanggar, fallback ke default kedua
  // sisi agar konsisten dan tidak menimbulkan loop resync agresif.
  if (out.lagThresholdSec >= out.staleThresholdSec) {
    out.lagThresholdSec = d.lagThresholdSec;
    out.staleThresholdSec = d.staleThresholdSec;
  }
  if (out.staleCooldownBaseMs > out.staleCooldownMaxMs) {
    out.staleCooldownBaseMs = d.staleCooldownBaseMs;
    out.staleCooldownMaxMs = d.staleCooldownMaxMs;
  }
  return out;
}

/**
 * Fetch konfigurasi worker portal dari `app_settings` (kolom JSONB
 * `worker_portal_config`) dan terapkan sebagai remote override.
 * Aman dipanggil di halaman publik — pakai publishable key + RLS
 * select-anyone yang sudah ada. Diam saja kalau gagal.
 */
export async function fetchAndApplyWorkerPortalConfig(): Promise<WorkerPortalConfig> {
  try {
    const { publicSupabase } = await import("@/lib/public-supabase");
    const { data } = await publicSupabase
      .from("app_settings")
      .select("worker_portal_config")
      .eq("id", true)
      .maybeSingle();
    const raw = (data as { worker_portal_config?: unknown } | null)?.worker_portal_config;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      applyRemoteWorkerPortalConfig(raw as Partial<WorkerPortalConfig>);
    }
  } catch {
    /* abaikan — fallback ke default */
  }
  return getWorkerPortalConfig();
}