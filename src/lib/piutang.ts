/**
 * H1: SSOT tunggal untuk total piutang.
 *
 * Sebelum ini Dashboard membaca hanya tabel `debts.kind='piutang'`,
 * sedangkan Gudang/Hutang-Piutang menurunkan dari `sales.payment_method='hutang'`
 * dikurangi `customer_payments`. Dua kanal → angka piutang di Dashboard
 * bisa jauh lebih kecil dari kenyataan.
 *
 * Sekarang kedua sumber dijumlahkan di RPC `piutang_summary_v1` (view db-side),
 * sehingga semua permukaan yang menampilkan "Total Piutang" pakai angka yang
 * sama, terisolasi per user via RLS/auth.uid().
 */
import { supabase } from "@/integrations/supabase/client";

export type PiutangSummary = {
  sales_hutang_gross: number;
  sales_hutang_paid: number;
  manual_gross: number;
  manual_paid: number;
  total_outstanding: number;
};

const ZERO: PiutangSummary = {
  sales_hutang_gross: 0,
  sales_hutang_paid: 0,
  manual_gross: 0,
  manual_paid: 0,
  total_outstanding: 0,
};

export async function fetchPiutangSummary(): Promise<PiutangSummary> {
  const { data, error } = await supabase.rpc("piutang_summary_v1");
  if (error || !data) return ZERO;
  const d = data as Partial<PiutangSummary> | null;
  if (!d || typeof d !== "object") return ZERO;
  return {
    sales_hutang_gross: Number(d.sales_hutang_gross) || 0,
    sales_hutang_paid: Number(d.sales_hutang_paid) || 0,
    manual_gross: Number(d.manual_gross) || 0,
    manual_paid: Number(d.manual_paid) || 0,
    total_outstanding: Number(d.total_outstanding) || 0,
  };
}

/**
 * Derivasi klien murni dari row `sales` + `customer_payments` + `debts` +
 * `debt_payments` — dipakai sebagai kanari saat data sudah ada di memori
 * (mis. Gudang) dan tidak perlu round-trip RPC. Rumus identik dengan
 * `piutang_summary_v1`.
 */
export function derivePiutangFromRows(input: {
  sales: Array<{ payment_method: string; total_revenue: number | string }>;
  customerPayments: Array<{ amount: number | string }>;
  debts: Array<{ kind: string; amount: number | string; id: string }>;
  debtPayments: Array<{ debt_id: string; amount: number | string }>;
}): PiutangSummary {
  let salesHutang = 0;
  for (const s of input.sales) {
    if (s.payment_method === "hutang") salesHutang += Number(s.total_revenue) || 0;
  }
  let paidCust = 0;
  for (const p of input.customerPayments) paidCust += Number(p.amount) || 0;
  const piutangDebtIds = new Set<string>();
  let manualGross = 0;
  for (const d of input.debts) {
    if (d.kind === "piutang") {
      manualGross += Number(d.amount) || 0;
      piutangDebtIds.add(d.id);
    }
  }
  let manualPaid = 0;
  for (const dp of input.debtPayments) {
    if (piutangDebtIds.has(dp.debt_id)) manualPaid += Number(dp.amount) || 0;
  }
  const outstanding =
    Math.max(salesHutang - paidCust, 0) + Math.max(manualGross - manualPaid, 0);
  return {
    sales_hutang_gross: salesHutang,
    sales_hutang_paid: paidCust,
    manual_gross: manualGross,
    manual_paid: manualPaid,
    total_outstanding: outstanding,
  };
}
