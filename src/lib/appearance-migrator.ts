// ============================================================================
// Migrator skema ekspor/impor pengaturan tampilan (mcm.appearance-settings)
// ----------------------------------------------------------------------------
// Kontrak lengkap per-versi, aturan clamping, dan checklist rilis:
//   docs/appearance-schema.md
// Wajib dibaca sebelum menaikkan EXPORT_SCHEMA_VERSION.
// ----------------------------------------------------------------------------
// Diekstrak dari `src/routes/_authenticated.pengaturan-tampilan.tsx` agar dapat
// diuji unit-per-unit. Aturan migrasi:
//   - v1  : field appearance ada di root payload (mis. `raw.theme`,
//           `raw.accent`), `version` = 1, `schemaVersion` boleh absen.
//   - v2  : field appearance dipindah ke `raw.appearance` dan preferensi
//           aksesibilitas ke `raw.appPrefs`; `schemaVersion` = 2 (dan
//           `version` dipertahankan sebagai alias untuk importer lama).
//   - v>=N: fromVersion > EXPORT_SCHEMA_VERSION dianggap "forward" — field
//           yang dikenal dimuat, sisanya diabaikan tanpa error.
// Impor selalu backward-compatible: field yang tidak dikenal diabaikan, field
// yang hilang diisi dari nilai `current` (draft aktif) sebagai fallback aman.
// ============================================================================

export type Theme = "light" | "dark" | "system";
export type FontFamily = "sans" | "serif" | "mono" | "display" | "editorial";
export type FontSize = "sm" | "md" | "lg" | "xl";

export const EXPORT_SCHEMA_TYPE = "mcm.appearance-settings";
export const EXPORT_SCHEMA_VERSION = 2;
export const APPEARANCE_APP_ID = "mcm-storage";

export const VALID_THEMES: readonly Theme[] = ["light", "dark", "system"];
export const VALID_FONTS: readonly FontFamily[] = [
  "sans",
  "serif",
  "mono",
  "display",
  "editorial",
];
export const VALID_SIZES: readonly FontSize[] = ["sm", "md", "lg", "xl"];

export type ImportedPatch = {
  theme: Theme;
  font: FontFamily;
  size: FontSize;
  accent: string;
  radius: number;
  bgImage: string;
  bgOverlay: number;
  bgBlur: number;
  compact: boolean;
  fontScale: number;
  highContrast: boolean;
  reduceMotion: boolean;
  /**
   * Efek permukaan (kaca/transparansi). Additive di skema v2: payload lama
   * tidak memuatnya, jadi opsional dan selalu jatuh balik ke nilai draft aktif.
   */
  fx?: ImportedFx;
};

export type ImportedFx = {
  glass: boolean;
  surfaceOpacity: number;
  surfaceBlur: number;
  sidebarOpacity: number;
  shadow: number;
  saturation: number;
  accentGradient: boolean;
};

export type MigrateResult =
  | { ok: true; patch: ImportedPatch; forward: boolean; fromVersion: number }
  | { ok: false; reason: "unknown_type" | "invalid" };

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function pickEnum<T extends string>(
  x: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof x === "string" && (allowed as readonly string[]).includes(x)
    ? (x as T)
    : fallback;
}
function pickNumber(x: unknown, fallback: number, min?: number, max?: number): number {
  const n = typeof x === "number" ? x : Number(x);
  if (!Number.isFinite(n)) return fallback;
  if (min !== undefined && n < min) return min;
  if (max !== undefined && n > max) return max;
  return n;
}
function pickBool(x: unknown, fallback: boolean): boolean {
  return typeof x === "boolean" ? x : fallback;
}
function pickString(x: unknown, fallback: string): string {
  return typeof x === "string" ? x : fallback;
}

/**
 * Terima payload apa pun dari file ekspor lama/baru dan kembalikan patch
 * pratinjau yang aman untuk digabung ke draft. Cocok untuk semua rilis yang
 * memakai skema `mcm.appearance-settings`.
 */
export function migrateImportedAppearance(
  raw: unknown,
  current: ImportedPatch,
): MigrateResult {
  if (!isRecord(raw)) return { ok: false, reason: "invalid" };
  if (raw.__type !== EXPORT_SCHEMA_TYPE) {
    return { ok: false, reason: "unknown_type" };
  }
  const fromVersion = Number(
    raw.schemaVersion ?? raw.version ?? 1,
  );
  const forward = Number.isFinite(fromVersion) && fromVersion > EXPORT_SCHEMA_VERSION;

  // Field appearance dapat berada di root (skema v1) atau di dalam
  // `appearance` (skema ≥2). Ambil dari mana pun tersedia.
  const ap: Record<string, unknown> = isRecord(raw.appearance)
    ? (raw.appearance as Record<string, unknown>)
    : {};
  const ap2: Record<string, unknown> = isRecord(raw.appPrefs)
    ? (raw.appPrefs as Record<string, unknown>)
    : {};

  const patch: ImportedPatch = {
    theme: pickEnum(ap.theme ?? raw.theme, VALID_THEMES, current.theme),
    font: pickEnum(ap.font ?? raw.font, VALID_FONTS, current.font),
    size: pickEnum(ap.size ?? raw.size, VALID_SIZES, current.size),
    accent: pickString(ap.accent ?? raw.accent, current.accent),
    radius: pickNumber(ap.radius ?? raw.radius, current.radius, 0, 2),
    bgImage: pickString(ap.bgImage ?? raw.bgImage, current.bgImage),
    bgOverlay: pickNumber(ap.bgOverlay ?? raw.bgOverlay, current.bgOverlay, 0, 1),
    bgBlur: pickNumber(ap.bgBlur ?? raw.bgBlur, current.bgBlur, 0, 40),
    compact: pickBool(raw.compact, current.compact),
    fontScale: pickNumber(ap2.fontScale ?? raw.fontScale, current.fontScale, 0.8, 1.5),
    highContrast: pickBool(
      ap2.highContrast ?? raw.highContrast,
      current.highContrast,
    ),
    reduceMotion: pickBool(
      ap2.reduceMotion ?? raw.reduceMotion,
      current.reduceMotion,
    ),
  };

  // `fx` additive: kuncinya hanya muncul kalau memang ada nilainya, supaya
  // bentuk patch untuk payload lama tetap persis seperti kontrak sebelumnya.
  const fx = migrateFx(raw.fx ?? ap.fx, current.fx);
  if (fx) patch.fx = fx;

  return { ok: true, patch, forward, fromVersion };
}

/** Bacaan aman efek permukaan; field hilang diisi dari draft aktif. */
function migrateFx(raw: unknown, current?: ImportedFx): ImportedFx | undefined {
  if (!isRecord(raw)) return current;
  const base: ImportedFx = current ?? {
    glass: false,
    surfaceOpacity: 1,
    surfaceBlur: 12,
    sidebarOpacity: 1,
    shadow: 1,
    saturation: 1,
    accentGradient: false,
  };
  return {
    glass: pickBool(raw.glass, base.glass),
    surfaceOpacity: pickNumber(raw.surfaceOpacity, base.surfaceOpacity, 0.3, 1),
    surfaceBlur: pickNumber(raw.surfaceBlur, base.surfaceBlur, 0, 30),
    sidebarOpacity: pickNumber(raw.sidebarOpacity, base.sidebarOpacity, 0.3, 1),
    shadow: pickNumber(raw.shadow, base.shadow, 0, 3),
    saturation: pickNumber(raw.saturation, base.saturation, 0.6, 1.4),
    accentGradient: pickBool(raw.accentGradient, base.accentGradient),
  };
}