/**
 * Alokasi pembayaran hutang/piutang ke tagihan (invoice) terlama lebih dulu.
 *
 * Dipakai bersama oleh:
 * - pratinjau "Rincian pembayaran" di panel Tagihan header chat, dan
 * - penulisan baris `debt_payments` yang sebenarnya.
 *
 * Keduanya WAJIB memakai fungsi ini supaya angka yang dilihat pemilik toko
 * di pratinjau persis sama dengan yang tersimpan (FIFO by created_at).
 */

export type AllocDebt = {
  id: string;
  kind: "hutang" | "piutang";
  amount: number | string;
  created_at: string;
};

export type AllocLine = {
  debtId: string;
  /** Label invoice ringkas untuk ditampilkan (#kode). */
  invoice: string;
  createdAt: string;
  /** Nilai tagihan awal. */
  total: number;
  /** Sisa tagihan sebelum pembayaran ini. */
  before: number;
  /** Nominal yang dipakai untuk tagihan ini. */
  used: number;
  /** Sisa tagihan setelah pembayaran ini. */
  after: number;
};

export type AllocPlan = {
  lines: AllocLine[];
  /** Total yang benar-benar teralokasi. */
  applied: number;
  /** Sisa input yang tidak terpakai (melebihi total tagihan). */
  leftover: number;
};

export function invoiceLabel(debtId: string): string {
  return `#${debtId.slice(0, 8).toUpperCase()}`;
}

/** Susun rencana alokasi FIFO: tagihan tertua dilunasi lebih dulu. */
export function planDebtPayment({
  debts,
  paidByDebt,
  kind,
  amount,
}: {
  debts: AllocDebt[];
  paidByDebt: Map<string, number>;
  kind: "hutang" | "piutang";
  amount: number;
}): AllocPlan {
  let left = Math.max(0, Math.round(amount));
  const lines: AllocLine[] = [];
  const open = debts
    .filter((d) => d.kind === kind)
    .map((d) => {
      const total = Number(d.amount) || 0;
      const before = Math.max(0, total - (paidByDebt.get(d.id) ?? 0));
      return { d, total, before };
    })
    .filter((x) => x.before > 0)
    // FIFO: created_at paling lama duluan.
    .sort((a, b) => (a.d.created_at < b.d.created_at ? -1 : a.d.created_at > b.d.created_at ? 1 : 0));

  for (const x of open) {
    if (left <= 0) break;
    const used = Math.min(left, x.before);
    lines.push({
      debtId: x.d.id,
      invoice: invoiceLabel(x.d.id),
      createdAt: x.d.created_at,
      total: x.total,
      before: x.before,
      used,
      after: x.before - used,
    });
    left -= used;
  }

  return {
    lines,
    applied: lines.reduce((s, l) => s + l.used, 0),
    leftover: left,
  };
}
