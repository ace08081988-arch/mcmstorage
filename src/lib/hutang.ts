/**
 * SSOT tunggal untuk total hutang (mirror dari `piutang.ts`).
 *
 * Sebelum ini tab Hutang di Gudang hanya menjumlahkan
 * `purchases.payment_method='hutang'` dikurangi `supplier_payments`,
 * sedangkan halaman Hutang & Piutang menampilkan gabungan pembelian
 * hutang **plus** entri manual `debts.kind='hutang'` dikurangi
 * `debt_payments`. Dua kanal → total hutang di Gudang bisa lebih kecil
 * dari halaman utama.
 *
 * RPC `hutang_summary_v1` menjumlahkan kedua sumber db-side, terisolasi
 * per user via RLS/auth.uid().
 */
import { supabase } from "@/integrations/supabase/client";

export type HutangSummary = {
  purchase_hutang_gross: number;
  purchase_hutang_paid: number;
  manual_gross: number;
  manual_paid: number;
  total_outstanding: number;
};

const ZERO: HutangSummary = {
  purchase_hutang_gross: 0,
  purchase_hutang_paid: 0,
  manual_gross: 0,
  manual_paid: 0,
  total_outstanding: 0,
};

export async function fetchHutangSummary(): Promise<HutangSummary> {
  const { data, error } = await supabase.rpc("hutang_summary_v1");
  if (error || !data) return ZERO;
  const d = data as Partial<HutangSummary> | null;
  if (!d || typeof d !== "object") return ZERO;
  return {
    purchase_hutang_gross: Number(d.purchase_hutang_gross) || 0,
    purchase_hutang_paid: Number(d.purchase_hutang_paid) || 0,
    manual_gross: Number(d.manual_gross) || 0,
    manual_paid: Number(d.manual_paid) || 0,
    total_outstanding: Number(d.total_outstanding) || 0,
  };
}