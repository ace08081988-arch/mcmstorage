/**
 * Impor & validasi snapshot Status Notifikasi (`mcm.notifikasi-status`).
 *
 * Membaca `schemaVersion` lalu **menjalankan rantai migrasi otomatis** ke
 * versi terkini sebelum validasi. Setiap langkah migrasi hanya menyentuh
 * bentuk mentah (raw) dan mencatat perubahannya di `appliedMigrations`,
 * sehingga penambahan versi baru cukup dengan menambah entry di
 * `MIGRATIONS` tanpa mengubah kode konsumen.
 *
 * Struktur yang dikenali saat ini:
 *
 * - v1 (current): { schemaVersion:1, schemaName, exportedAt, timezone, permission,
 *                   frame, serviceWorker, pushSubscription, ... }
 * - v0 (legacy) : ekspor lama tanpa `schemaVersion`; biasanya cuma memiliki
 *                 `generatedAt`, `permission`, `frame`, `serviceWorker`,
 *                 `pushSubscription`. Migrator v0→v1 memetakan `generatedAt`
 *                 ke `exportedAt` dan menyisipkan `schemaVersion`/`schemaName`.
 */

export const CURRENT_SCHEMA_VERSION = 1;
export const SCHEMA_NAME = "mcm.notifikasi-status";

export type NormalizedSnapshot = {
  schemaVersion: number;
  schemaName: string;
  exportedAt: string | null;
  exportedAtLocal?: string | null;
  timezone?: {
    label: string | null;
    offsetMinutes: number | null;
    iana: string | null;
  } | null;
  origin?: string | null;
  userAgent?: string | null;
  permission: Record<string, unknown> | null;
  frame: Record<string, unknown> | null;
  serviceWorker: Record<string, unknown> | null;
  pushSubscription: Record<string, unknown> | null;
  /** Field asli yang tidak dikenali — dipertahankan untuk audit. */
  extra?: Record<string, unknown>;
};

export type ImportWarning = {
  code:
    | "legacy_no_schema_version"
    | "future_schema_version"
    | "missing_field"
    | "wrong_schema_name"
    | "coerced_field"
    | "migrated";
  detail: string;
};

export type AppliedMigration = {
  from: number;
  to: number;
  description: string;
};

export type ImportResult =
  | {
      ok: true;
      snapshot: NormalizedSnapshot;
      sourceVersion: number; // 0 untuk file legacy
      /** Rantai migrasi yang dijalankan berurutan dari `sourceVersion` ke `schemaVersion`. */
      appliedMigrations: AppliedMigration[];
      /** Bentuk raw sebelum migrasi (untuk preview diff). */
      rawBefore: Record<string, unknown>;
      /** Bentuk raw setelah semua migrasi berjalan (sebelum validasi/normalisasi). */
      rawAfter: Record<string, unknown>;
      warnings: ImportWarning[];
    }
  | { ok: false; error: string };

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asObjOrNull(v: unknown): Record<string, unknown> | null {
  return isObj(v) ? v : null;
}

/**
 * Rantai migrasi berurutan. Setiap entry menaikkan versi tepat satu tingkat
 * (`from` → `to = from + 1`). Untuk menambah v2 nanti, cukup push entry
 * `{ from: 1, to: 2, ... }` di sini — tidak perlu menyentuh konsumen.
 */
type Migration = {
  from: number;
  to: number;
  description: string;
  migrate: (raw: Record<string, unknown>) => Record<string, unknown>;
};

const MIGRATIONS: Migration[] = [
  {
    from: 0,
    to: 1,
    description:
      "Legacy → v1: memetakan generatedAt→exportedAt & menyisipkan schemaVersion/schemaName.",
    migrate: (raw) => {
      const next: Record<string, unknown> = { ...raw };
      if (next.exportedAt == null && typeof next.generatedAt === "string") {
        next.exportedAt = next.generatedAt;
      }
      delete next.generatedAt;
      next.schemaVersion = 1;
      if (typeof next.schemaName !== "string") next.schemaName = SCHEMA_NAME;
      return next;
    },
  },
];

function runMigrations(
  raw: Record<string, unknown>,
  from: number,
): { migrated: Record<string, unknown>; applied: AppliedMigration[] } {
  let current = raw;
  let version = from;
  const applied: AppliedMigration[] = [];
  // Cegah loop tak terbatas bila MIGRATIONS salah konfigurasi.
  const maxSteps = MIGRATIONS.length + 1;
  for (let i = 0; i < maxSteps; i++) {
    if (version >= CURRENT_SCHEMA_VERSION) break;
    const step = MIGRATIONS.find((m) => m.from === version);
    if (!step) break; // tidak ada jalur naik dari versi ini
    current = step.migrate(current);
    applied.push({ from: step.from, to: step.to, description: step.description });
    version = step.to;
  }
  return { migrated: current, applied };
}

/**
 * Parse teks JSON menjadi snapshot yang tervalidasi & ternormalisasi.
 * Tidak melempar — semua kegagalan dikembalikan sebagai `{ ok:false, error }`.
 */
