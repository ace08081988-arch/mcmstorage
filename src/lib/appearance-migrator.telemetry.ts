/**
 * Telemetri ringan untuk migrasi skema `mcm.appearance-settings` di sisi
 * klien. Dipanggil oleh SEMUA jalur impor (upload/paste/URL) setelah
 * `migrateImportedAppearance` supaya kita bisa melacak:
 *
 *   - berapa sering pengguna mengimpor payload lama (fromVersion < target)
 *   - berapa sering payload dari rilis lebih baru masuk (forward=true)
 *   - payload apa yang ditolak (`unknown_type` / `invalid`) — indikator
 *     regresi kompatibilitas di rilis berikutnya
 *
 * Dua saluran:
 *   1. `console.info` satu baris JSON dengan prefix `[appearance-migrator]`
 *      supaya mudah difilter dari devtools/session replay.
 *   2. `CustomEvent("mcm:appearance-migrated")` di `window` sehingga test
 *      end-to-end dan tooling lain dapat berlangganan tanpa memasang
 *      spy di console.
 *
 * Tidak menulis ke jaringan — impor pengaturan tampilan sepenuhnya lokal.
 * Jika kelak diperlukan pengiriman ke backend, tambahkan sink baru di
 * fungsi ini; JANGAN duplikasi pemanggilan di jalur-jalur impor.
 */
import type { MigrateResult } from "./appearance-migrator";
import { EXPORT_SCHEMA_VERSION } from "./appearance-migrator";

export type ImportSource = "file" | "paste" | "url";

export type AppearanceMigrationEvent = {
  /** Sumber payload yang memicu migrasi. */
  source: ImportSource;
  /** Hasil akhir migrator. */
  outcome: "ok" | "unknown_type" | "invalid";
  /** Versi skema payload sumber. `null` jika payload ditolak. */
  fromVersion: number | null;
  /** Versi skema aktif di build ini (target migrasi). */
  toVersion: number;
  /** True bila payload berasal dari skema yang lebih baru dari target. */
  forward: boolean;
  /** Timestamp ISO. */
  at: string;
};

export const APPEARANCE_MIGRATION_EVENT = "mcm:appearance-migrated";

export function logAppearanceMigration(
  source: ImportSource,
  result: MigrateResult,
): AppearanceMigrationEvent {
  const at = new Date().toISOString();
  const event: AppearanceMigrationEvent = result.ok
    ? {
        source,
        outcome: "ok",
        fromVersion: result.fromVersion,
        toVersion: EXPORT_SCHEMA_VERSION,
        forward: result.forward,
        at,
      }
    : {
        source,
        outcome: result.reason,
        fromVersion: null,
        toVersion: EXPORT_SCHEMA_VERSION,
        forward: false,
        at,
      };

  try {
    // eslint-disable-next-line no-console
    console.info("[appearance-migrator] " + JSON.stringify(event));
  } catch {
    // Tidak menghentikan alur impor karena telemetri.
  }
  try {
    if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(APPEARANCE_MIGRATION_EVENT, { detail: event }),
      );
    }
  } catch {
    // ignore
  }
  return event;
}