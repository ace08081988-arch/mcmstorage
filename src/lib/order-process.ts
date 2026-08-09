/**
 * Wrapper RPC `order_process_v1`: satu-satunya jalan memproses pesanan gudang
 * menjadi penjualan. Atomik + idempotent (satu pesanan = satu sale), sehingga
 * dua tab yang menekan tombol bersamaan tetap menghasilkan satu penjualan.
 */
import { supabase } from "@/integrations/supabase/client";
import type { PaymentMethod } from "@/lib/payment-summary";

export type ProcessOrderResult =
  | { ok: true; alreadyProcessed: boolean; saleId: string | null }
  | { ok: false; message: string };

export async function processOrder(
  orderId: string,
  method: PaymentMethod,
  paidAmount: number | null,
): Promise<ProcessOrderResult> {
  const { data, error } = await supabase.rpc("order_process_v1", {
    _order_id: orderId,
    _payment_method: method,
    ...(paidAmount == null ? {} : { _paid_amount: paidAmount }),
  });
  if (error) {
    const raw = error.message ?? "";
    const message = /sudah selesai/i.test(raw)
      ? "Pesanan sudah selesai — tidak bisa diproses ulang."
      : /Stok tidak cukup/i.test(raw)
        ? raw
        : /berhak|42501/i.test(raw)
          ? "Anda tidak berhak memproses pesanan ini."
          : raw || "Gagal memproses pesanan.";
    return { ok: false, message };
  }
  const payload = (data ?? {}) as { status?: string; sale_id?: string | null };
  return {
    ok: true,
    alreadyProcessed: payload.status === "already_processed",
    saleId: payload.sale_id ?? null,
  };
}
