/**
 * Sumber tunggal kebenaran "paket aktif" (belum Riwayat Terkirim).
 *
 * Kontrak: sebuah prep dianggap AKTIF ketika `sold_at` masih null. Setiap
 * badge angka, filter list, dan query server-side WAJIB memakai helper di
 * modul ini supaya angka konsisten di semua permukaan (kartu ringkasan,
 * daftar detail, sinkronisasi worker portal, dsb).
 *
 * Jangan menulis literal `!p.sold_at` / `.is("sold_at", null)` di luar file
 * ini kecuali untuk baris pembanding (tes atau logika berbeda seperti
 * pemrosesan tanggal Riwayat Terkirim).
 */

// Kolom minimum yang dibutuhkan predikat. Semua tipe prep di aplikasi
// (RequestPreparation, EcerPreparation) memenuhi bentuk ini.
export type PrepLike = { sold_at?: string | null };

/** True bila prep belum masuk Riwayat Terkirim. */
export function isActivePrep(p: PrepLike): boolean {
  return !p.sold_at;
}

/** True bila prep sudah masuk Riwayat Terkirim (kebalikan isActivePrep). */
export function isSentPrep(p: PrepLike): boolean {
  return !!p.sold_at;
}

/** Sub-array prep yang masih aktif (badge angka & grid utama pakai ini). */
export function filterActivePreps<T extends PrepLike>(preps: readonly T[]): T[] {
  return preps.filter(isActivePrep);
}

/** Sub-array prep yang sudah terkirim (tab/section Riwayat Terkirim). */
export function filterSentPreps<T extends PrepLike>(preps: readonly T[]): T[] {
  return preps.filter(isSentPrep);
}

/** Jumlah prep aktif. Setara `filterActivePreps(preps).length` tanpa alokasi. */
export function countActivePreps(preps: readonly PrepLike[]): number {
  let n = 0;
  for (const p of preps) if (isActivePrep(p)) n++;
  return n;
}

/**
 * Bucket prep aktif per `title_id` — dipakai kartu "N paket / N kotak siap"
 * di ReadyRequestSection dan ReadyEcerSection.
 */
export function countActiveByTitle<T extends PrepLike & { title_id?: string | null }>(
  preps: readonly T[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of preps) {
    if (!isActivePrep(p)) continue;
    const key = p.title_id;
    if (!key) continue;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/**
 * Terapkan filter "aktif" ke query builder Supabase (`sold_at IS NULL`)
 * untuk badge yang dihitung server-side. Return builder yang sama supaya
 * bisa di-chain: `withActivePrepsFilter(sb.from("...").select("..."))`.
 *
 * Bila caller sengaja butuh SEMUA prep (aktif + sold, mis. layar detail
 * yang punya section Riwayat Terkirim), jangan pakai helper ini — biarkan
 * filter dilakukan di klien lewat `filterActivePreps` / `filterSentPreps`.
 */
export function withActivePrepsFilter<Q extends { is: (col: string, val: unknown) => Q }>(
  builder: Q,
): Q {
  return builder.is("sold_at", null);
}
