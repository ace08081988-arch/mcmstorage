import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Wallet, CheckCircle2, HandCoins, Banknote } from "lucide-react";
import { toast } from "sonner";
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
 * Tombol cepat Hutang / Bayar Sekian / Lunas untuk dipasang di pratinjau
 * kirim WA & Chat. Otomatis mencocokkan lawan (pelanggan / supplier)
 * berdasarkan nomor telepon atau `account_user_id`, lalu menyinkronkan
 * ke tabel debts & debt_payments MCM Storage.
 *
 * Bila peer belum terdaftar sebagai customer/supplier, komponen hanya
 * menampilkan hint singkat — tidak menghalangi alur kirim.
 */
export function DebtQuickActions({
  peerPhone,
  peerName,
  peerAccountUserId,
  conversationId,
}: {
  peerPhone?: string | null;
  peerName?: string | null;
  peerAccountUserId?: string | null;
  conversationId?: string | null;
}) {
  const qc = useQueryClient();
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (alive) setUid(data.user?.id ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);

  const phoneDigits = (peerPhone ?? "").replace(/\D+/g, "");
  const queryKey = [
    "debt-quick-actions",
    uid ?? "",
    peerAccountUserId ?? "",
    phoneDigits,
    conversationId ?? "",
  ];

  const q = useQuery({
    queryKey,
    enabled: !!uid && (!!phoneDigits || !!peerAccountUserId || !!conversationId),
    staleTime: 15_000,
    queryFn: async () => {
      if (!uid) throw new Error("no-uid");
      // Resolusi user_id lawan lewat conversation_members jika tersedia.
      let accountUserId = peerAccountUserId ?? null;
      if (!accountUserId && conversationId) {
        const { data: members } = await supabase
          .from("conversation_members")
          .select("user_id")
          .eq("conversation_id", conversationId);
        const peer = (members ?? []).map((m) => m.user_id).find((id) => id && id !== uid);
        if (peer) accountUserId = peer as string;
      }

      const findParty = async (table: "customers" | "suppliers") => {
        const { data } = await supabase
          .from(table)
          .select("id, name, contact, account_user_id")
          .eq("user_id", uid);
        const rows = (data ?? []) as Array<{
          id: string;
          name: string;
          contact: string | null;
          account_user_id: string | null;
        }>;
        return rows.filter((r) => {
          if (accountUserId && r.account_user_id === accountUserId) return true;
          if (phoneDigits) {
            const c = (r.contact ?? "").replace(/\D+/g, "");
            if (c && (c === phoneDigits || c.endsWith(phoneDigits) || phoneDigits.endsWith(c))) {
              return true;
            }
          }
          return false;
        });
      };

      const [customers, suppliers] = await Promise.all([
        findParty("customers"),
        findParty("suppliers"),
      ]);

      // Prioritas: customer (piutang) — konteks pratinjau ini biasanya
      // "kirim ke pelanggan". Bila hanya supplier yang cocok, pakai hutang.
      const kind: Kind = customers.length > 0 ? "piutang" : suppliers.length > 0 ? "hutang" : "piutang";
      const party =
        kind === "piutang"
          ? customers[0] ?? null
          : suppliers[0] ?? null;

      if (!party) {
        return { kind, party: null, debts: [] as DebtRow[], payments: [] as PaymentRow[], accountUserId };
      }

      const filter =
        kind === "piutang"
          ? { customer_id: party.id }
          : { supplier_id: party.id };
      const { data: debts } = await supabase
        .from("debts")
        .select("id, kind, amount, party_name, supplier_id, customer_id, created_at")
        .eq("user_id", uid)
        .eq("kind", kind)
        .match(filter)
        .order("created_at", { ascending: false });
      const debtRows = (debts ?? []) as DebtRow[];
      let payments: PaymentRow[] = [];
      if (debtRows.length > 0) {
        const { data: pays } = await supabase
          .from("debt_payments")
          .select("id, debt_id, amount")
          .in(
            "debt_id",
            debtRows.map((d) => d.id),
          );
        payments = (pays ?? []) as PaymentRow[];
      }
      return { kind, party, debts: debtRows, payments, accountUserId };
    },
  });

  const summary = useMemo(() => {
    const d = q.data;
    if (!d) return null;
    const paidByDebt = new Map<string, number>();
    for (const p of d.payments) {
      paidByDebt.set(p.debt_id, (paidByDebt.get(p.debt_id) ?? 0) + Number(p.amount));
    }
    let saldo = 0;
    const openDebts: Array<{ id: string; sisa: number; created_at: string }> = [];
    for (const row of d.debts) {
      const sisa = Math.max(0, Number(row.amount) - (paidByDebt.get(row.id) ?? 0));
      saldo += sisa;
      if (sisa > 0) openDebts.push({ id: row.id, sisa, created_at: row.created_at });
    }
    // Bayar dari yang paling lama dulu.
    openDebts.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    return { saldo, openDebts };
  }, [q.data]);

  const [amountRaw, setAmountRaw] = useState("");
  const [busy, setBusy] = useState<null | "add" | "pay" | "lunas" | "cash">(null);
  const parsed = Number(amountRaw.replace(/\D+/g, ""));
  const hasAmount = Number.isFinite(parsed) && parsed > 0;

  if (!uid) return null;
  if (q.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2 text-[11px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memeriksa tagihan…
      </div>
    );
  }
  const data = q.data;
  if (!data) return null;

  if (!data.party) {
    return (
      <div className="rounded-md border border-dashed bg-muted/20 p-2 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Wallet className="h-3.5 w-3.5" />
          <span className="font-semibold text-foreground">Hutang / Piutang</span>
        </div>
        <p className="mt-1 leading-snug">
          {peerName ? <b>{peerName}</b> : "Lawan"} belum terdaftar sebagai pelanggan atau supplier.
          Tambahkan di menu Kontak / Pelanggan agar tombol pencatatan aktif.
        </p>
      </div>
    );
  }

  const kind = data.kind;
  const kindLabel = kind === "piutang" ? "Piutang" : "Hutang";
  const partyLabel = data.party.name ?? peerName ?? "Lawan";
  const saldo = summary?.saldo ?? 0;
  const openDebts = summary?.openDebts ?? [];

  async function addDebt(opts?: { markPaid?: boolean; label?: "add" | "cash" }) {
    if (!uid || !data?.party || !hasAmount) {
      if (!hasAmount) toast.error("Isi jumlah dulu.");
      return;
    }
    const busyKey = opts?.label ?? "add";
    setBusy(busyKey);
    try {
      const insert: Record<string, unknown> = {
        user_id: uid,
        kind,
        party_name: partyLabel,
        amount: parsed,
        source: "manual",
        note:
          opts?.markPaid
            ? kind === "piutang"
              ? "Jual tunai via pratinjau kirim"
              : "Beli tunai via pratinjau kirim"
            : kind === "piutang"
              ? "Harga jual via pratinjau kirim"
              : "Harga beli via pratinjau kirim",
      };
      if (kind === "piutang") insert.customer_id = data.party.id;
      else insert.supplier_id = data.party.id;
      const { data: inserted, error } = await supabase
        .from("debts")
        .insert(insert as never)
        .select("id")
        .single();
      if (error) throw error;
      // Bila "Tunai", langsung catat pembayaran penuh sehingga tagihan
      // baru saldo = 0 dan tetap tersimpan sebagai jejak transaksi tunai.
      if (opts?.markPaid && inserted && (inserted as { id?: string }).id) {
        const today = new Date().toISOString().slice(0, 10);
        const { error: payErr } = await supabase.from("debt_payments").insert({
          user_id: uid,
          debt_id: (inserted as { id: string }).id,
          amount: parsed,
          paid_at: today,
          note:
            kind === "piutang"
              ? "Jual tunai — otomatis lunas"
              : "Beli tunai — otomatis lunas",
        });
        if (payErr) throw payErr;
        toast.success(
          `${kind === "piutang" ? "Jual tunai" : "Beli tunai"} ${rupiah(parsed)} tercatat (lunas).`,
        );
      } else {
        toast.success(
          `${kind === "piutang" ? "Harga jual" : "Harga beli"} ${rupiah(parsed)} tercatat sebagai ${kindLabel.toLowerCase()}.`,
        );
      }
      setAmountRaw("");
      await qc.invalidateQueries({ queryKey });
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Gagal mencatat.");
    } finally {
      setBusy(null);
    }
  }

  async function allocatePayment(amount: number, label: "pay" | "lunas") {
    if (!uid || amount <= 0) return;
    setBusy(label);
    try {
      let left = amount;
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
          user_id: uid,
          debt_id: d.id,
          amount: take,
          paid_at: today,
          note: label === "lunas" ? "Lunas via pratinjau kirim" : "Bayar sekian via pratinjau kirim",
        });
        left -= take;
      }
      if (rows.length === 0) {
        toast.error("Tidak ada saldo untuk dibayar.");
        return;
      }
      const { error } = await supabase.from("debt_payments").insert(rows);
      if (error) throw error;
      const applied = amount - left;
      toast.success(
        label === "lunas"
          ? `${kindLabel} ${partyLabel} dilunasi (${rupiah(applied)}).`
          : `Pembayaran ${rupiah(applied)} tercatat${left > 0 ? ` (sisa input ${rupiah(left)} tidak dipakai)` : ""}.`,
      );
      setAmountRaw("");
      await qc.invalidateQueries({ queryKey });
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Gagal mencatat pembayaran.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className={
        "rounded-md border p-2.5 " +
        (kind === "piutang"
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-amber-500/40 bg-amber-500/5")
      }
    >
      <div className="flex items-center gap-1.5 text-[11px]">
        <Wallet
          className={
            "h-3.5 w-3.5 " +
            (kind === "piutang" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300")
          }
        />
        <span className="font-semibold text-foreground">
          {kindLabel} · {partyLabel}
        </span>
        <span
          className={
            "ml-auto font-mono font-semibold " +
            (kind === "piutang" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300")
          }
        >
          {rupiah(saldo)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <input
          value={amountRaw}
          onChange={(e) => setAmountRaw(e.target.value.replace(/[^\d]/g, ""))}
          inputMode="numeric"
          placeholder={kind === "piutang" ? "Harga jual (Rp)" : "Harga beli (Rp)"}
          className="h-8 min-w-0 flex-1 basis-full rounded-md border bg-background px-2 text-right font-mono text-xs sm:basis-auto"
          disabled={busy !== null}
        />
        <button
          type="button"
          onClick={() => void addDebt({ label: "add" })}
          disabled={busy !== null || !hasAmount}
          className={
            "inline-flex h-8 items-center gap-1 rounded-md border px-2 text-[11px] font-semibold disabled:opacity-50 " +
            (kind === "piutang"
              ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-800 hover:bg-emerald-500/20 dark:text-emerald-200"
              : "border-amber-500/60 bg-amber-500/10 text-amber-800 hover:bg-amber-500/20 dark:text-amber-200")
          }
          title={
            kind === "piutang"
              ? "Catat harga jual sebagai piutang baru (pelanggan belum bayar)"
              : "Catat harga beli sebagai hutang baru (belum dibayar)"
          }
        >
          {busy === "add" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          {kind === "piutang" ? "Harga Jual" : "Harga Beli"}
        </button>
        <button
          type="button"
          onClick={() => void addDebt({ markPaid: true, label: "cash" })}
          disabled={busy !== null || !hasAmount}
          className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-2 text-[11px] font-semibold hover:bg-accent disabled:opacity-50"
          title={
            kind === "piutang"
              ? "Catat jual tunai — langsung lunas, tidak menambah piutang"
              : "Catat beli tunai — langsung lunas, tidak menambah hutang"
          }
        >
          {busy === "cash" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Banknote className="h-3 w-3" />}
          Tunai
        </button>
        <button
          type="button"
          onClick={() => void allocatePayment(parsed, "pay")}
          disabled={busy !== null || !hasAmount || saldo <= 0}
          className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-2 text-[11px] font-semibold hover:bg-accent disabled:opacity-50"
          title="Catat pembayaran sebagian sesuai jumlah di kiri"
        >
          {busy === "pay" ? <Loader2 className="h-3 w-3 animate-spin" /> : <HandCoins className="h-3 w-3" />}
          Bayar
        </button>
        <button
          type="button"
          onClick={() => void allocatePayment(saldo, "lunas")}
          disabled={busy !== null || saldo <= 0}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-emerald-500/60 bg-emerald-500 px-2 text-[11px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
          title={`Lunasi semua ${kindLabel.toLowerCase()} (${rupiah(saldo)})`}
        >
          {busy === "lunas" ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
          Lunas
        </button>
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
        Tersinkron ke Hutang & Piutang MCM Storage. <b>Harga Jual</b> = tambah piutang, <b>Tunai</b> = jual langsung lunas, <b>Bayar/Lunas</b> = pelunasan piutang yang ada (dialokasi ke tagihan paling lama).
      </p>
    </div>
  );
}