/**
 * SSOT untuk kolom `debts.source`.
 *
 * Nilai harus SAMA PERSIS dengan constraint database `debts_source_check`:
 *   CHECK (source = ANY (ARRAY['manual','purchase','sale','request_prep','ecer_prep']))
 *
 * Setiap client-side insert ke tabel `debts` WAJIB melewati
 * `assertDebtSource()` sebelum dikirim ke Supabase — jika tidak, Postgres akan
 * menolak dengan pesan constraint yang tidak ramah pengguna.
 *
 * Sumber lain (mis. `request_prep` / `ecer_prep`) hanya di-insert oleh RPC
 * server-side; tidak boleh dipakai dari klien.
 */
export const DEBT_SOURCES = ["manual", "purchase", "sale", "request_prep", "ecer_prep"] as const;
export type DebtSource = (typeof DEBT_SOURCES)[number];

/** Sumber yang boleh di-insert langsung dari UI (bukan lewat RPC). */
export const CLIENT_DEBT_SOURCES: readonly DebtSource[] = ["manual", "purchase", "sale"] as const;

/**
 * Runtime guard: lempar `Error` yang informatif bila `source` tidak sesuai
 * `debts_source_check`. Dipakai di semua callsite insert `debts` dari klien.
 */
export function assertDebtSource(source: string): DebtSource {
  if (!(DEBT_SOURCES as readonly string[]).includes(source)) {
    throw new Error(
      `Sumber transaksi hutang/piutang tidak valid: "${source}". ` +
        `Harus salah satu dari: ${DEBT_SOURCES.join(", ")}.`,
    );
  }
  return source as DebtSource;
}
// Self-test dipindahkan ke `src/lib/debt-source.test.ts` — modul ini
// tidak lagi menjalankan efek samping saat diimpor. Menghindari
// ketergantungan pada `process.env.NODE_ENV` pada jalur klien
// (runtime browser tidak menjamin nilai tersebut).