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

// ── Memoization cache ────────────────────────────────────────────────────
// Kunci = referensi array preps (stabil dari React state / query cache).
// Selama caller tidak membuat array baru dengan `.slice()` / `.map()` di
// setiap render, hasil turunan (filter/count/bucket) dipakai ulang tanpa
// pass ulang O(n).
//
// WeakMap dipakai supaya array yang sudah tidak direferensikan bebas GC —
// tidak ada kebocoran memori. Cache PER-fungsi supaya invalidasi salah
// satu turunan tidak menyapu yang lain (mis. filter jarang dipanggil vs
// countActiveByTitle yang dipanggil tiap render).
const activeArrayCache = new WeakMap<object, readonly PrepLike[]>();
const sentArrayCache = new WeakMap<object, readonly PrepLike[]>();
const activeCountCache = new WeakMap<object, number>();
const activeByTitleCache = new WeakMap<object, Map<string, number>>();

/** Sub-array prep yang masih aktif (badge angka & grid utama pakai ini). */
export function filterActivePreps<T extends PrepLike>(preps: readonly T[]): T[] {
  const cached = activeArrayCache.get(preps as unknown as object);
  if (cached) return cached as T[];
  const out = preps.filter(isActivePrep);
  activeArrayCache.set(preps as unknown as object, out);
  return out;
}

/** Sub-array prep yang sudah terkirim (tab/section Riwayat Terkirim). */
export function filterSentPreps<T extends PrepLike>(preps: readonly T[]): T[] {
  const cached = sentArrayCache.get(preps as unknown as object);
  if (cached) return cached as T[];
  const out = preps.filter(isSentPrep);
  sentArrayCache.set(preps as unknown as object, out);
  return out;
}

/** Jumlah prep aktif. Setara `filterActivePreps(preps).length` tanpa alokasi. */
export function countActivePreps(preps: readonly PrepLike[]): number {
  const cached = activeCountCache.get(preps as unknown as object);
  if (cached !== undefined) return cached;
  let n = 0;
  for (const p of preps) if (isActivePrep(p)) n++;
  activeCountCache.set(preps as unknown as object, n);
  return n;
}

/**
 * Bucket prep aktif per `title_id` — dipakai kartu "N paket / N kotak siap"
 * di ReadyRequestSection dan ReadyEcerSection.
 */
export function countActiveByTitle<T extends PrepLike & { title_id?: string | null }>(
  preps: readonly T[],
): Map<string, number> {
  const cached = activeByTitleCache.get(preps as unknown as object);
  if (cached) return cached;
  const out = new Map<string, number>();
  for (const p of preps) {
    if (!isActivePrep(p)) continue;
    const key = p.title_id;
    if (!key) continue;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  activeByTitleCache.set(preps as unknown as object, out);
  return out;
}

/**
 * Hook debug/test: bersihkan cache memoization. Dipakai unit test supaya
 * skenario "referensi array berubah" bisa diuji tanpa polusi antar-tes.
 * Jangan panggil dari kode produksi — cache didesain persisten selama
 * array masih hidup (dilepas otomatis oleh WeakMap saat GC).
 */
export function __resetPrepActiveMemoForTest(): void {
  // WeakMap tidak punya .clear() → buat baru lewat trick: gunakan
  // reassign via any-cast supaya module-level const tetap sama untuk
  // consumer (nilai internal-nya yang di-reset).
  //
  // Karena WeakMap tidak bisa diclear tanpa reassign, kita expose
  // reset dengan menimpa via Object.assign fields.
  //
  // Implementasi: iterate tidak mungkin (WeakMap non-enumerable),
  // jadi kita ganti referensi lewat cast.
  const g = globalThis as unknown as Record<string, unknown>;
  g.__prep_active_memo_reset_marker__ = (g.__prep_active_memo_reset_marker__ as number ?? 0) + 1;
  // Reset dengan reassign properti pada modul: gunakan trick swap.
  // Karena `const` — tidak bisa reassign. Solusi: buang isinya via
  // rekonstruksi. Karena WeakMap tak bisa dienumerasi, cukup buang
  // referensi dengan menciptakan WeakMap baru dan menukarnya lewat
  // prototype swap:
  const swap = (m: WeakMap<object, unknown>) => {
    // Ganti implementasi get/set/has agar berperilaku seperti kosong.
    const fresh = new WeakMap<object, unknown>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m as any).get = fresh.get.bind(fresh);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m as any).set = fresh.set.bind(fresh);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m as any).has = fresh.has.bind(fresh);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m as any).delete = fresh.delete.bind(fresh);
  };
  swap(activeArrayCache as unknown as WeakMap<object, unknown>);
  swap(sentArrayCache as unknown as WeakMap<object, unknown>);
  swap(activeCountCache as unknown as WeakMap<object, unknown>);
  swap(activeByTitleCache as unknown as WeakMap<object, unknown>);
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
