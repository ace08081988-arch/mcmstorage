/**
 * Kartu kontak yang saldonya berasal dari TRANSAKSI (penjualan hutang /
 * pembelian hutang) tetapi belum punya catatan manual di tabel `debts`.
 *
 * Tanpa ini, halaman Hutang & Piutang hanya menampilkan entri manual,
 * sehingga nama seperti "GIMEN" (piutang dari penjualan hutang) muncul di
 * total SSOT tapi tidak punya kartu — terlihat tidak sinkron.
 *
 * Tidak pernah membuat baris `debts` palsu. Pembayaran dicatat ke kanal
 * aslinya: `customer_payments` (piutang) / `supplier_payments` (hutang).
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Coins, Link2Off } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { notifyError } from "@/lib/friendly-error";
import { emitDebtTx } from "@/lib/debt-tx-event";
import { normalizeParty, type DebtSyncMap } from "@/lib/chat-debt-sync";
import { NumericTextField } from "@/components/NumericDraftInput";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";

type Party = { id: string; name: string; contact?: string | null };

const rupiah = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export type TxOnlyParty = { name: string; amount: number; partyId: string | null };

/** Kontak SSOT dengan sisa > 0 yang belum punya kartu manual di layar. */
export function selectTxOnlyParties(
  kind: "hutang" | "piutang",
  ssot: DebtSyncMap | undefined,
  manualNames: string[],
  parties: Party[],
): TxOnlyParty[] {
  if (!ssot) return [];
  const shown = new Set(manualNames.map(normalizeParty));
  const out: TxOnlyParty[] = [];
  for (const entry of ssot.values()) {
    const key = normalizeParty(entry.name);
    if (!key || shown.has(key)) continue;
    const amount = kind === "hutang" ? entry.hutang : entry.piutang;
    if (amount <= 0) continue;
    const match = parties.find((p) => normalizeParty(p.name) === key);
    out.push({ name: entry.name, amount, partyId: match?.id ?? null });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

export function TxOnlyPartyCards({
  kind,
  ssot,
  manualNames,
  parties,
  uid,
  onChanged,
}: {
  kind: "hutang" | "piutang";
  ssot: DebtSyncMap | undefined;
  manualNames: string[];
  parties: Party[];
  uid: string | null;
  onChanged: () => void;
}) {
  const rows = useMemo(
    () => selectTxOnlyParties(kind, ssot, manualNames, parties),
    [kind, ssot, manualNames, parties],
  );
  if (rows.length === 0) return null;

  return (
    <section className="space-ms-2">
      <div className="flex items-center gap-ms-2 text-ms-2xs text-muted-foreground">
        <Coins className="h-3.5 w-3.5" aria-hidden />
        <span>
          Dari transaksi {kind === "hutang" ? "pembelian" : "penjualan"} — belum ada catatan
          manual, tapi ikut dihitung di total.
        </span>
      </div>
      {rows.map((r) => (
        <TxPartyCard key={`${kind}:${r.name}`} kind={kind} row={r} uid={uid} onChanged={onChanged} />
      ))}
    </section>
  );
}

function TxPartyCard({
  kind,
  row,
  uid,
  onChanged,
}: {
  kind: "hutang" | "piutang";
  row: TxOnlyParty;
  uid: string | null;
  onChanged: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const pay = async () => {
    const n = Number(amount) || 0;
    if (!uid || n <= 0) {
      toast.error("Isi nominal pembayaran lebih dari 0");
      return;
    }
    if (!row.partyId) {
      toast.error("Kontak ini belum tertaut ke data pelanggan/supplier");
      return;
    }
    setBusy(true);
    const payload =
      kind === "piutang"
        ? { user_id: uid, customer_id: row.partyId, amount: n, note: "Pembayaran dari Hutang & Piutang" }
        : { user_id: uid, supplier_id: row.partyId, amount: n, note: "Pembayaran dari Hutang & Piutang" };
    const { error } = await supabase
      .from(kind === "piutang" ? "customer_payments" : "supplier_payments")
      .insert(payload as never);
    setBusy(false);
    if (error) {
      notifyError(error);
      return;
    }
    setAmount("");
    toast.success("Pembayaran dicatat");
    emitDebtTx();
    onChanged();
  };

  return (
    <div className="rounded-2xl border bg-card p-ms-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-ms-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-ms-sm font-semibold">{row.name}</div>
          <div className="text-ms-2xs text-muted-foreground">
            Sisa{" "}
            <span className="font-semibold tabular-nums text-warning">{rupiah(row.amount)}</span>
          </div>
        </div>
        <StatusBadge size="xs" variant="info">
          {kind === "hutang" ? "Pembelian" : "Penjualan"}
        </StatusBadge>
      </div>

      {row.partyId ? (
        <div className="mt-2 flex items-center gap-ms-2">
          <NumericTextField
            value={amount}
            onValueChange={setAmount}
            step={1}
            decimal={false}
            placeholder="Nominal bayar"
            className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm"
          />
          <Button size="sm" className="h-8 shrink-0 rounded-lg" disabled={busy} onClick={() => void pay()}>
            {busy ? "Menyimpan…" : "Catat bayar"}
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-ms-1 text-ms-2xs text-muted-foreground">
          <Link2Off className="h-3 w-3" aria-hidden />
          Belum tertaut ke data {kind === "hutang" ? "supplier" : "pelanggan"}.
        </div>
      )}
    </div>
  );
}