export function parseSnapshotText(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? `JSON tidak valid: ${e.message}` : "JSON tidak valid." };
  }
  if (!isObj(raw)) {
    return { ok: false, error: "Struktur file tidak dikenali (bukan objek JSON)." };
  }
  return normalizeSnapshot(raw);
}

/** Terima objek yang sudah di-parse (mis. dari `JSON.parse` di tempat lain). */
export function normalizeSnapshot(raw: Record<string, unknown>): ImportResult {
  const warnings: ImportWarning[] = [];

  const rawVersion = raw.schemaVersion;
  let sourceVersion: number;
  if (typeof rawVersion === "number" && Number.isFinite(rawVersion)) {
    sourceVersion = rawVersion;
  } else if (rawVersion == null) {
    sourceVersion = 0;
    warnings.push({
      code: "legacy_no_schema_version",
      detail: "File tanpa schemaVersion — diperlakukan sebagai ekspor legacy (v0).",
    });
  } else {
    return {
      ok: false,
      error: `schemaVersion bertipe tidak valid (${typeof rawVersion}).`,
    };
  }

  if (sourceVersion > CURRENT_SCHEMA_VERSION) {
    warnings.push({
      code: "future_schema_version",
      detail: `File memakai schemaVersion ${sourceVersion}, lebih baru dari yang dikenali (${CURRENT_SCHEMA_VERSION}). Field baru akan dipertahankan di "extra".`,
    });
  }

  // Jalankan rantai migrasi sebelum validasi field, agar semua pemeriksaan
  // di bawah beroperasi pada bentuk v_current.
  const { migrated, applied } = runMigrations(raw, sourceVersion);
  for (const step of applied) {
    warnings.push({
      code: "migrated",
      detail: `Migrasi v${step.from}→v${step.to}: ${step.description}`,
    });
  }

  const schemaName = asString(migrated.schemaName);
  if (schemaName && schemaName !== SCHEMA_NAME) {
    warnings.push({
      code: "wrong_schema_name",
      detail: `schemaName="${schemaName}" (diharapkan "${SCHEMA_NAME}"). Tetap diproses.`,
    });
  }

  const exportedAt =
    asString(migrated.exportedAt) ??
    asString(migrated.generatedAt) ?? // alias legacy — safety net bila migrator dilewati
    null;
  if (!exportedAt) {
    warnings.push({ code: "missing_field", detail: "Field exportedAt/generatedAt tidak ada." });
  }

  const permission = asObjOrNull(migrated.permission);
  if (!permission) warnings.push({ code: "missing_field", detail: "Bagian permission tidak ada." });
  const frame = asObjOrNull(migrated.frame);
  if (!frame) warnings.push({ code: "missing_field", detail: "Bagian frame tidak ada." });
  const serviceWorker = asObjOrNull(migrated.serviceWorker);
  if (!serviceWorker) warnings.push({ code: "missing_field", detail: "Bagian serviceWorker tidak ada." });
  const pushSubscription = asObjOrNull(migrated.pushSubscription);
  if (!pushSubscription)
    warnings.push({ code: "missing_field", detail: "Bagian pushSubscription tidak ada." });

  const tzRaw = asObjOrNull(migrated.timezone);
  const timezone = tzRaw
    ? {
        label: asString(tzRaw.label),
        offsetMinutes:
          typeof tzRaw.offsetMinutes === "number" && Number.isFinite(tzRaw.offsetMinutes)
            ? tzRaw.offsetMinutes
            : null,
        iana: asString(tzRaw.iana),
      }
    : null;

  const known = new Set([
    "schemaVersion",
    "schemaName",
    "exportedAt",
    "exportedAtLocal",
    "timezone",
    "generatedAt",
    "origin",
    "userAgent",
    "permission",
    "frame",
    "serviceWorker",
    "pushSubscription",
  ]);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(migrated)) {
    if (!known.has(k)) extra[k] = v;
  }

  const targetVersion =
    sourceVersion > CURRENT_SCHEMA_VERSION ? sourceVersion : CURRENT_SCHEMA_VERSION;

  const snapshot: NormalizedSnapshot = {
    schemaVersion: targetVersion,
    schemaName: SCHEMA_NAME,
    exportedAt,
    exportedAtLocal: asString(migrated.exportedAtLocal),
    timezone,
    origin: asString(migrated.origin),
    userAgent: asString(migrated.userAgent),
    permission,
    frame,
    serviceWorker,
    pushSubscription,
  };
  if (Object.keys(extra).length > 0) snapshot.extra = extra;

  return {
    ok: true,
    snapshot,
    sourceVersion,
    appliedMigrations: applied,
    rawBefore: raw,
    rawAfter: migrated,
    warnings,
  };
}

export async function readFileAsText(file: File): Promise<string> {
  if (typeof (file as unknown as { text?: () => Promise<string> }).text === "function") {
    return (file as unknown as { text: () => Promise<string> }).text();
  }
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsText(file);
  });
}