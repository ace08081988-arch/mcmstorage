import type { ImportedPatch } from "./appearance-migrator";

/**
 * Nilai draft "current" yang aman dipakai sebagai fallback saat impor menemui
 * field yang hilang. Semua field diisi dengan nilai netral yang mudah
 * dibedakan dari fixture agar test bisa memverifikasi override vs fallback.
 */
export const CURRENT_DEFAULT: ImportedPatch = {
  theme: "system",
  font: "sans",
  size: "md",
  accent: "slate",
  radius: 0.5,
  bgImage: "",
  bgOverlay: 0.3,
  bgBlur: 8,
  compact: false,
  fontScale: 1,
  highContrast: false,
  reduceMotion: false,
};

/**
 * Fixture skema v1: field appearance ada di ROOT payload (bentuk rilis awal).
 * `schemaVersion` belum ada — importer harus jatuh ke `version` atau
 * default ke 1.
 */
export const FIXTURE_V1 = {
  __type: "mcm.appearance-settings",
  version: 1,
  app: "mcm-storage",
  exportedAt: "2026-01-15T10:00:00.000Z",
  theme: "dark",
  font: "serif",
  size: "lg",
  accent: "emerald",
  radius: "0.875",
  bgImage: "https://example.com/bg-v1.jpg",
  bgOverlay: "0.6",
  bgBlur: "12",
  compact: true,
  fontScale: 1.1,
  highContrast: true,
  reduceMotion: false,
} as const;

/**
 * Fixture skema v1 tanpa field `version` sama sekali — harus dianggap v1
 * (default) dan tetap dapat dimuat.
 */
export const FIXTURE_V1_NO_VERSION = {
  __type: "mcm.appearance-settings",
  theme: "light",
  font: "mono",
  size: "sm",
  accent: "blue",
  radius: "0.25",
  bgImage: "",
  bgOverlay: "0.1",
  bgBlur: "4",
  compact: false,
  fontScale: 0.9,
  highContrast: false,
  reduceMotion: true,
} as const;

/**
 * Fixture skema v2: field appearance dipindah ke `appearance`, aksesibilitas
 * ke `appPrefs`. `schemaVersion` = 2 dan `version` dipertahankan sebagai alias.
 */
export const FIXTURE_V2 = {
  __type: "mcm.appearance-settings",
  schemaVersion: 2,
  version: 2,
  app: "mcm-storage",
  exportedAt: "2026-07-01T09:00:00.000Z",
  appearance: {
    theme: "light",
    font: "display",
    size: "xl",
    accent: "rose",
    radius: "1.25",
    bgImage: "https://example.com/bg-v2.jpg",
    bgOverlay: "0.5",
    bgBlur: "20",
  },
  compact: true,
  appPrefs: {
    fontScale: 1.25,
    highContrast: true,
    reduceMotion: true,
  },
} as const;

/**
 * Fixture skema v3 (hipotetis, versi lebih baru): ada field yang dikenal
 * (dibungkus di `appearance`/`appPrefs`) PLUS field baru yang belum dikenal
 * importer sekarang. Importer harus:
 *   - mengembalikan `forward: true`
 *   - memuat field yang dikenal dengan benar
 *   - MENGABAIKAN field baru tanpa error
 */
export const FIXTURE_V3_FUTURE = {
  __type: "mcm.appearance-settings",
  schemaVersion: 3,
  version: 3,
  app: "mcm-storage",
  exportedAt: "2027-03-10T12:00:00.000Z",
  appearance: {
    theme: "dark",
    font: "sans",
    size: "md",
    accent: "violet",
    radius: "0.75",
    bgImage: "",
    bgOverlay: "0.4",
    bgBlur: "10",
    // Field masa depan — harus diabaikan diam-diam.
    animatedGradient: true,
    glassMorphism: { strength: 3 },
  },
  compact: false,
  appPrefs: {
    fontScale: 1.05,
    highContrast: false,
    reduceMotion: false,
    // Field aksesibilitas masa depan — harus diabaikan.
    dyslexiaFriendly: true,
  },
  // Section baru di root — harus diabaikan.
  motionProfile: { style: "reduced-fancy" },
} as const;

/**
 * Payload rusak / tak dikenali — harus ditolak dengan `reason` yang benar.
 */
export const FIXTURE_UNKNOWN_TYPE = {
  __type: "some.other-app.settings",
  schemaVersion: 2,
  appearance: { theme: "dark" },
} as const;

export const FIXTURE_INVALID_NOT_OBJECT = "just a string" as unknown;
export const FIXTURE_INVALID_NULL = null as unknown;
export const FIXTURE_INVALID_ARRAY = [1, 2, 3] as unknown;