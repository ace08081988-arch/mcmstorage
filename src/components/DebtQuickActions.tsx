import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Wallet, CheckCircle2, HandCoins, Banknote, Undo2, Pencil, ScrollText, ChevronDown, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { rupiah } from "@/lib/stock-format";
import { emitDebtTx } from "@/lib/debt-tx-event";
import {
  appendDebtAction,
  useDebtActionLog,
  clearDebtActionLog,
  actionLabel,
  type DebtActionKind,
  type DebtActionStatus,
} from "@/lib/debt-action-log";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  type LastTx =
    | {
        label: "add" | "cash";
        debtId: string;
        paymentId: string | null;
        amount: number;
        kind: Kind;
        wasCash: boolean;
      }
    | {
        label: "pay" | "lunas";
        paymentIds: string[];
        amount: number;
        kind: Kind;
      };
  const [lastTx, setLastTx] = useState<LastTx | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editAmountRaw, setEditAmountRaw] = useState("");
  const [undoOpen, setUndoOpen] = useState(false);
  const [reverting, setReverting] = useState(false);
  type PendingAction =
    | { kind: "add" }
    | { kind: "cash" }
    | { kind: "pay"; amount: number }
    | { kind: "lunas"; amount: number };
  const [pending, setPending] = useState<PendingAction | null>(null);
  const pendingConfirmedRef = useRef(false);
  const undoConfirmedRef = useRef(false);
  const editConfirmedRef = useRef(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const log = useDebtActionLog();
  const parsed = Number(amountRaw.replace(/\D+/g, ""));
  const hasAmount = Number.isFinite(parsed) && parsed > 0;

  function logAction(kind: DebtActionKind, status: DebtActionStatus, amount: number, extra?: { prevAmount?: number; note?: string }) {
    appendDebtAction({
      kind,
      status,
      amount,
      prevAmount: extra?.prevAmount,
      note: extra?.note,
      balanceKind: (data?.kind ?? "piutang") as "piutang" | "hutang",
      party: data?.party?.name ?? peerName ?? "Lawan",
    });
  }

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

  const confirmCopy: Record<
    PendingAction["kind"],
    { title: string; desc: string; cta: string; ctaClass?: string }
  > = {
    add: {
      title: kind === "piutang" ? `Catat harga jual ${rupiah(parsed)}?` : `Catat harga beli ${rupiah(parsed)}?`,
      desc:
        kind === "piutang"
          ? `Menambah piutang baru atas nama ${partyLabel} sebesar ${rupiah(parsed)} (belum dibayar).`
          : `Menambah hutang baru ke ${partyLabel} sebesar ${rupiah(parsed)} (belum dibayar).`,
      cta: kind === "piutang" ? "Ya, catat harga jual" : "Ya, catat harga beli",
    },
    cash: {
      title: kind === "piutang" ? `Catat jual tunai ${rupiah(parsed)}?` : `Catat beli tunai ${rupiah(parsed)}?`,
      desc:
        kind === "piutang"
          ? `${partyLabel} bayar ${rupiah(parsed)} tunai — tercatat lunas, tidak menambah piutang.`
          : `Bayar ${rupiah(parsed)} tunai ke ${partyLabel} — tercatat lunas, tidak menambah hutang.`,
      cta: "Ya, catat tunai",
    },
    pay: {
      title: `Catat pembayaran ${rupiah(parsed)}?`,
      desc:
        `Mengurangi ${kindLabel.toLowerCase()} ${partyLabel} sebesar ${rupiah(parsed)}. Saldo saat ini ${rupiah(saldo)} — dialokasi ke tagihan paling lama dulu.`,
      cta: "Ya, bayar sekian",
    },
    lunas: {
      title: `Lunasi seluruh ${kindLabel.toLowerCase()} ${partyLabel}?`,
      desc: `Melunasi seluruh saldo ${rupiah(saldo)} atas nama ${partyLabel}. Tindakan ini tidak bisa diurungkan otomatis.`,
      cta: `Ya, lunasi ${rupiah(saldo)}`,
      ctaClass: "bg-emerald-600 hover:bg-emerald-700 text-white",
    },
  };

  async function runPending(p: PendingAction) {
    let result: { ok: boolean; error?: string; applied?: number };
    if (p.kind === "add") result = await addDebt({ label: "add" });
    else if (p.kind === "cash") result = await addDebt({ markPaid: true, label: "cash" });
    else if (p.kind === "pay") result = await allocatePayment(p.amount, "pay");
    else result = await allocatePayment(p.amount, "lunas");
    logAction(
      p.kind,
      result.ok ? "confirmed" : "failed",
      p.kind === "pay" || p.kind === "lunas" ? (result.applied ?? p.amount) : parsed,
      { note: result.error },
    );
  }

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "2-digit" });
    } catch {
      return iso.slice(0, 10);
    }
  }

  function allocationPreview(amount: number): {
    lines: Array<{ id: string; created_at: string; take: number; sisaBefore: number; sisaAfter: number }>;
    applied: number;
    leftover: number;
  } {
    let left = amount;
    const lines: Array<{ id: string; created_at: string; take: number; sisaBefore: number; sisaAfter: number }> = [];
    for (const d of openDebts) {
      if (left <= 0) break;
      const take = Math.min(left, d.sisa);
      lines.push({ id: d.id, created_at: d.created_at, take, sisaBefore: d.sisa, sisaAfter: d.sisa - take });
      left -= take;
    }
    return { lines, applied: amount - left, leftover: left };
  }

  type EditPreview =
    | { valid: false; reason: string }
    | {
        valid: true;
        kind: "amount";
        prevAmount: number;
        nextAmount: number;
        paidAfter: number;
        sisaBefore: number;
        sisaAfter: number;
        deltaSaldo: number;
        newSaldo: number;
      }
    | {
        valid: true;
        kind: "reallocate";
        lines: Array<{ id: string; created_at: string; take: number; sisaBefore: number; sisaAfter: number }>;
        applied: number;
        leftover: number;
        prevApplied: number;
        deltaSaldo: number;
        newSaldo: number;
      };

  function computeEditPreview(): EditPreview | null {
    if (!lastTx) return null;
    const raw = editAmountRaw.replace(/\D+/g, "");
    const next = Number(raw);
    if (!raw || !Number.isFinite(next) || next <= 0) {
      return { valid: false, reason: "Masukkan nominal baru (Rp)." };
    }
    if (next === lastTx.amount) {
      return { valid: false, reason: "Nominal sama dengan sebelumnya." };
    }
    if ("paymentIds" in lastTx) {
      const paidByDebt = new Map<string, number>();
      for (const p of data?.payments ?? []) {
        if (lastTx.paymentIds.includes(p.id)) continue;
        paidByDebt.set(p.debt_id, (paidByDebt.get(p.debt_id) ?? 0) + Number(p.amount));
      }
      const openNow: Array<{ id: string; sisa: number; created_at: string }> = [];
      for (const row of data?.debts ?? []) {
        const sisa = Math.max(0, Number(row.amount) - (paidByDebt.get(row.id) ?? 0));
        if (sisa > 0) openNow.push({ id: row.id, sisa, created_at: row.created_at });
      }
      openNow.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      const totalOpenBefore = openNow.reduce((s, d) => s + d.sisa, 0);
      let left = next;
      const linesArr: Array<{ id: string; created_at: string; take: number; sisaBefore: number; sisaAfter: number }> = [];
      for (const d of openNow) {
        if (left <= 0) break;
        const take = Math.min(left, d.sisa);
        linesArr.push({ id: d.id, created_at: d.created_at, take, sisaBefore: d.sisa, sisaAfter: d.sisa - take });
        left -= take;
      }
      const applied = next - left;
      const newSaldo = totalOpenBefore - applied;
      const deltaSaldo = newSaldo - saldo;
      return {
        valid: true,
        kind: "reallocate",
        lines: linesArr,
        applied,
        leftover: left,
        prevApplied: lastTx.amount,
        newSaldo,
        deltaSaldo,
      };
    }
    // add / cash
    const debtRow = (data?.debts ?? []).find((d) => d.id === lastTx.debtId);
    const currentAmount = Number(debtRow?.amount ?? lastTx.amount);
    const otherPaymentsSum = (data?.payments ?? [])
      .filter((p) => p.debt_id === lastTx.debtId && (lastTx.wasCash ? p.id !== lastTx.paymentId : true))
      .reduce((s, p) => s + Number(p.amount), 0);
    const paidAfter = lastTx.wasCash ? next + otherPaymentsSum : otherPaymentsSum;
    if (next < otherPaymentsSum) {
      return {
        valid: false,
        reason: `Tidak boleh di bawah pembayaran lain yang sudah tercatat (${rupiah(otherPaymentsSum)}) untuk tagihan ini.`,
      };
    }
    const sisaBefore = Math.max(0, currentAmount - (lastTx.wasCash ? currentAmount : 0) - otherPaymentsSum);
    // wasCash: sisaBefore = 0 (lunas). non-cash: sisaBefore = currentAmount - otherPayments.
    const sisaAfter = Math.max(0, next - paidAfter);
    const deltaSaldo = sisaAfter - sisaBefore;
    const newSaldo = saldo + deltaSaldo;
    return {
      valid: true,
      kind: "amount",
      prevAmount: lastTx.amount,
      nextAmount: next,
      paidAfter,
      sisaBefore,
      sisaAfter,
      deltaSaldo,
      newSaldo,
    };
  }

  async function addDebt(opts?: { markPaid?: boolean; label?: "add" | "cash" }): Promise<{ ok: boolean; error?: string }> {
    if (!uid || !data?.party || !hasAmount) {
      if (!hasAmount) toast.error("Isi jumlah dulu.");
      return { ok: false, error: !hasAmount ? "Jumlah kosong" : "Data tidak lengkap" };
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
      const newDebtId = (inserted as { id?: string } | null)?.id ?? null;
      let newPaymentId: string | null = null;
      // Bila "Tunai", langsung catat pembayaran penuh sehingga tagihan
      // baru saldo = 0 dan tetap tersimpan sebagai jejak transaksi tunai.
      if (opts?.markPaid && newDebtId) {
        const today = new Date().toISOString().slice(0, 10);
        const { data: payIns, error: payErr } = await supabase.from("debt_payments").insert({
          user_id: uid,
          debt_id: newDebtId,
          amount: parsed,
          paid_at: today,
          note:
            kind === "piutang"
              ? "Jual tunai — otomatis lunas"
              : "Beli tunai — otomatis lunas",
        }).select("id").single();
        if (payErr) throw payErr;
        newPaymentId = (payIns as { id?: string } | null)?.id ?? null;
        toast.success(
          `${kind === "piutang" ? "Jual tunai" : "Beli tunai"} ${rupiah(parsed)} tercatat (lunas).`,
        );
      } else {
        toast.success(
          `${kind === "piutang" ? "Harga jual" : "Harga beli"} ${rupiah(parsed)} tercatat sebagai ${kindLabel.toLowerCase()}.`,
        );
      }
      if (newDebtId) {
        setLastTx({
          debtId: newDebtId,
          paymentId: newPaymentId,
          amount: parsed,
          kind,
          wasCash: !!opts?.markPaid,
          label: busyKey,
        });
      }
      setAmountRaw("");
      await qc.invalidateQueries({ queryKey });
      emitDebtTx({
        kind,
        wasCash: !!opts?.markPaid,
        amount: parsed,
        partyId: data.party.id,
        at: Date.now(),
      });
      return { ok: true };
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? "Gagal mencatat.";
      toast.error(msg);
      return { ok: false, error: msg };
    } finally {
      setBusy(null);
    }
  }

  async function revertLastTx() {
    if (!lastTx || !uid) return;
    const tx = lastTx;
    setReverting(true);
    try {
      if ("paymentIds" in tx) {
        if (tx.paymentIds.length > 0) {
          const { error: pe } = await supabase
            .from("debt_payments")
            .delete()
            .in("id", tx.paymentIds);
          if (pe) throw pe;
        }
        toast.success(
          `Pembayaran ${rupiah(tx.amount)} dibatalkan. Saldo dikembalikan.`,
        );
      } else {
        if (tx.paymentId) {
          const { error: pe } = await supabase
            .from("debt_payments")
            .delete()
            .eq("id", tx.paymentId);
          if (pe) throw pe;
        }
        // Hapus juga pembayaran lain yang mungkin tersangkut agar saldo bersih.
        await supabase.from("debt_payments").delete().eq("debt_id", tx.debtId);
        const { error } = await supabase.from("debts").delete().eq("id", tx.debtId);
        if (error) throw error;
        toast.success(
          `${tx.wasCash ? "Transaksi tunai" : tx.kind === "piutang" ? "Piutang" : "Hutang"} ${rupiah(tx.amount)} dibatalkan. Saldo dibalik.`,
        );
      }
      setLastTx(null);
      setUndoOpen(false);
      await qc.invalidateQueries({ queryKey });
      emitDebtTx({
        kind: tx.kind,
        wasCash: tx.label === "cash",
        amount: -tx.amount,
        partyId: data?.party?.id ?? null,
        at: Date.now(),
      });
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Gagal membatalkan transaksi.");
    } finally {
      setReverting(false);
    }
  }

  async function saveEditLastTx() {
    if (!lastTx || !uid) return;
    const tx = lastTx;
    const next = Number(editAmountRaw.replace(/\D+/g, ""));
    if (!Number.isFinite(next) || next <= 0) {
      toast.error("Jumlah baru tidak valid.");
      return;
    }
    if (next === tx.amount) {
      setEditOpen(false);
      return;
    }
    // Validasi guard: cegah saldo negatif / tidak konsisten.
    if (!("paymentIds" in tx)) {
      const otherPaymentsSum = (data?.payments ?? [])
        .filter((p) => p.debt_id === tx.debtId && (tx.wasCash ? p.id !== tx.paymentId : true))
        .reduce((s, p) => s + Number(p.amount), 0);
      if (next < otherPaymentsSum) {
        toast.error(`Nominal baru < pembayaran tercatat (${rupiah(otherPaymentsSum)}).`);
        return;
      }
    }
    setReverting(true);
    try {
      if ("paymentIds" in tx) {
        // Balik dulu payment lama, lalu alokasi ulang dengan nominal baru.
        if (tx.paymentIds.length > 0) {
          const { error: pe } = await supabase
            .from("debt_payments")
            .delete()
            .in("id", tx.paymentIds);
          if (pe) throw pe;
        }
        await qc.invalidateQueries({ queryKey });
        const refreshed = await qc.fetchQuery({ queryKey });
        const paidByDebt = new Map<string, number>();
        const rq = refreshed as { debts: DebtRow[]; payments: PaymentRow[] } | undefined;
        for (const p of rq?.payments ?? []) {
          paidByDebt.set(p.debt_id, (paidByDebt.get(p.debt_id) ?? 0) + Number(p.amount));
        }
        const openNow: Array<{ id: string; sisa: number; created_at: string }> = [];
        for (const row of rq?.debts ?? []) {
          const sisa = Math.max(0, Number(row.amount) - (paidByDebt.get(row.id) ?? 0));
          if (sisa > 0) openNow.push({ id: row.id, sisa, created_at: row.created_at });
        }
        openNow.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
        const today = new Date().toISOString().slice(0, 10);
        const rows: Array<{ user_id: string; debt_id: string; amount: number; paid_at: string; note: string }> = [];
        let left = next;
        for (const d of openNow) {
          if (left <= 0) break;
          const take = Math.min(left, d.sisa);
          rows.push({
            user_id: uid,
            debt_id: d.id,
            amount: take,
            paid_at: today,
            note: tx.label === "lunas" ? "Lunas via pratinjau kirim (edit)" : "Bayar sekian via pratinjau kirim (edit)",
          });
          left -= take;
        }
        let newIds: string[] = [];
        if (rows.length > 0) {
          const { data: ins, error: ie } = await supabase.from("debt_payments").insert(rows).select("id");
          if (ie) throw ie;
          newIds = ((ins ?? []) as Array<{ id: string }>).map((r) => r.id);
        }
        const applied = next - left;
        toast.success(`Pembayaran diubah ke ${rupiah(applied)}. Saldo disesuaikan.`);
        setLastTx({ ...tx, amount: applied, paymentIds: newIds });
      } else {
        const { error } = await supabase
          .from("debts")
          .update({ amount: next })
          .eq("id", tx.debtId);
        if (error) throw error;
        if (tx.wasCash && tx.paymentId) {
          const { error: pe } = await supabase
            .from("debt_payments")
            .update({ amount: next })
            .eq("id", tx.paymentId);
          if (pe) throw pe;
        }
        toast.success(`Nominal diubah ke ${rupiah(next)}. Saldo disesuaikan.`);
        setLastTx({ ...tx, amount: next });
      }
      setEditOpen(false);
      await qc.invalidateQueries({ queryKey });
      emitDebtTx({
        kind: tx.kind,
        wasCash: tx.label === "cash",
        amount: next - tx.amount,
        partyId: data?.party?.id ?? null,
        at: Date.now(),
      });
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Gagal mengubah nominal.");
    } finally {
      setReverting(false);
    }
  }

  async function allocatePayment(amount: number, label: "pay" | "lunas"): Promise<{ ok: boolean; error?: string; applied?: number }> {
    if (!uid || amount <= 0) return { ok: false, error: "Jumlah tidak valid" };
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
        return { ok: false, error: "Tidak ada saldo untuk dibayar" };
      }
      const { data: ins, error } = await supabase.from("debt_payments").insert(rows).select("id");
      if (error) throw error;
      const applied = amount - left;
      const paymentIds = ((ins ?? []) as Array<{ id: string }>).map((r) => r.id);
      toast.success(
        label === "lunas"
          ? `${kindLabel} ${partyLabel} dilunasi (${rupiah(applied)}).`
          : `Pembayaran ${rupiah(applied)} tercatat${left > 0 ? ` (sisa input ${rupiah(left)} tidak dipakai)` : ""}.`,
      );
      setLastTx({
        label,
        kind,
        paymentIds,
        amount: applied,
      });
      setAmountRaw("");
      await qc.invalidateQueries({ queryKey });
      emitDebtTx({
        kind,
        wasCash: false,
        amount: -applied,
        partyId: data?.party?.id ?? null,
        at: Date.now(),
      });
      return { ok: true, applied };
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? "Gagal mencatat pembayaran.";
      toast.error(msg);
      return { ok: false, error: msg };
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
          onClick={() => setPending({ kind: "add" })}
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
          onClick={() => setPending({ kind: "cash" })}
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
          onClick={() => setPending({ kind: "pay", amount: parsed })}
          disabled={busy !== null || !hasAmount || saldo <= 0}
          className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-2 text-[11px] font-semibold hover:bg-accent disabled:opacity-50"
          title="Catat pembayaran sebagian sesuai jumlah di kiri"
        >
          {busy === "pay" ? <Loader2 className="h-3 w-3 animate-spin" /> : <HandCoins className="h-3 w-3" />}
          Bayar
        </button>
        <button
          type="button"
          onClick={() => setPending({ kind: "lunas", amount: saldo })}
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
      {lastTx && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-dashed bg-background/60 px-2 py-1.5 text-[11px]">
          <span className="text-muted-foreground">Transaksi terakhir:</span>
          <span className="font-semibold text-foreground">
            {"paymentIds" in lastTx
              ? (lastTx.label === "lunas" ? "Lunas" : "Bayar")
              : lastTx.wasCash
                ? (lastTx.kind === "piutang" ? "Jual tunai" : "Beli tunai")
                : (lastTx.kind === "piutang" ? "Harga jual" : "Harga beli")}
            {" "}· {rupiah(lastTx.amount)}
          </span>
          <button
            type="button"
            onClick={() => { setEditAmountRaw(String(lastTx.amount)); setEditOpen(true); }}
            disabled={reverting}
            className="ml-auto inline-flex h-6 items-center gap-1 rounded border bg-background px-1.5 font-semibold hover:bg-accent disabled:opacity-50"
            title="Ubah nominal transaksi terakhir"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
          <button
            type="button"
            onClick={() => setUndoOpen(true)}
            disabled={reverting}
            className="inline-flex h-6 items-center gap-1 rounded border border-red-500/50 bg-red-500/10 px-1.5 font-semibold text-red-700 hover:bg-red-500/20 disabled:opacity-50 dark:text-red-300"
            title="Batalkan & balik saldo"
          >
            {reverting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />} Urungkan
          </button>
        </div>
      )}
      <div className="mt-2 rounded-md border bg-background/50">
        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          aria-expanded={historyOpen}
          className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold hover:bg-accent"
        >
          <ScrollText className="h-3 w-3 text-muted-foreground" />
          <span>Riwayat aksi</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">{log.length}</span>
          <ChevronDown className={"ml-auto h-3 w-3 text-muted-foreground transition-transform " + (historyOpen ? "rotate-180" : "")} />
        </button>
        {historyOpen && (
          <div className="border-t">
            {log.length === 0 ? (
              <div className="px-2 py-2 text-[11px] text-muted-foreground">
                Belum ada aksi tercatat. Setiap tekanan Harga Jual / Beli / Tunai / Bayar / Lunas akan muncul di sini.
              </div>
            ) : (
              <>
                <ol className="max-h-48 overflow-y-auto divide-y text-[11px]">
                  {log.map((e) => {
                    const statusColor =
                      e.status === "confirmed"
                        ? "text-emerald-700 dark:text-emerald-300"
                        : e.status === "failed"
                          ? "text-red-700 dark:text-red-300"
                          : "text-muted-foreground";
                    const statusLabel =
                      e.status === "confirmed" ? "OK" : e.status === "failed" ? "Gagal" : "Batal";
                    return (
                      <li key={e.id} className="flex items-center gap-2 px-2 py-1.5">
                        <span className="font-mono text-[10px] text-muted-foreground shrink-0 w-14">
                          {new Date(e.at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          <b>{actionLabel(e.kind, e.balanceKind)}</b>
                          <span className="ml-1 font-mono">
                            {e.kind === "edit" && e.prevAmount !== undefined
                              ? `${rupiah(e.prevAmount)} → ${rupiah(e.amount)}`
                              : rupiah(e.amount)}
                          </span>
                          <span className="ml-1 text-muted-foreground">· {e.party}</span>
                        </span>
                        <span className={"shrink-0 font-semibold " + statusColor}>{statusLabel}</span>
                      </li>
                    );
                  })}
                </ol>
                <div className="flex items-center justify-between border-t px-2 py-1 text-[10px] text-muted-foreground">
                  <span>Tersimpan lokal di perangkat ini (maks. 50 entri).</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm("Hapus semua riwayat aksi lokal?")) clearDebtActionLog();
                    }}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold text-red-700 hover:bg-red-500/10 dark:text-red-300"
                  >
                    <Trash2 className="h-3 w-3" /> Hapus riwayat
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <AlertDialog open={undoOpen} onOpenChange={(o) => {
        if (reverting) return;
        if (!o && undoOpen && !undoConfirmedRef.current && lastTx) {
          logAction("undo", "cancelled", lastTx.amount);
        }
        if (o) undoConfirmedRef.current = false;
        setUndoOpen(o);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan transaksi terakhir?</AlertDialogTitle>
            <AlertDialogDescription>
              {lastTx
                ? ("paymentIds" in lastTx
                    ? `Menghapus pembayaran ${rupiah(lastTx.amount)} atas ${partyLabel}. Saldo ${lastTx.kind === "piutang" ? "piutang" : "hutang"} akan bertambah kembali.`
                    : `Menghapus catatan ${lastTx.wasCash ? "tunai" : (lastTx.kind === "piutang" ? "piutang" : "hutang")} ${rupiah(lastTx.amount)} atas ${partyLabel}. Saldo dikembalikan ke sebelum transaksi ini.`)
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reverting}>Tidak</AlertDialogCancel>
            <AlertDialogAction
              disabled={reverting}
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={async (e) => {
                e.preventDefault();
                undoConfirmedRef.current = true;
                const amt = lastTx?.amount ?? 0;
                const before = lastTx;
                await revertLastTx();
                if (before) {
                  logAction("undo", "confirmed", amt);
                }
              }}
            >
              Ya, batalkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={editOpen} onOpenChange={(o) => {
        if (reverting) return;
        if (!o && editOpen && !editConfirmedRef.current && lastTx) {
          logAction("edit", "cancelled", lastTx.amount, { prevAmount: lastTx.amount });
        }
        if (o) editConfirmedRef.current = false;
        setEditOpen(o);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ubah nominal transaksi terakhir</AlertDialogTitle>
            <AlertDialogDescription>
              {lastTx
                ? ("paymentIds" in lastTx
                    ? `Sebelumnya membayar ${rupiah(lastTx.amount)}. Masukkan nominal baru — pembayaran lama dibalik dan dialokasi ulang ke tagihan terlama dulu.`
                    : `Sebelumnya ${rupiah(lastTx.amount)}. Masukkan nominal baru — saldo ${lastTx.kind === "piutang" ? "piutang" : "hutang"} otomatis disesuaikan${lastTx.wasCash ? " (pembayaran tunai ikut diperbarui)" : ""}.`)
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input
            value={editAmountRaw}
            onChange={(e) => setEditAmountRaw(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            placeholder="Nominal baru (Rp)"
            className="h-9 w-full rounded-md border bg-background px-2 text-right font-mono text-sm"
            disabled={reverting}
          />
          {(() => {
            const preview = computeEditPreview();
            if (!preview) return null;
            if (!preview.valid) {
              return (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-800 dark:text-amber-200">
                  {preview.reason}
                </div>
              );
            }
            const deltaColor =
              preview.deltaSaldo === 0
                ? "text-muted-foreground"
                : preview.deltaSaldo > 0
                  ? (lastTx && lastTx.kind === "piutang" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300")
                  : "text-red-700 dark:text-red-300";
            const deltaSign = preview.deltaSaldo > 0 ? "+" : preview.deltaSaldo < 0 ? "−" : "";
            return (
              <div className="rounded-md border bg-muted/30 p-2 text-[11px] space-y-1">
                {preview.kind === "amount" ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Nominal</span>
                      <span className="font-mono">{rupiah(preview.prevAmount)} → <b className="text-foreground">{rupiah(preview.nextAmount)}</b></span>
                    </div>
                    {preview.paidAfter > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Pembayaran tercatat</span>
                        <span className="font-mono">{rupiah(preview.paidAfter)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Sisa tagihan ini</span>
                      <span className="font-mono">{rupiah(preview.sisaBefore)} → <b className={preview.sisaAfter === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}>{rupiah(preview.sisaAfter)}{preview.sisaAfter === 0 ? " · lunas" : ""}</b></span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between font-semibold text-foreground">
                      <span>Alokasi ulang (terlama dulu)</span>
                      <span className="font-mono">{preview.lines.length} tagihan</span>
                    </div>
                    {preview.lines.length === 0 ? (
                      <div className="text-muted-foreground">Tidak ada tagihan terbuka setelah pembayaran lama dibalik.</div>
                    ) : (
                      <ol className="space-y-0.5">
                        {preview.lines.map((ln, i) => (
                          <li key={ln.id} className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-muted-foreground">
                              {i + 1}. {formatDate(ln.created_at)}
                              <span className="ml-1 font-mono">· sisa {rupiah(ln.sisaBefore)}</span>
                            </span>
                            <span className="shrink-0 text-right font-mono">
                              − {rupiah(ln.take)}
                              <span className={"ml-1 " + (ln.sisaAfter === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                                → {rupiah(ln.sisaAfter)}{ln.sisaAfter === 0 ? " · lunas" : ""}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                    <div className="flex items-center justify-between border-t pt-1">
                      <span className="text-muted-foreground">Terpakai</span>
                      <span className="font-mono font-semibold">{rupiah(preview.prevApplied)} → <b className="text-foreground">{rupiah(preview.applied)}</b></span>
                    </div>
                    {preview.leftover > 0 && (
                      <div className="flex items-center justify-between text-amber-700 dark:text-amber-300">
                        <span>Sisa input tidak terpakai</span>
                        <span className="font-mono">{rupiah(preview.leftover)}</span>
                      </div>
                    )}
                  </>
                )}
                <div className="flex items-center justify-between border-t pt-1">
                  <span className="text-muted-foreground">Saldo {lastTx && lastTx.kind === "piutang" ? "piutang" : "hutang"}</span>
                  <span className="font-mono">
                    {rupiah(saldo)} → <b className="text-foreground">{rupiah(Math.max(0, preview.newSaldo))}</b>
                    <span className={"ml-1 " + deltaColor}>({deltaSign}{rupiah(Math.abs(preview.deltaSaldo))})</span>
                  </span>
                </div>
              </div>
            );
          })()}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reverting}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={reverting || !(computeEditPreview()?.valid)}
              onClick={async (e) => {
                e.preventDefault();
                editConfirmedRef.current = true;
                const prev = lastTx?.amount ?? 0;
                const next = Number(editAmountRaw.replace(/\D+/g, ""));
                await saveEditLastTx();
                logAction("edit", "confirmed", Number.isFinite(next) ? next : prev, { prevAmount: prev });
              }}
            >
              Simpan perubahan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={pending !== null} onOpenChange={(o) => {
        if (!o && pending && !pendingConfirmedRef.current) {
          const amt = pending.kind === "pay" || pending.kind === "lunas" ? pending.amount : parsed;
          logAction(pending.kind, "cancelled", amt);
        }
        if (o) pendingConfirmedRef.current = false;
        if (!o) setPending(null);
      }}>
        <AlertDialogContent>
          {pending && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{confirmCopy[pending.kind].title}</AlertDialogTitle>
                <AlertDialogDescription>{confirmCopy[pending.kind].desc}</AlertDialogDescription>
              </AlertDialogHeader>
              {(pending.kind === "pay" || pending.kind === "lunas") && (() => {
                const preview = allocationPreview(pending.amount);
                if (preview.lines.length === 0) {
                  return (
                    <div className="rounded-md border border-dashed p-2 text-[11px] text-muted-foreground">
                      Tidak ada tagihan terbuka untuk dialokasi.
                    </div>
                  );
                }
                return (
                  <div className="rounded-md border bg-muted/30 p-2 text-[11px]">
                    <div className="mb-1 flex items-center justify-between font-semibold text-foreground">
                      <span>Alokasi ke tagihan (terlama dulu)</span>
                      <span className="font-mono">{preview.lines.length} tagihan</span>
                    </div>
                    <ol className="space-y-1">
                      {preview.lines.map((ln, i) => (
                        <li key={ln.id} className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-muted-foreground">
                            {i + 1}. {formatDate(ln.created_at)}
                            <span className="ml-1 font-mono">· sisa {rupiah(ln.sisaBefore)}</span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="font-mono font-semibold text-foreground">− {rupiah(ln.take)}</span>
                            <span className={"ml-1 font-mono " + (ln.sisaAfter === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                              → {rupiah(ln.sisaAfter)}
                              {ln.sisaAfter === 0 ? " · lunas" : ""}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ol>
                    <div className="mt-1.5 flex items-center justify-between border-t pt-1 font-semibold">
                      <span className="text-muted-foreground">Total terpakai</span>
                      <span className="font-mono text-foreground">{rupiah(preview.applied)}</span>
                    </div>
                    {preview.leftover > 0 && (
                      <div className="mt-0.5 flex items-center justify-between text-amber-700 dark:text-amber-300">
                        <span>Sisa input tidak terpakai</span>
                        <span className="font-mono">{rupiah(preview.leftover)}</span>
                      </div>
                    )}
                    <div className="mt-0.5 flex items-center justify-between text-muted-foreground">
                      <span>Saldo setelah bayar</span>
                      <span className="font-mono">{rupiah(Math.max(0, saldo - preview.applied))}</span>
                    </div>
                  </div>
                );
              })()}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy !== null}>Batal</AlertDialogCancel>
                <AlertDialogAction
                  disabled={busy !== null}
                  className={confirmCopy[pending.kind].ctaClass}
                  onClick={async (e) => {
                    e.preventDefault();
                    pendingConfirmedRef.current = true;
                    const p = pending;
                    setPending(null);
                    if (p) await runPending(p);
                  }}
                >
                  {confirmCopy[pending.kind].cta}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}