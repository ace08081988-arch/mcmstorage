/**
 * SSOT untuk kolom `debts.source`.
 *
 * Nilai harus SAMA PERSIS dengan constraint database `debts_source_check`:
 *   CHECK (source = ANY (ARRAY['manual','purchase','sale','request_prep']))
 *
 * Setiap client-side insert ke tabel `debts` WAJIB melewati
 * `assertDebtSource()` sebelum dikirim ke Supabase — jika tidak, Postgres akan
 * menolak dengan pesan constraint yang tidak ramah pengguna.
 *
 * Sumber lain (mis. `request_prep`) hanya di-insert oleh RPC server-side
 * (`send_request_prep_to_customer`); tidak boleh dipakai dari klien.
 */
export const DEBT_SOURCES = ["manual", "purchase", "sale", "request_prep"] as const;
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

// ---------------------------------------------------------------------------
// Self-test (inline) — validasi allowlist & guard tanpa framework, dijalankan
// hanya saat `NODE_ENV === "test"` agar tidak menambah beban runtime produksi.
// ---------------------------------------------------------------------------
if (typeof process !== "undefined" && process.env?.NODE_ENV === "test") {
  const cases: Array<[string, boolean]> = [
    ["manual", true],
    ["purchase", true],
    ["sale", true],
    ["request_prep", true],
    ["chat", false],
    ["", false],
    ["MANUAL", false],
  ];
  for (const [input, ok] of cases) {
    let threw = false;
    try {
      assertDebtSource(input);
    } catch {
      threw = true;
    }
    if (ok === threw) {
      throw new Error(
        `debt-source self-test gagal: input="${input}" expected ok=${ok}, threw=${threw}`,
      );
    }
  }
}