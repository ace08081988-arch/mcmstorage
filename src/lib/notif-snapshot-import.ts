/**
 * Impor & validasi snapshot Status Notifikasi (`mcm.notifikasi-status`).
 *
 * Membaca `schemaVersion` dan menormalkan file lama (pre-schemaVersion) supaya
 * tetap bisa dibaca. Struktur:
 *
 * - v1 (current): { schemaVersion:1, schemaName, exportedAt, timezone, permission,
 *                   frame, serviceWorker, pushSubscription, ... }
 * - v0 (legacy) : ekspor lama tanpa `schemaVersion`; biasanya cuma memiliki
 *                 `generatedAt`, `permission`, `frame`, `serviceWorker`,
 *                 `pushSubscription`. Dinormalkan ke bentuk v1.
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
    | "coerced_field";
  detail: string;
};

export type ImportResult =
  | {
      ok: true;
      snapshot: NormalizedSnapshot;
      sourceVersion: number; // 0 untuk file legacy
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

  const schemaName = asString(raw.schemaName);
  if (schemaName && schemaName !== SCHEMA_NAME) {
    warnings.push({
      code: "wrong_schema_name",
      detail: `schemaName="${schemaName}" (diharapkan "${SCHEMA_NAME}"). Tetap diproses.`,
    });
  }

  const exportedAt =
    asString(raw.exportedAt) ??
    asString(raw.generatedAt) ?? // alias legacy
    null;
  if (!exportedAt) {
    warnings.push({ code: "missing_field", detail: "Field exportedAt/generatedAt tidak ada." });
  }

  const permission = asObjOrNull(raw.permission);
  if (!permission) warnings.push({ code: "missing_field", detail: "Bagian permission tidak ada." });
  const frame = asObjOrNull(raw.frame);
  if (!frame) warnings.push({ code: "missing_field", detail: "Bagian frame tidak ada." });
  const serviceWorker = asObjOrNull(raw.serviceWorker);
  if (!serviceWorker) warnings.push({ code: "missing_field", detail: "Bagian serviceWorker tidak ada." });
  const pushSubscription = asObjOrNull(raw.pushSubscription);
  if (!pushSubscription)
    warnings.push({ code: "missing_field", detail: "Bagian pushSubscription tidak ada." });

  const tzRaw = asObjOrNull(raw.timezone);
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
  for (const [k, v] of Object.entries(raw)) {
    if (!known.has(k)) extra[k] = v;
  }

  const snapshot: NormalizedSnapshot = {
    schemaVersion: sourceVersion === 0 ? CURRENT_SCHEMA_VERSION : sourceVersion,
    schemaName: SCHEMA_NAME,
    exportedAt,
    exportedAtLocal: asString(raw.exportedAtLocal),
    timezone,
    origin: asString(raw.origin),
    userAgent: asString(raw.userAgent),
    permission,
    frame,
    serviceWorker,
    pushSubscription,
  };
  if (Object.keys(extra).length > 0) snapshot.extra = extra;

  return { ok: true, snapshot, sourceVersion, warnings };
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