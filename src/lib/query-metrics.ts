/**
 * Metrik latensi query ringan (client-side).
 *
 * Tujuan: memantau dampak indeks parsial pada query "prep aktif" dan
 * "badge count aktif" per pengguna di production, tanpa membebani hot-path.
 *
 * Desain minimal:
 *  - `measureQuery(name, fn, meta?)` membungkus panggilan Supabase, mencatat
 *    durasi (performance.now) + jumlah baris hasil, lalu fire-and-forget
 *    insert ke `public.query_metrics` (RLS: hanya milik user itu sendiri).
 *  - Sampling: default 20% agar tidak menggandakan traffic tulis. Ganti via
 *    `setQueryMetricsSampleRate(1)` untuk debug lokal.
 *  - Kegagalan insert metrik TIDAK boleh mempengaruhi hasil query utama —
 *    semua error di-swallow (best-effort telemetry).
 */
import { supabase } from "@/integrations/supabase/client";

let SAMPLE_RATE = 0.2;

export function setQueryMetricsSampleRate(rate: number) {
  SAMPLE_RATE = Math.max(0, Math.min(1, rate));
}

type QueryLike<T> = Promise<{ data: T | null; error: unknown }>;

function rowsOf(data: unknown): number | null {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === "object") return 1;
  return null;
}

async function report(
  name: string,
  durationMs: number,
  rowCount: number | null,
  meta?: Record<string, unknown>,
) {
  try {
    if (Math.random() > SAMPLE_RATE) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    await sb.from("query_metrics").insert({
      query_name: name,
      duration_ms: Math.round(durationMs),
      row_count: rowCount,
      meta: meta ?? null,
    });
  } catch {
    // best-effort — jangan bocorkan error ke UI
  }
}

/**
 * Ukur latensi promise Supabase query builder (bentuk `{ data, error }`).
 * Tetap mengembalikan hasil asli — pemanggil pakai seperti biasa.
 */
export async function measureQuery<T>(
  name: string,
  fn: () => QueryLike<T>,
  meta?: Record<string, unknown>,
): Promise<{ data: T | null; error: unknown }> {
  const t0 = performance.now();
  let ok = true;
  let res: { data: T | null; error: unknown };
  try {
    res = await fn();
    if (res && res.error) ok = false;
  } catch (e) {
    ok = false;
    res = { data: null, error: e };
  }
  const dt = performance.now() - t0;
  void report(name, dt, ok ? rowsOf(res.data) : null, { ok, ...(meta ?? {}) });
  return res;
}

/** Nama kanonik metrik agar konsisten di semua permukaan. */
export const QueryMetricNames = {
  ecerPrepAktif: "ecer_prep_aktif_list",
  requestPrepAktifBadge: "request_prep_aktif_badge_count",
} as const;