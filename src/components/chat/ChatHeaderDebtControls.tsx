import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, Wallet, Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { rupiah } from "@/lib/stock-format";

type Kind = "hutang" | "piutang";

type DebtRow = {
  id: string;
  kind: Kind;
  amount: number;
  party_name: string;
  supplier_id: string | null;
  customer_id: string | null;
  created_at: string;
};
type PaymentRow = { id: string; debt_id: string; amount: number };

/**
 * Panel kontrol hutang/piutang ringkas di header chat.
 *
 * - Cari kontak peer di daftar customers/suppliers (via account_user_id atau
 *   nomor telepon) milik pemilik akun (myId).
 * - Jika ditemukan minimal satu debt aktif, tampilkan chip saldo + kontrol
 *   [-] (catat pembayaran) & [+] (tambah tagihan) untuk masing2 kind.
 * - Semua tulisan sinkron langsung ke tabel debts/debt_payments MCM Storage.
 */
export function ChatHeaderDebtControls({
  myId,
  peerUserId,
  peerPhone,
  peerName,
}: {
  myId: string;
  peerUserId: string | null;
  peerPhone: string | null;
  peerName: string;
}) {
  const qc = useQueryClient();
  const queryKey = [
    "chat-debts",
    myId,
    peerUserId ?? "",
    peerPhone ?? "",
  ];

  const debtsQ = useQuery({
    queryKey,
    queryFn: async () => {
      // 1) Cari customer & supplier milik myId yang cocok dengan peer.
      const phoneNorm = (peerPhone ?? "").replace(/\D+/g, "");
      const findParty = async (table: "customers" | "suppliers") => {
        let q = supabase
          .from(table)
          .select("id, name, contact, account_user_id")
          .eq("user_id", myId);
        // Prioritas: account_user_id sama.
        if (peerUserId) q = q.or(`account_user_id.eq.${peerUserId}`);
        const { data } = await q;
        const rows = (data ?? []) as Array<{
          id: string;
          name: string;
          contact: string | null;
          account_user_id: string | null;
        }>;
        const matches = rows.filter((r) => {
          if (peerUserId && r.account_user_id === peerUserId) return true;
          if (phoneNorm) {
            const c = (r.contact ?? "").replace(/\D+/g, "");
            if (c && (c === phoneNorm || c.endsWith(phoneNorm) || phoneNorm.endsWith(c))) {
              return true;
            }
          }
          return false;
        });
        return matches;
      };
      const [customers, suppliers] = await Promise.all([
        findParty("customers"),
        findParty("suppliers"),
      ]);
      const customerIds = customers.map((c) => c.id);
      const supplierIds = suppliers.map((s) => s.id);
      if (customerIds.length === 0 && supplierIds.length === 0) {
        return {
          debts: [] as DebtRow[],
          payments: [] as PaymentRow[],
          customers,
          suppliers,
        };
      }
      // 2) Ambil semua debts terkait milik myId.
      const orParts: string[] = [];
      if (customerIds.length) orParts.push(`customer_id.in.(${customerIds.join(",")})`);
      if (supplierIds.length) orParts.push(`supplier_id.in.(${supplierIds.join(",")})`);
      const { data: debts } = await supabase
        .from("debts")
        .select("id, kind, amount, party_name, supplier_id, customer_id, created_at")
        .eq("user_id", myId)
        .or(orParts.join(","));
      const debtRows = ((debts ?? []) as DebtRow[]).filter(
        (d) => d.kind === "hutang" || d.kind === "piutang",
      );
      let payments: PaymentRow[] = [];
      if (debtRows.length > 0) {
        const { data: pays } = await supabase
          .from("debt_payments")
          .select("id, debt_id, amount")
          .in("debt_id", debtRows.map((d) => d.id));
        payments = (pays ?? []) as PaymentRow[];
      }
      return { debts: debtRows, payments, customers, suppliers };
    },
    enabled: !!myId && (!!peerUserId || !!peerPhone),
    staleTime: 15_000,
  });

  const summary = useMemo(() => {
    const d = debtsQ.data;
    if (!d) return null;
    const paidByDebt = new Map<string, number>();
    for (const p of d.payments) {
      paidByDebt.set(p.debt_id, (paidByDebt.get(p.debt_id) ?? 0) + Number(p.amount));
    }
    let hutang = 0;
    let piutang = 0;
    for (const row of d.debts) {
      const sisa = Math.max(0, Number(row.amount) - (paidByDebt.get(row.id) ?? 0));
      if (row.kind === "hutang") hutang += sisa;
      else piutang += sisa;
    }
    return {
      hutang,
      piutang,
      hasAny: d.debts.length > 0,
      debts: d.debts,
      paidByDebt,
      customerId: d.customers[0]?.id ?? null,
      customerName: d.customers[0]?.name ?? null,
      supplierId: d.suppliers[0]?.id ?? null,
      supplierName: d.suppliers[0]?.name ?? null,
    };
  }, [debtsQ.data]);

  if (!summary || !summary.hasAny) return null;

  const dominantKind: Kind =
    summary.piutang >= summary.hutang ? "piutang" : "hutang";
  const dominantValue =
    dominantKind === "piutang" ? summary.piutang : summary.hutang;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition hover:bg-accent ${
            dominantKind === "piutang"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
              : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
          }`}
          aria-label={
            dominantKind === "piutang"
              ? `Piutang dari ${peerName}: ${rupiah(dominantValue)}`
              : `Hutang kepada ${peerName}: ${rupiah(dominantValue)}`
          }
          title={
            dominantKind === "piutang"
              ? "Piutang (dia berhutang ke Anda)"
              : "Hutang (Anda berhutang ke dia)"
          }
        >
          <Wallet className="h-3 w-3" />
          <span className="truncate">
            {dominantKind === "piutang" ? "Piutang" : "Hutang"} · {rupiah(dominantValue)}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Tagihan dengan {peerName}
        </div>
        <div className="space-y-2">
          <KindRow
            label="Piutang (dia berhutang)"
            balance={summary.piutang}
            kind="piutang"
            onSubmit={(delta) =>
              applyDelta({
                delta,
                kind: "piutang",
                summary,
                myId,
                peerName,
                onDone: () => qc.invalidateQueries({ queryKey }),
              })
            }
          />
          <KindRow
            label="Hutang (Anda berhutang)"
            balance={summary.hutang}
            kind="hutang"
            onSubmit={(delta) =>
              applyDelta({
                delta,
                kind: "hutang",
                summary,
                myId,
                peerName,
                onDone: () => qc.invalidateQueries({ queryKey }),
              })
            }
          />
        </div>
        <p className="mt-3 text-[10px] leading-snug text-muted-foreground">
          <ArrowRight className="mr-1 inline h-2.5 w-2.5" />
          Tersinkron langsung ke Hutang & Piutang MCM Storage.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function KindRow({
  label,
  balance,
  kind,
  onSubmit,
}: {
  label: string;
  balance: number;
  kind: Kind;
  onSubmit: (delta: number) => Promise<void>;
}) {
  const [raw, setRaw] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const parsed = Number(raw.replace(/\D+/g, ""));
  const hasAmount = Number.isFinite(parsed) && parsed > 0;

  const submit = async (sign: 1 | -1) => {
    if (!hasAmount) {
      toast.error("Isi jumlah dulu.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(sign * parsed);
      setRaw("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span
          className={`font-mono font-semibold ${
            kind === "piutang"
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-amber-700 dark:text-amber-300"
          }`}
        >
          {rupiah(balance)}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8 shrink-0"
          disabled={busy || balance <= 0 || !hasAmount}
          onClick={() => submit(-1)}
          aria-label="Kurangi (catat pembayaran)"
          title="Catat pembayaran"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Minus className="h-3.5 w-3.5" />}
        </Button>
        <Input
          value={raw}
          onChange={(e) => setRaw(e.target.value.replace(/[^\d]/g, ""))}
          inputMode="numeric"
          placeholder="0"
          className="h-8 flex-1 text-right font-mono text-xs"
          disabled={busy}
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8 shrink-0"
          disabled={busy || !hasAmount}
          onClick={() => submit(1)}
          aria-label="Tambah tagihan"
          title="Tambah tagihan"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

async function applyDelta({
  delta,
  kind,
  summary,
  myId,
  peerName,
  onDone,
}: {
  delta: number;
  kind: Kind;
  summary: {
    debts: DebtRow[];
    paidByDebt: Map<string, number>;
    customerId: string | null;
    customerName: string | null;
    supplierId: string | null;
    supplierName: string | null;
  };
  myId: string;
  peerName: string;
  onDone: () => void;
}) {
  try {
    if (delta > 0) {
      // Tambah tagihan → insert baris debts baru.
      const partyId =
        kind === "hutang" ? summary.supplierId : summary.customerId;
      const partyName =
        (kind === "hutang" ? summary.supplierName : summary.customerName) ??
        peerName;
      if (!partyId) {
        toast.error(
          kind === "hutang"
            ? "Peer belum terdaftar sebagai supplier."
            : "Peer belum terdaftar sebagai pelanggan.",
        );
        return;
      }
      const insert: {
        user_id: string;
        kind: Kind;
        party_name: string;
        amount: number;
        source: string;
        supplier_id?: string;
        customer_id?: string;
      } = {
        user_id: myId,
        kind,
        party_name: partyName,
        amount: delta,
        // Sumber "manual" — satu-satunya nilai valid untuk entri dari UI chat
        // menurut constraint `debts_source_check`. Jangan ubah tanpa
        // memperluas allowlist di `src/lib/debt-source.ts` DAN migrasi
        // constraint database.
        source: assertDebtSource("manual"),
      };
      if (kind === "hutang") insert.supplier_id = partyId;
      else insert.customer_id = partyId;
      const { error } = await supabase.from("debts").insert(insert);
      if (error) throw error;
      toast.success(
        `${kind === "hutang" ? "Hutang" : "Piutang"} baru ${rupiah(delta)} dicatat.`,
      );
    } else {
      // Catat pembayaran → alokasi terhadap debts terlama yang masih bersaldo.
      const remaining = Math.abs(delta);
      const openDebts = summary.debts
        .filter((d) => d.kind === kind)
        .map((d) => ({
          id: d.id,
          sisa: Math.max(0, Number(d.amount) - (summary.paidByDebt.get(d.id) ?? 0)),
        }))
        .filter((d) => d.sisa > 0)
        .sort((a, b) => a.sisa - b.sisa === 0 ? 0 : 0); // urutan apa adanya (created_at desc dari query)
      let left = remaining;
      const rows: Array<{
        user_id: string;
        debt_id: string;
        amount: number;
        paid_at: string;
        note: string;
      }> = [];
      const today = new Date().toISOString().slice(0, 10);
      for (const d of openDebts) {
        if (left <= 0) break;
        const take = Math.min(left, d.sisa);
        rows.push({
          user_id: myId,
          debt_id: d.id,
          amount: take,
          paid_at: today,
          note: "Dicatat dari chat",
        });
        left -= take;
      }
      if (rows.length === 0) {
        toast.error("Tidak ada saldo untuk dibayar.");
        return;
      }
      const { error } = await supabase.from("debt_payments").insert(rows);
      if (error) throw error;
      const applied = remaining - left;
      toast.success(
        `Pembayaran ${rupiah(applied)} dicatat${left > 0 ? ` (sisa input ${rupiah(left)} tidak dipakai).` : "."}`,
      );
    }
    onDone();
  } catch (e) {
    toast.error(
      (e as { message?: string })?.message ?? "Gagal menyimpan perubahan.",
    );
  }
}