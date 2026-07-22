/**
 * Dialog "Jual" untuk kartu tugas Siapkan Sendiri (/tugas).
 *
 * Alur:
 *  - Owner pilih pelanggan (link ke tabel `customers`) atau isi nama manual.
 *  - Tambah 1+ baris item: produk gudang + gram + harga per base.
 *    Cek stok per baris; tombol Simpan nonaktif bila total gram > stok.
 *  - Pilih metode bayar: Lunas / Hutang / Bayar sebagian. Bayar sebagian
 *    minta nominal yang dibayar (harus > 0 dan < total).
 *
 * Efek (client-side, dalam satu klik Simpan):
 *  1. INSERT ke `sales` per baris. `payment_method` = "kas" untuk Lunas,
 *     "hutang" untuk Hutang & Sebagian (agar dashboard piutang menghitungnya).
 *     Trigger DB memotong stok gudang otomatis.
 *  2. Untuk Hutang / Sebagian → INSERT sekali ke `debts` (kind=piutang,
 *     source='self_prep', source_id = self_prep_item.id, amount = SISA
 *     yang belum dibayar).
 *  3. UPDATE `self_prep_items` set sold_at / sold_customer_id / sold_total /
 *     sold_paid_amount / sold_payment_method / sold_debt_id / sold_summary.
 *
 * Bila salah satu INSERT sales gagal, baris yang sudah tersimpan
 * dihapus (rollback lunak). Ini fallback; validasi stok dilakukan di
 * awal supaya kegagalan jarang terjadi.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Send, Trash2, Plus, Loader2, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { NumericTextField } from "@/components/NumericDraftInput";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { rupiah, fmtItemQty } from "@/lib/stock-format";
import {
  parsePaymentAmountInput,
  getPaymentBreakdown,
  formatPaymentRupiah,
  type PaymentMethod,
} from "@/lib/payment-summary";
import { emitDebtTx } from "@/lib/debt-tx-event";

export type SellSelfPrepCustomer = { id: string; name: string; contact: string | null };
export type SellSelfPrepWarehouseItem = {
  id: string;
  name: string;
  package_type: string;
  package_size: number;
  base_unit: "g" | "pcs";
  stock_base: number;
  avg_cost_per_base: number;
};

export type SellSelfPrepResult = {
  soldTotal: number;
  soldPaid: number;
  soldMethod: PaymentMethod;
  soldSummary: string;
  soldCustomerId: string | null;
  soldDebtId: string | null;
};

type Line = {
  key: string;
  itemId: string;
  gramsStr: string;
  priceStr: string;
};

function newLine(defaultItemId = ""): Line {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    itemId: defaultItemId,
    gramsStr: "",
    priceStr: "",
  };
}

export function parseNum(s: string): number {
  // NumericTextField sudah mengeluarkan canonical string ("0.9", "900000")
  // dengan titik sebagai pemisah desimal. Jangan pakai parser display id-ID
  // (yang membuang titik sebagai ribuan) — akan membaca "0.9" jadi 9 dan
  // menggandakan subtotal 10× lipat.
  if (s === "" || s == null) return 0;
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  // Fallback: string dari sumber lama masih boleh display id-ID.
  return parsePaymentAmountInput(s);
}

export function SellSelfPrepDialog({
  open,
  onClose,
  uid,
  selfPrepId,
  selfPrepTitle,
  customers,
  warehouseItems,
  onSold,
}: {
  open: boolean;
  onClose: () => void;
  uid: string;
  selfPrepId: string;
  selfPrepTitle: string;
  customers: SellSelfPrepCustomer[];
  warehouseItems: SellSelfPrepWarehouseItem[];
  onSold: (r: SellSelfPrepResult) => void;
}) {
  const [mode, setMode] = useState<"link" | "manual">(customers.length > 0 ? "link" : "manual");
  const [customerId, setCustomerId] = useState<string>(customers[0]?.id ?? "");
  const [manualName, setManualName] = useState("");
  const [lines, setLines] = useState<Line[]>(() => [newLine(warehouseItems[0]?.id ?? "")]);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("kas");
  const [paidStr, setPaidStr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode(customers.length > 0 ? "link" : "manual");
    setCustomerId(customers[0]?.id ?? "");
    setManualName("");
    setLines([newLine(warehouseItems[0]?.id ?? "")]);
    setPayMethod("kas");
    setPaidStr("");
  }, [open, customers, warehouseItems, selfPrepId]);

  const itemMap = useMemo(() => {
    const m = new Map<string, SellSelfPrepWarehouseItem>();
    for (const it of warehouseItems) m.set(it.id, it);
    return m;
  }, [warehouseItems]);

  // Total gram per produk untuk validasi stok bila produk dipilih lebih
  // dari satu baris.
  const gramsPerItem = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const l of lines) {
      if (!l.itemId) continue;
      const g = parseNum(l.gramsStr);
      acc[l.itemId] = (acc[l.itemId] ?? 0) + (Number.isFinite(g) ? g : 0);
    }
    return acc;
  }, [lines]);

  const subtotals = useMemo(() => {
    return lines.map((l) => {
      const g = parseNum(l.gramsStr);
      const p = parseNum(l.priceStr);
      return Math.max(0, g) * Math.max(0, p);
    });
  }, [lines]);

  const totalAmount = useMemo(() => subtotals.reduce((s, v) => s + v, 0), [subtotals]);
  const paidAmount = useMemo(() => parseNum(paidStr), [paidStr]);
  const payment = useMemo(
    () => getPaymentBreakdown(payMethod, totalAmount, paidAmount),
    [payMethod, totalAmount, paidAmount],
  );

  const party = useMemo(() => {
    if (mode === "link") {
      const c = customers.find((x) => x.id === customerId);
      return { id: c?.id ?? null, name: c?.name ?? "", contact: c?.contact ?? null };
    }
    return { id: null as string | null, name: manualName.trim(), contact: null as string | null };
  }, [mode, customerId, manualName, customers]);

  const stockIssues = useMemo(() => {
    const issues: string[] = [];
    for (const [itemId, totalG] of Object.entries(gramsPerItem)) {
      const it = itemMap.get(itemId);
      if (!it) continue;
      if (totalG > Number(it.stock_base)) {
        issues.push(`Stok ${it.name} kurang (butuh ${fmtItemQty(totalG, it)}, tersedia ${fmtItemQty(it.stock_base, it)}).`);
      }
    }
    return issues;
  }, [gramsPerItem, itemMap]);

  const validLines = lines.length > 0 && lines.every((l, i) => {
    if (!l.itemId) return false;
    const g = parseNum(l.gramsStr);
    const p = parseNum(l.priceStr);
    return g > 0 && p >= 0 && subtotals[i] > 0;
  });

  const canSubmit =
    !!party.name &&
    validLines &&
    totalAmount > 0 &&
    stockIssues.length === 0 &&
    payment.partialValid &&
    !busy;

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, newLine(warehouseItems[0]?.id ?? "")]);
  }
  function removeLine(idx: number) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  function buildSummary(): string {
    const parts: string[] = [];
    lines.forEach((l, i) => {
      const it = itemMap.get(l.itemId);
      if (!it) return;
      const g = parseNum(l.gramsStr);
      const p = parseNum(l.priceStr);
      const sub = subtotals[i];
      parts.push(`• ${it.name} ${fmtItemQty(g, it)} × ${rupiah(p)}/${it.base_unit} = ${rupiah(sub)}`);
    });
    parts.push(`Total: ${formatPaymentRupiah(totalAmount)}`);
    parts.push(`Pembayaran: ${payment.label}`);
    if (payment.method === "partial") {
      parts.push(`Dibayar: ${formatPaymentRupiah(payment.paid)}`);
      parts.push(`Sisa piutang: ${formatPaymentRupiah(payment.remaining)}`);
    } else if (payment.method === "hutang") {
      parts.push(`Sisa piutang: ${formatPaymentRupiah(payment.remaining)}`);
    }
    parts.push(`Pelanggan: ${party.name}${party.contact ? ` (${party.contact})` : ""}`);
    return parts.join("\n");
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    const insertedSaleIds: string[] = [];
    let insertedDebtId: string | null = null;
    try {
      // 1) Sales per baris
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const it = itemMap.get(l.itemId);
        if (!it) throw new Error(`Baris ${i + 1}: produk tidak ditemukan.`);
        const g = parseNum(l.gramsStr);
        const p = parseNum(l.priceStr);
        const sub = subtotals[i];
        const paymentMethodForSale = payment.method === "kas" ? "kas" : "hutang";
        const { data, error } = await supabase.from("sales").insert({
          user_id: uid,
          item_id: it.id,
          qty_base: g,
          price_per_base: p,
          total_revenue: sub,
          cost_at_sale: Number(it.avg_cost_per_base) * g,
          note: `Tugas Siapkan Sendiri: ${selfPrepTitle}`,
          customer_id: party.id,
          payment_method: paymentMethodForSale,
        }).select("id").maybeSingle();
        if (error) throw error;
        if (data?.id) insertedSaleIds.push(data.id);
      }

      // 2) Debt untuk Hutang / Sebagian
      if (payment.method !== "kas" && payment.remaining > 0) {
        const { data, error } = await supabase.from("debts").insert({
          user_id: uid,
          kind: "piutang",
          party_name: party.name,
          customer_id: party.id,
          amount: payment.remaining,
          source: "self_prep",
          source_id: selfPrepId,
          note: `Tugas Siapkan Sendiri: ${selfPrepTitle}`,
        }).select("id").maybeSingle();
        if (error) throw error;
        insertedDebtId = data?.id ?? null;
      }

      // 3) Update self_prep_items
      const soldSummary = buildSummary();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: upErr } = await (supabase.from as any)("self_prep_items")
        .update({
          sold_at: new Date().toISOString(),
          sold_customer_id: party.id,
          sold_total: totalAmount,
          sold_paid_amount: payment.paid,
          sold_payment_method: payment.method === "partial" ? "partial" : payment.method,
          sold_debt_id: insertedDebtId,
          sold_summary: soldSummary,
        })
        .eq("id", selfPrepId);
      if (upErr) throw upErr;

      emitDebtTx({
        kind: "piutang",
        wasCash: payment.method === "kas",
        amount: payment.remaining,
        partyId: party.id ?? null,
        at: Date.now(),
      });

      toast.success(
        payment.method === "hutang"
          ? `Penjualan tercatat · Piutang ${rupiah(payment.remaining)}`
          : payment.method === "partial"
            ? `Penjualan tercatat · Dibayar ${rupiah(payment.paid)}, sisa ${rupiah(payment.remaining)} piutang`
            : `Penjualan tercatat · Lunas ${rupiah(totalAmount)}`,
      );
      onSold({
        soldTotal: totalAmount,
        soldPaid: payment.paid,
        soldMethod: payment.method,
        soldSummary,
        soldCustomerId: party.id,
        soldDebtId: insertedDebtId,
      });
    } catch (e) {
      const msg = (e as Error)?.message || "Gagal menyimpan penjualan.";
      toast.error(msg);
      // Rollback lunak
      if (insertedSaleIds.length) {
        await supabase.from("sales").delete().in("id", insertedSaleIds);
      }
      if (insertedDebtId) {
        await supabase.from("debts").delete().eq("id", insertedDebtId);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-ms-2 text-ms-base">
            <Send className="h-4 w-4 text-primary" /> Jual — {selfPrepTitle}
          </DialogTitle>
          <DialogDescription>
            Catat penjualan (potong stok & catat piutang). Setelah tersimpan, tombol WA/Chat akan aktif.
          </DialogDescription>
        </DialogHeader>

        <div className="space-ms-3 text-ms-xs">
          {/* Pelanggan */}
          <div>
            <Label className="mb-1 block text-ms-2xs font-medium">Pelanggan</Label>
            <div className="mb-1 flex gap-ms-1 text-ms-2xs">
              <button
                type="button"
                onClick={() => setMode("link")}
                className={`flex-1 rounded-md border px-ms-2 py-1 ${mode === "link" ? "border-primary bg-primary/10 font-semibold text-primary" : "hover:bg-accent"}`}
              >Pilih dari daftar</button>
              <button
                type="button"
                onClick={() => setMode("manual")}
                className={`flex-1 rounded-md border px-ms-2 py-1 ${mode === "manual" ? "border-primary bg-primary/10 font-semibold text-primary" : "hover:bg-accent"}`}
              >Ketik manual</button>
            </div>
            {mode === "link" ? (
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-xs"
              >
                {customers.length === 0 ? (
                  <option value="">(Belum ada pelanggan — ketik manual)</option>
                ) : (
                  customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}{c.contact ? ` · ${c.contact}` : ""}</option>
                  ))
                )}
              </select>
            ) : (
              <Input
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="Nama pembeli"
                className="h-8 text-ms-xs"
              />
            )}
          </div>

          {/* Baris item */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label className="text-ms-2xs font-medium">Barang dijual</Label>
              <Button type="button" size="sm" variant="outline" onClick={addLine} className="h-7 px-ms-2 text-ms-2xs">
                <Plus className="mr-1 h-3 w-3" /> Baris
              </Button>
            </div>
            <div className="space-ms-2">
              {lines.map((l, idx) => {
                const it = itemMap.get(l.itemId);
                const g = parseNum(l.gramsStr);
                const overStock = it ? g > Number(it.stock_base) : false;
                return (
                  <div key={l.key} className="space-y-1 rounded-md border bg-muted/20 p-ms-2">
                    <div className="flex items-center gap-ms-1">
                      <select
                        value={l.itemId}
                        onChange={(e) => updateLine(idx, { itemId: e.target.value })}
                        className="min-w-0 flex-1 rounded-md border bg-background px-ms-2 py-1 text-ms-xs"
                      >
                        <option value="">(Pilih produk)</option>
                        {warehouseItems.map((wi) => (
                          <option key={wi.id} value={wi.id}>{wi.name}</option>
                        ))}
                      </select>
                      {lines.length > 1 && (
                        <Button
                          type="button" size="icon" variant="ghost"
                          onClick={() => removeLine(idx)}
                          className="h-7 w-7 text-destructive"
                          aria-label={`Hapus baris ${idx + 1}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-ms-1">
                      <div>
                        <Label className="text-ms-2xs text-muted-foreground">
                          {it ? (it.base_unit === "g" ? "Gram" : "Pcs") : "Qty"}
                        </Label>
                        <NumericTextField
                          value={l.gramsStr}
                          onValueChange={(v) => updateLine(idx, { gramsStr: v })}
                          step={0.01}
                          placeholder="0"
                          className={`flex h-8 w-full rounded-md border border-input bg-background px-3 py-2 text-ms-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${overStock ? "border-destructive" : ""}`}
                        />
                      </div>
                      <div>
                        <Label className="text-ms-2xs text-muted-foreground">
                          Harga/{it ? it.base_unit : "unit"}
                        </Label>
                        <NumericTextField
                          value={l.priceStr}
                          onValueChange={(v) => updateLine(idx, { priceStr: v })}
                          decimal={false}
                          placeholder="0"
                          className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-2 text-ms-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        />
                      </div>
                    </div>
                    {it && (
                      <div className="flex items-center justify-between text-ms-2xs text-muted-foreground">
                        <span>Stok: {fmtItemQty(it.stock_base, it)}</span>
                        <span className="font-semibold text-foreground">Subtotal: {rupiah(subtotals[idx])}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {stockIssues.length > 0 && (
              <div className="mt-1 flex items-start gap-ms-1 rounded-md border border-destructive/40 bg-destructive/10 p-ms-2 text-ms-2xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <div className="space-y-0.5">
                  {stockIssues.map((m, i) => <div key={i}>{m}</div>)}
                </div>
              </div>
            )}
          </div>

          {/* Total */}
          <div className="rounded-md border bg-muted/30 p-ms-2">
            <div className="flex items-center justify-between">
              <span className="text-ms-2xs text-muted-foreground">Total</span>
              <span className="text-ms-sm font-bold text-primary">{rupiah(totalAmount)}</span>
            </div>
          </div>

          {/* Metode bayar */}
          <div>
            <Label className="mb-1 block text-ms-2xs font-medium">Metode Bayar</Label>
            <div className="grid grid-cols-3 gap-ms-1 text-ms-2xs">
              {(["kas", "hutang", "partial"] as PaymentMethod[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPayMethod(m)}
                  className={`rounded-md border px-ms-2 py-1.5 font-semibold ${payMethod === m ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`}
                >
                  {m === "kas" ? "Lunas" : m === "hutang" ? "Hutang" : "Sebagian"}
                </button>
              ))}
            </div>
            {payMethod === "partial" && (
              <div className="mt-2">
                <Label className="text-ms-2xs text-muted-foreground">Jumlah dibayar</Label>
                <NumericTextField
                  value={paidStr}
                  onValueChange={setPaidStr}
                  decimal={false}
                  placeholder="0"
                  className={`flex h-8 w-full rounded-md border border-input bg-background px-3 py-2 text-ms-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${!payment.partialValid ? "border-destructive" : ""}`}
                />
                {!payment.partialValid && paidStr && (
                  <div className="mt-0.5 text-ms-2xs text-destructive">
                    Harus &gt; 0 dan &lt; {formatPaymentRupiah(totalAmount)}
                  </div>
                )}
              </div>
            )}
            {(payment.method === "hutang" || (payment.method === "partial" && payment.partialValid)) && (
              <div className="mt-1 rounded-md border border-warning/30 bg-warning/10 p-ms-2 text-ms-2xs text-warning dark:text-warning">
                Sisa piutang: <b>{formatPaymentRupiah(payment.remaining)}</b>
                {party.name ? <> · atas nama <b>{party.name}</b></> : null}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="mt-2 gap-ms-2">
          <Button variant="outline" onClick={onClose} disabled={busy} size="sm">Batal</Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            size="sm"
            className="bg-primary text-primary-foreground"
          >
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}
            Simpan penjualan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SellSelfPrepDialog;