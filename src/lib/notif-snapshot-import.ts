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
    | "future_partial_migration"
    | "unknown_field_preserved"
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

/**
 * Mode kompatibilitas hasil impor:
 * - `exact`             : versi sumber = versi saat ini, tidak ada migrasi.
 * - `forward_migrated`  : versi sumber < versi saat ini dan seluruhnya berhasil dinaikkan.
 * - `backward_partial`  : versi sumber > versi saat ini; sistem mencoba
 *                         downgrade parsial. Field yang tidak dikenali
 *                         disimpan di `snapshot.extra` dan dicatat.
 */
export type CompatibilityInfo = {
  mode: "exact" | "forward_migrated" | "backward_partial";
  sourceVersion: number;
  targetVersion: number;
  /** Selisih versi yang belum tercakup oleh downgrader (biasanya > 0 pada backward_partial). */
  versionGap: number;
  /** Top-level keys yang tidak dikenali versi saat ini dan disimpan di `extra`. */
  unknownTopLevelFields: string[];
};

/**
 * Masalah validasi field terikat pada path spesifik pada bentuk raw
 * (setelah migrasi). Path memakai notasi dot, mis. `permission.state`
 * atau `timezone.offsetMinutes`.
 */
export type FieldIssue = {
  path: string;
  code: "missing" | "wrong_type" | "empty" | "invalid_enum";
  severity: "error" | "warning";
  expected: string;
  got: string;
  detail: string;
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
      /** Masalah per-path pada bentuk pasca-migrasi (missing/wrong_type/…). */
      fieldIssues: FieldIssue[];
      /** Ringkasan mode kompatibilitas untuk konsumen UI. */
      compatibility: CompatibilityInfo;
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

/** Helper: baca nilai pada path dot-notation, mis. `permission.state`. */
function getPath(root: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = root;
  for (const p of parts) {
    if (!isObj(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

type FieldRule = {
  path: string;
  type: "string" | "number" | "boolean" | "object";
  required: boolean;
  /** Untuk string: jika true, string kosong dianggap `empty`. */
  nonEmpty?: boolean;
  /** Untuk string: whitelist nilai yang valid. */
  enum?: readonly string[];
  /** Level ketegasan; default "error" untuk required, "warning" untuk optional. */
  severity?: "error" | "warning";
};

/**
 * Skema field per path untuk v_current. Menambah aturan baru di sini otomatis
 * ikut divalidasi tanpa mengubah konsumen.
 */
const FIELD_RULES: FieldRule[] = [
  { path: "schemaVersion", type: "number", required: true },
  { path: "schemaName", type: "string", required: false, severity: "warning" },
  { path: "exportedAt", type: "string", required: true, nonEmpty: true },
  { path: "exportedAtLocal", type: "string", required: false, severity: "warning" },
  { path: "origin", type: "string", required: false, severity: "warning" },
  { path: "userAgent", type: "string", required: false, severity: "warning" },

  { path: "timezone", type: "object", required: false, severity: "warning" },
  { path: "timezone.label", type: "string", required: false, severity: "warning" },
  { path: "timezone.offsetMinutes", type: "number", required: false, severity: "warning" },
  { path: "timezone.iana", type: "string", required: false, severity: "warning" },

  { path: "permission", type: "object", required: true },
  {
    path: "permission.state",
    type: "string",
    required: true,
    enum: ["granted", "denied", "default", "unsupported"],
  },

  { path: "frame", type: "object", required: true },
  { path: "frame.inIframe", type: "boolean", required: true },

  { path: "serviceWorker", type: "object", required: true },
  { path: "serviceWorker.state", type: "string", required: false, severity: "warning" },

  { path: "pushSubscription", type: "object", required: true },
  { path: "pushSubscription.active", type: "boolean", required: true },
];

function validateFields(root: Record<string, unknown>): FieldIssue[] {
  const issues: FieldIssue[] = [];
  for (const rule of FIELD_RULES) {
    // Bila parent object tidak ada, jangan spam issue untuk anak — parent
    // sudah menghasilkan `missing`.
    const parent = rule.path.includes(".")
      ? getPath(root, rule.path.slice(0, rule.path.lastIndexOf(".")))
      : root;
    if (!isObj(parent)) continue;

    const value = getPath(root, rule.path);
    const severity: "error" | "warning" =
      rule.severity ?? (rule.required ? "error" : "warning");

    if (value === undefined || value === null) {
      if (rule.required) {
        issues.push({
          path: rule.path,
          code: "missing",
          severity,
          expected: rule.type,
          got: value === null ? "null" : "undefined",
          detail: `Field wajib \`${rule.path}\` tidak ada.`,
        });
      }
      continue;
    }

    const actual = typeName(value);
    const typeOk =
      rule.type === "object"
        ? isObj(value)
        : rule.type === "number"
          ? typeof value === "number" && Number.isFinite(value)
          : typeof value === rule.type;

    if (!typeOk) {
      issues.push({
        path: rule.path,
        code: "wrong_type",
        severity,
        expected: rule.type,
        got: actual,
        detail: `Field \`${rule.path}\` bertipe ${actual}, diharapkan ${rule.type}.`,
      });
      continue;
    }

    if (rule.type === "string") {
      const s = value as string;
      if (rule.nonEmpty && s.trim() === "") {
        issues.push({
          path: rule.path,
          code: "empty",
          severity,
          expected: "string non-kosong",
          got: '""',
          detail: `Field \`${rule.path}\` string kosong.`,
        });
        continue;
      }
      if (rule.enum && !rule.enum.includes(s)) {
        issues.push({
          path: rule.path,
          code: "invalid_enum",
          severity,
          expected: rule.enum.join(" | "),
          got: JSON.stringify(s),
          detail: `Nilai \`${rule.path}\`="${s}" bukan salah satu ${rule.enum.join(", ")}.`,
        });
      }
    }
  }
  return issues;
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

/**
 * Rantai downgrade opsional untuk file dari versi masa depan
 * (`schemaVersion > CURRENT_SCHEMA_VERSION`). Sistem akan mencoba menurunkan
 * versi selangkah demi selangkah. Bila tidak ada entry untuk versi tertentu,
 * sisa perjalanan dianggap `backward_partial`: field yang tidak dikenali
 * disimpan di `snapshot.extra` dan dilaporkan ke user.
 */
type Downgrade = {
  from: number;
  to: number; // to = from - 1
  description: string;
  migrate: (raw: Record<string, unknown>) => Record<string, unknown>;
};

const DOWNGRADES: Downgrade[] = [
  // Kosong untuk sekarang — tambah entry mis. { from: 2, to: 1, ... } bila
  // suatu saat perlu menerima file v2 di build lama.
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

function runDowngrades(
  raw: Record<string, unknown>,
  from: number,
): { migrated: Record<string, unknown>; applied: AppliedMigration[]; landedAt: number } {
  let current = raw;
  let version = from;
  const applied: AppliedMigration[] = [];
  const maxSteps = DOWNGRADES.length + 1;
  for (let i = 0; i < maxSteps; i++) {
    if (version <= CURRENT_SCHEMA_VERSION) break;
    const step = DOWNGRADES.find((d) => d.from === version);
    if (!step) break;
    current = step.migrate(current);
    applied.push({ from: step.from, to: step.to, description: step.description });
    version = step.to;
  }
  return { migrated: current, applied, landedAt: version };
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

  const fieldIssues = validateFields(migrated);

  return {
    ok: true,
    snapshot,
    sourceVersion,
    appliedMigrations: applied,
    rawBefore: raw,
    rawAfter: migrated,
    warnings,
    fieldIssues,
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