export const DEFAULT_SUPABASE_QUERY_TIMEOUT_MS = 12_000;

export type SupabaseQueryResult<T> = {
  data: T | null;
  error: {
    code?: string;
    message?: string;
    hint?: string;
    details?: string;
  } | null;
};

export function isQueryTimeoutError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /query-timeout|abort|aborted|AbortError/i.test(msg);
}

export async function withSupabaseQueryTimeout<T>(
  run: (signal: AbortSignal) => PromiseLike<T>,
  label = "query",
  ms = DEFAULT_SUPABASE_QUERY_TIMEOUT_MS,
): Promise<T> {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, ms);

  try {
    return await Promise.resolve(run(ctrl.signal));
  } catch (err) {
    if (timedOut || isQueryTimeoutError(err)) {
      throw new Error(`${label}-query-timeout`);
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function withPlainTimeout<T>(
  promise: PromiseLike<T>,
  label = "operation",
  ms = DEFAULT_SUPABASE_QUERY_TIMEOUT_MS,
): Promise<T> {
  let timer: number | null = null;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(`${label}-timeout`)), ms);
      }),
    ]);
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}