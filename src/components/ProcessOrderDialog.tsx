/**
 * Dialog konfirmasi "Proses pesanan jadi penjualan".
 *
 * Metode bayar WAJIB dipilih eksplisit (tidak lagi hardcode kas). Konfirmasi
 * memanggil RPC atomik `order_process_v1` sehingga sale, pembayaran, piutang,
 * riwayat status, dan perubahan status terjadi sekali jalan dan idempotent.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { NumericTextField } from "@/components/NumericDraftInput";
import {
  getPaymentBreakdown, parsePaymentAmountInput, formatPaymentRupiah, type PaymentMethod,
} from "@/lib/payment-summary";

export function ProcessOrderDialog({
  open, onOpenChange, summary, total, busy, onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  summary: string;
  total: number;
  busy?: boolean;
  onConfirm: (method: PaymentMethod, paidAmount: number | null) => void | Promise<void>;
}) {
  const [method, setMethod] = useState<PaymentMethod>("kas");
  const [paidRaw, setPaidRaw] = useState("");

  useEffect(() => {
    if (open) { setMethod("kas"); setPaidRaw(""); }
  }, [open]);

  const payment = getPaymentBreakdown(method, total, parsePaymentAmountInput(paidRaw));
  const canSubmit = !busy && payment.partialValid;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Proses pesanan jadi penjualan</DialogTitle>
          <DialogDescription>{summary}</DialogDescription>
        </DialogHeader>
        <div className="space-y-ms-3">
          <div className="rounded-lg border bg-muted/40 p-ms-3 text-ms-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total</span>
              <span className="font-semibold tabular-nums">{formatPaymentRupiah(total)}</span>
            </div>
          </div>
          <div>
            <div className="mb-ms-1 text-ms-xs font-medium">Metode pembayaran</div>
            <div className="grid grid-cols-3 gap-ms-1">
              {(["kas", "partial", "hutang"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`app-hit-area rounded-md border px-ms-2 py-2 text-ms-2xs font-medium transition ${
                    method === m ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"
                  }`}
                >
                  {m === "kas" ? "Lunas" : m === "partial" ? "Bayar sebagian" : "Hutang"}
                </button>
              ))}
            </div>
          </div>
          {method === "partial" && (
            <div className="space-y-ms-1">
              <NumericTextField
                value={paidRaw}
                onValueChange={setPaidRaw}
                placeholder="Jumlah dibayar"
                inputMode="numeric"
              />
              {!payment.partialValid && (
                <div className="text-ms-2xs text-destructive">
                  Jumlah dibayar harus lebih dari 0 dan kurang dari total.
                </div>
              )}
            </div>
          )}
          {payment.remaining > 0 && payment.partialValid && (
            <div className="text-ms-2xs text-muted-foreground">
              Sisa {formatPaymentRupiah(payment.remaining)} dicatat sebagai piutang pelanggan.
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Batal</Button>
          <Button
            onClick={() => void onConfirm(method, method === "partial" ? payment.paid : null)}
            disabled={!canSubmit}
          >
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Proses
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
