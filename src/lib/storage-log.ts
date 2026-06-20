export type StorageOp =
  | "list"
  | "upload"
  | "download"
  | "remove"
  | "createSignedUrl"
  | "getPublicUrl"
  | "move"
  | "copy";

export interface StorageErrorContext {
  bucket: string;
  op: StorageOp;
  path?: string;
  /** Free-form caller tag, e.g. "ApkDownloadBanner" or "uploadEcerPhoto". */
  source?: string;
}

type AnyStorageError =
  | {
      message?: string;
      statusCode?: string | number;
      error?: string;
      hint?: string | null;
      name?: string;
    }
  | null
  | undefined;

/**
 * Parse known PostgREST/PG patterns out of a storage error message.
 * Storage errors from `storage.objects` RLS policies usually look like:
 *   "select * from storage.search(...) - permission denied for table <name>"
 * which means a policy USING-expression touched a table the caller can't read.
 */
function diagnose(message: string | undefined): {
  kind: "permission_denied" | "rls_violation" | "not_found" | "unknown";
  offendingObject?: string;
  hint?: string;
} {
  if (!message) return { kind: "unknown" };
  const m = message.toLowerCase();

  const permMatch = message.match(/permission denied for (?:table|relation|function)\s+([\w".]+)/i);
  if (permMatch) {
    return {
      kind: "permission_denied",
      offendingObject: permMatch[1],
      hint:
        `Sebuah RLS policy di storage.objects mengevaluasi "${permMatch[1]}" ` +
        `tapi role pemanggil tidak punya GRANT SELECT/EXECUTE di sana. ` +
        `Bungkus akses itu ke fungsi SECURITY DEFINER, atau berikan GRANT yang sesuai.`,
    };
  }
  if (m.includes("row-level security") || m.includes("violates row-level security")) {
    return {
      kind: "rls_violation",
      hint: "Tidak ada policy yang mengizinkan operasi ini untuk role/bucket/path tersebut.",
    };
  }
  if (m.includes("not found") || m.includes("object not found")) {
    return { kind: "not_found" };
  }
  return { kind: "unknown" };
}

/**
 * Log a Supabase Storage error with bucket/operation/path context so the
 * failing policy or function can be identified quickly in the console.
 * Returns true when an error was logged (caller can early-return).
 */
export function logStorageError(ctx: StorageErrorContext, error: AnyStorageError): boolean {
  if (!error) return false;
  const msg = (error as { message?: string }).message ?? String(error);
  const status = (error as { statusCode?: string | number }).statusCode;
  const diag = diagnose(msg);

  // Group keeps related lines collapsible per failure.
  // eslint-disable-next-line no-console
  console.groupCollapsed(
    `%c[storage:${ctx.op}] %c${ctx.bucket}%c ${diag.kind}`,
    "color:#a855f7;font-weight:600",
    "color:#0ea5e9;font-weight:600",
    "color:#ef4444;font-weight:600",
  );
  // eslint-disable-next-line no-console
  console.error("message:", msg);
  if (status !== undefined) {
    // eslint-disable-next-line no-console
    console.error("status :", status);
  }
  if (ctx.path) {
    // eslint-disable-next-line no-console
    console.error("path   :", ctx.path);
  }
  if (ctx.source) {
    // eslint-disable-next-line no-console
    console.error("source :", ctx.source);
  }
  if (diag.offendingObject) {
    // eslint-disable-next-line no-console
    console.error("blocked by:", diag.offendingObject);
  }
  if (diag.hint) {
    // eslint-disable-next-line no-console
    console.error("hint   :", diag.hint);
  }
  // eslint-disable-next-line no-console
  console.groupEnd();
  return true;
}

/**
 * Convenience: await any storage promise that resolves to `{ data, error }`
 * and log on failure. Returns the original result untouched.
 */
export async function withStorageLogging<T extends { error: AnyStorageError }>(
  ctx: StorageErrorContext,
  promise: Promise<T>,
): Promise<T> {
  const result = await promise;
  logStorageError(ctx, result.error);
  return result;
}