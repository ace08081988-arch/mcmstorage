import { createFileRoute, Link } from "@tanstack/react-router";
import { NumericTextField } from "@/components/NumericDraftInput";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError, notifyError } from "@/lib/friendly-error";
import { confirm } from "@/lib/confirm";
import { shareToWhatsApp, notifyShareResult } from "@/lib/share-wa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ArrowLeft,
  Plus,
  Wallet,
  Coins,
  CalendarClock,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  ArrowDownCircle,
  ArrowUpCircle,
  Scale,
  Search,
  ChevronsUpDown,
  Check,
  Loader2,
  X,
} from "lucide-react";
import { assertDebtSource } from "@/lib/debt-source";
import { scopedKey } from "@/lib/user-scoped-storage";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/hutang-piutang")({
  head: () => ({
    meta: [
      { title: "Hutang & Piutang · MCM Storage" },
      {
        name: "description",
        content:
          "Catat hutang dan piutang manual, lacak jatuh tempo, dan rekam pembayaran cicilan.",
      },
    ],
  }),
  component: HutangPiutangPage,
});

type Kind = "hutang" | "piutang";
type Source = "manual" | "purchase" | "sale";

type Debt = {
  id: string;
  kind: Kind;
  party_name: string;
  supplier_id: string | null;
  customer_id: string | null;
  amount: number;
  due_date: string | null;
  note: string | null;
  source: Source;
  source_id: string | null;
  created_at: string;
};

type Payment = {
  id: string;
  debt_id: string;
  amount: number;
  paid_at: string;
  note: string | null;
};

type Party = { id: string; name: string; contact?: string | null };

const rupiah = (n: number) =>
  "Rp " + Math.round(n).toLocaleString("id-ID");

type FinanceTone = "emerald" | "rose" | "amber" | "sky" | "danger" | "muted";
function FinanceStatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "muted",
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: FinanceTone;
}) {
  const tones: Record<FinanceTone, string> = {
    emerald: "from-success/15 to-success/5 text-success dark:text-success",
    rose: "from-rose-500/15 to-rose-500/5 text-rose-600 dark:text-rose-300",
    amber: "from-warning/15 to-warning/5 text-warning dark:text-warning",
    sky: "from-sky-500/15 to-sky-500/5 text-sky-600 dark:text-sky-300",
    danger: "from-destructive/20 to-destructive/5 text-destructive",
    muted: "from-muted/60 to-muted/20 text-foreground",
  };
  return (
    <div className="rounded-2xl border bg-card p-ms-3 shadow-sm">
      <div className="flex items-start gap-ms-2">
        <div
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${tones[tone]}`}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <div className="mt-0.5 truncate text-ms-sm font-bold leading-tight tabular-nums">
            {value}
          </div>
          {hint && (
            <div className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{hint}</div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Baris status pembayaran untuk disisipkan di setiap pesan WA/chat sebagai
 * verifikasi ringkas. `LUNAS` bila sisa = 0, `BAYAR SEBAGIAN` bila sudah
 * ada pembayaran namun belum habis, `BELUM BAYAR` bila belum ada pembayaran.
 * Persentase dibulatkan agar mudah dibaca lawan bicara.
 */
function debtStatusLine(total: number, paid: number): string {
  const t = Math.max(0, Math.round(total));
  const p = Math.max(0, Math.min(t, Math.round(paid)));
  const sisa = Math.max(0, t - p);
  const pct = t > 0 ? Math.round((p / t) * 100) : 0;
  if (sisa === 0 && t > 0) return `✅ *LUNAS* — ${rupiah(t)} sudah dibayar penuh`;
  if (p > 0) return `💰 *BAYAR SEBAGIAN* — ${rupiah(p)} dari ${rupiah(t)} (${pct}%) · sisa *${rupiah(sisa)}*`;
  return `⚠️ *BELUM BAYAR* — ${rupiah(t)} belum ada pembayaran`;
}

function HutangPiutangPage() {
  const [uid, setUid] = useState<string | null>(null);
  const [tab, setTab] = useState<"hutang" | "piutang" | "laporan">("hutang");
  const [debts, setDebts] = useState<Debt[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [customers, setCustomers] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [addPrefill, setAddPrefill] = useState<{
    kind: Kind;
    name: string;
    supplierId?: string | null;
    customerId?: string | null;
  } | null>(null);
  const [payFor, setPayFor] = useState<Debt | null>(null);
  const [reminderFor, setReminderFor] = useState<Debt | null>(null);
  const [editFor, setEditFor] = useState<Debt | null>(null);
  const [period, setPeriod] = useState<"all" | "week" | "month" | "custom">("all");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [draftFrom, setDraftFrom] = useState<string>("");
  const [draftTo, setDraftTo] = useState<string>("");
  /**
   * SSOT gabungan (RPC `piutang_summary_v1` / `hutang_summary_v1`) —
   * angka yang sama persis dipakai Dashboard & Gudang. Catatan manual di
   * daftar bawah hanya salah satu sumbernya, jadi kartu total harus
   * membaca SSOT, bukan hasil penjumlahan daftar manual.
   */
  const [ssot, setSsot] = useState<{ piutang: number; hutang: number } | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null));
  }, []);

  const refreshSsot = useCallback(async () => {
    const [p, h] = await Promise.all([fetchPiutangSummary(), fetchHutangSummary()]);
    setSsot({ piutang: p.total_outstanding, hutang: h.total_outstanding });
  }, []);

  const refresh = async () => {
    setLoading(true);
    // H14: cap large tables so page doesn't fetch unbounded rows.
    // Debts and their payments are already scoped to the user by RLS; we cap
    // to keep memory + first-render fast.
    const [d, p, s, c] = await Promise.all([
      supabase
        .from("debts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(2000),
      supabase
        .from("debt_payments")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5000),
      supabase.from("suppliers").select("id,name,contact").order("name"),
      supabase.from("customers").select("id,name,contact").order("name"),
    ]);
    if (d.error) notifyError(d.error);
    else setDebts((d.data ?? []) as Debt[]);
    if (p.data) setPayments(p.data as Payment[]);
    if (s.data) setSuppliers(s.data as Party[]);
    if (c.data) setCustomers(c.data as Party[]);
    setLoading(false);
  };

  useEffect(() => {
    if (uid) void refresh();
  }, [uid]);

  // H21: realtime — pull fresh data when debts / payments change from another
  // tab or device so the piutang view isn't stale.
  useEffect(() => {
    if (!uid) return;
    let scheduled: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (scheduled) return;
      scheduled = setTimeout(() => {
        scheduled = null;
        void refresh();
      }, 400);
    };
    const ch = supabase
      .channel(`hutang-piutang:${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "debts", filter: `user_id=eq.${uid}` },
        bump,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "debt_payments", filter: `user_id=eq.${uid}` },
        bump,
      )
      .subscribe();
    return () => {
      if (scheduled) clearTimeout(scheduled);
      supabase.removeChannel(ch);
    };
  }, [uid]);

  const paidByDebt = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of payments) {
      m.set(p.debt_id, (m.get(p.debt_id) ?? 0) + Number(p.amount));
    }
    return m;
  }, [payments]);

  const periodRange = useMemo<{ from: Date | null; to: Date | null }>(() => {
    const now = new Date();
    if (period === "week") {
      const from = new Date(now);
      from.setDate(from.getDate() - 7);
      return { from, to: null };
    }
    if (period === "month") {
      const from = new Date(now);
      from.setMonth(from.getMonth() - 1);
      return { from, to: null };
    }
    if (period === "custom") {
      const from = customFrom ? new Date(customFrom + "T00:00:00") : null;
      const to = customTo ? new Date(customTo + "T23:59:59") : null;
      return { from, to };
    }
    return { from: null, to: null };
  }, [period, customFrom, customTo]);

  const inPeriod = (iso: string) => {
    if (!periodRange.from && !periodRange.to) return true;
    const t = new Date(iso).getTime();
    if (periodRange.from && t < periodRange.from.getTime()) return false;
    if (periodRange.to && t > periodRange.to.getTime()) return false;
    return true;
  };

  const debtsInPeriod = useMemo(
    () => debts.filter((d) => inPeriod(d.created_at)),
    [debts, periodRange],
  );

  const activeKind: Kind = tab === "piutang" ? "piutang" : "hutang";
  const filtered = debtsInPeriod.filter((d) => d.kind === activeKind);

  const totals = useMemo(() => {
    let total = 0;
    let paid = 0;
    for (const d of filtered) {
      total += Number(d.amount);
      paid += paidByDebt.get(d.id) ?? 0;
    }
    return { total, paid, sisa: total - paid };
  }, [filtered, paidByDebt]);

  const overall = useMemo(() => {
    let hutangSisa = 0;
    let piutangSisa = 0;
    for (const d of debtsInPeriod) {
      const sisa = Math.max(0, Number(d.amount) - (paidByDebt.get(d.id) ?? 0));
      if (d.kind === "hutang") hutangSisa += sisa;
      else piutangSisa += sisa;
    }
    return { hutangSisa, piutangSisa, net: piutangSisa - hutangSisa };
  }, [debtsInPeriod, paidByDebt]);

  const financeStats = useMemo(() => {
    const today = new Date();
    const todayKey = today.toISOString().slice(0, 10);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
    let dueToday = 0;
    let dueTodayCount = 0;
    let overdueSum = 0;
    let overdueCount = 0;
    for (const d of debtsInPeriod) {
      const sisa = Math.max(0, Number(d.amount) - (paidByDebt.get(d.id) ?? 0));
      if (sisa <= 0 || !d.due_date) continue;
      const dueKey = new Date(d.due_date).toISOString().slice(0, 10);
      if (dueKey === todayKey) {
        dueToday += sisa;
        dueTodayCount += 1;
      } else if (dueKey < todayKey) {
        overdueSum += sisa;
        overdueCount += 1;
      }
    }
    let paidThisMonth = 0;
    for (const p of payments) {
      const t = new Date(p.paid_at).getTime();
      if (t >= monthStart) paidThisMonth += Number(p.amount);
    }
    return { dueToday, dueTodayCount, overdueSum, overdueCount, paidThisMonth };
  }, [debtsInPeriod, paidByDebt, payments]);

  const removeDebt = async (d: Debt) => {
    if (
      !(await confirm({
        title: "Hapus catatan?",
        description: `${d.kind === "hutang" ? "Hutang ke" : "Piutang dari"} ${d.party_name} sebesar ${rupiah(d.amount)} akan dihapus berikut riwayat pembayarannya.`,
        confirmText: "Hapus",
        destructive: true,
      }))
    )
      return;
    const { error } = await supabase.from("debts").delete().eq("id", d.id);
    if (error) notifyError(error);
    else {
      toast.success("Dihapus");
      void refresh();
    }
  };

  const partyPhone = (d: Debt): string | undefined => {
    const list = d.kind === "hutang" ? suppliers : customers;
    const id = d.kind === "hutang" ? d.supplier_id : d.customer_id;
    const found = id ? list.find((p) => p.id === id) : undefined;
    const raw = found?.contact ?? "";
    const digits = raw.replace(/\D/g, "");
    return digits.length >= 8 ? digits : undefined;
  };

  const groupedByParty = useMemo(() => {
    const map = new Map<
      string,
      { key: string; name: string; supplierId: string | null; customerId: string | null; items: Debt[] }
    >();
    for (const d of filtered) {
      const partyKey =
        (d.kind === "hutang" ? d.supplier_id : d.customer_id) ??
        `name:${d.party_name.toLowerCase()}`;
      const cur = map.get(partyKey);
      if (cur) cur.items.push(d);
      else
        map.set(partyKey, {
          key: partyKey,
          name: d.party_name,
          supplierId: d.supplier_id,
          customerId: d.customer_id,
          items: [d],
        });
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered]);

  const partyPhoneByName = (kind: Kind, name: string, supplierId: string | null, customerId: string | null) => {
    const list = kind === "hutang" ? suppliers : customers;
    const id = kind === "hutang" ? supplierId : customerId;
    const found = id ? list.find((p) => p.id === id) : list.find((p) => p.name === name);
    const digits = (found?.contact ?? "").replace(/\D/g, "");
    return digits.length >= 8 ? digits : undefined;
  };

  const sendReminderWA = async (
    d: Debt,
    extra?: { amount: number; paidAt: string; note: string } | null,
  ) => {
    const paidBefore = paidByDebt.get(d.id) ?? 0;
    const extraAmt = extra ? Math.max(0, Math.round(extra.amount)) : 0;
    const paid = paidBefore + extraAmt;
    const sisa = Math.max(0, Number(d.amount) - paid);
    const due = d.due_date
      ? `jatuh tempo ${new Date(d.due_date).toLocaleDateString("id-ID")}`
      : "tanpa jatuh tempo";
    const greet = `Halo ${d.party_name},`;
    const body = d.kind === "hutang"
      ? `Ini pengingat hutang saya kepada Anda sebesar *${rupiah(Number(d.amount))}* (${due}). Sudah terbayar ${rupiah(paid)}, sisa *${rupiah(sisa)}*. Mohon konfirmasi cara & waktu pelunasannya. Terima kasih.`
      : `Ini pengingat tagihan dari saya sebesar *${rupiah(Number(d.amount))}* (${due}). Sudah terbayar ${rupiah(paid)}, sisa *${rupiah(sisa)}*. Mohon segera diselesaikan ya, terima kasih.`;
    const status = debtStatusLine(Number(d.amount), paid);
    const extraLine =
      extra && extraAmt > 0
        ? `\n\n🧾 *Pembayaran baru dicatat*\n• Tanggal: ${new Date(extra.paidAt).toLocaleDateString("id-ID")}\n• Jumlah: ${rupiah(extraAmt)}${extra.note.trim() ? `\n• Catatan: ${extra.note.trim()}` : ""}`
        : "";
    const text = `${greet}\n\n${status}\n\n${body}${extraLine}${d.note ? `\n\nCatatan: ${d.note}` : ""}`;
    const res = await shareToWhatsApp({ text, title: d.party_name, phone: partyPhone(d) });
    notifyShareResult(res);
  };

  const sendPartyReportWA = async (group: {
    name: string;
    supplierId: string | null;
    customerId: string | null;
    items: Debt[];
  }) => {
    const kind = activeKind;
    let total = 0;
    let paid = 0;
    const lines: string[] = [];
    for (const d of group.items) {
      const dPaid = paidByDebt.get(d.id) ?? 0;
      const sisa = Math.max(0, Number(d.amount) - dPaid);
      total += Number(d.amount);
      paid += dPaid;
      const due = d.due_date
        ? new Date(d.due_date).toLocaleDateString("id-ID")
        : "—";
      lines.push(
        `• ${new Date(d.created_at).toLocaleDateString("id-ID")} · ${rupiah(Number(d.amount))} (sisa ${rupiah(sisa)}, jt: ${due})${d.note ? ` — ${d.note}` : ""}`,
      );
      const pays = payments
        .filter((p) => p.debt_id === d.id)
        .sort((a, b) => (a.paid_at < b.paid_at ? -1 : 1));
      for (const p of pays) {
        lines.push(
          `    ↳ Bayar ${new Date(p.paid_at).toLocaleDateString("id-ID")}: ${rupiah(Number(p.amount))}${p.note ? ` (${p.note})` : ""}`,
        );
      }
    }
    const sisa = Math.max(0, total - paid);
    const judul =
      kind === "hutang"
        ? `Laporan hutang saya kepada ${group.name}`
        : `Laporan piutang dari ${group.name}`;
    const text = [
      `*${judul}*`,
      debtStatusLine(total, paid),
      "",
      ...lines,
      "",
      `Total: ${rupiah(total)}`,
      `Terbayar: ${rupiah(paid)}`,
      `Sisa: *${rupiah(sisa)}*`,
    ].join("\n");
    const res = await shareToWhatsApp({
      text,
      title: group.name,
      phone: partyPhoneByName(kind, group.name, group.supplierId, group.customerId),
    });
    notifyShareResult(res);
  };

  const sendFullReportWA = async () => {
    const periodLabel =
      period === "all"
        ? "Semua periode"
        : period === "week"
          ? "7 hari terakhir"
          : period === "month"
            ? "30 hari terakhir"
            : `${customFrom || "—"} s/d ${customTo || "—"}`;
    const paysInPeriod = payments
      .filter((p) => inPeriod(p.paid_at))
      .sort((a, b) => (a.paid_at < b.paid_at ? 1 : -1));
    const debtById = new Map(debts.map((d) => [d.id, d]));
    let totalIn = 0; // piutang dibayar (uang masuk)
    let totalOut = 0; // hutang dibayar (uang keluar)
    const lines: string[] = [];
    for (const p of paysInPeriod) {
      const d = debtById.get(p.debt_id);
      if (!d) continue;
      const arah = d.kind === "hutang" ? "keluar" : "masuk";
      if (d.kind === "hutang") totalOut += Number(p.amount);
      else totalIn += Number(p.amount);
      lines.push(
        `• ${new Date(p.paid_at).toLocaleDateString("id-ID")} · ${d.party_name} · ${arah} ${rupiah(Number(p.amount))}${p.note ? ` — ${p.note}` : ""}`,
      );
    }
    // Total & terbayar keseluruhan (bukan periode) untuk baris status ringkas
    // — supaya pembaca tahu posisi utuh hutang/piutang saat pesan diterima.
    let hutangTotalAll = 0;
    let piutangTotalAll = 0;
    for (const d of debts) {
      if (d.kind === "hutang") hutangTotalAll += Number(d.amount);
      else piutangTotalAll += Number(d.amount);
    }
    let hutangPaidAll = 0;
    let piutangPaidAll = 0;
    for (const p of payments) {
      const d = debtById.get(p.debt_id);
      if (!d) continue;
      if (d.kind === "hutang") hutangPaidAll += Number(p.amount);
      else piutangPaidAll += Number(p.amount);
    }
    const text = [
      `*Laporan Hutang & Piutang*`,
      `Periode: ${periodLabel}`,
      "",
      `Hutang: ${debtStatusLine(hutangTotalAll, hutangPaidAll)}`,
      `Piutang: ${debtStatusLine(piutangTotalAll, piutangPaidAll)}`,
      "",
      `Sisa hutang: ${rupiah(overall.hutangSisa)}`,
      `Sisa piutang: ${rupiah(overall.piutangSisa)}`,
      `Selisih bersih: ${overall.net >= 0 ? "+" : "−"}${rupiah(Math.abs(overall.net))}`,
      "",
      `*Riwayat pembayaran (${paysInPeriod.length})*`,
      ...(lines.length > 0 ? lines : ["(tidak ada pembayaran pada periode ini)"]),
      "",
      `Uang masuk (piutang dibayar): ${rupiah(totalIn)}`,
      `Uang keluar (hutang dibayar): ${rupiah(totalOut)}`,
      `Arus bersih: ${totalIn - totalOut >= 0 ? "+" : "−"}${rupiah(Math.abs(totalIn - totalOut))}`,
    ].join("\n");
    const res = await shareToWhatsApp({ text, title: "Laporan Hutang & Piutang" });
    notifyShareResult(res);
  };

  return (
    <div
      className="min-h-screen bg-gradient-to-b from-background via-background to-muted/30"
      data-press-scope="on"
    >
      <header className="sticky top-0 z-10 border-b bg-card/85 backdrop-blur-md">
        <div className="mx-auto grid max-w-3xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-ms-3 px-ms-3 py-ms-3 sm:px-ms-6">
          <Link
            to="/"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border bg-background/60 hover:bg-accent"
            aria-label="Kembali"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-ms-base font-semibold leading-tight">
              Hutang &amp; Piutang
            </h1>
            <p className="truncate text-ms-2xs text-muted-foreground">
              Kelola arus tagihan &amp; pelunasan
            </p>
          </div>
          <Button
            size="sm"
            className="shrink-0 rounded-xl"
            onClick={() => {
              setAddPrefill(null);
              setAddOpen(true);
            }}
            aria-label={activeKind === "hutang" ? "Tambah hutang" : "Tambah piutang"}
          >
            <Plus className="mr-1 h-4 w-4" />
            <span className="hidden sm:inline">
              {activeKind === "hutang" ? "Tambah hutang" : "Tambah piutang"}
            </span>
            <span className="sm:hidden">Tambah</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-ms-4 px-ms-3 py-ms-4 sm:px-ms-6">
        <section
          aria-label="Ringkasan keuangan"
          className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-primary/10 via-card to-card p-ms-4 shadow-sm"
        >
          <div className="flex flex-wrap items-center gap-ms-2">
            <span className="inline-flex items-center gap-ms-1 rounded-full bg-primary/12 px-ms-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-primary">
              <Sparkles className="h-3 w-3" /> Modul Keuangan
            </span>
            <span className="text-ms-2xs text-muted-foreground">
              Selisih bersih{" "}
              <span
                className={
                  "font-semibold tabular-nums " +
                  (overall.net >= 0 ? "text-success" : "text-red-600")
                }
              >
                {(overall.net >= 0 ? "+" : "−") + rupiah(Math.abs(overall.net))}
              </span>
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-ms-2 sm:grid-cols-3 lg:grid-cols-5">
            <FinanceStatCard
              label="Total Piutang"
              value={rupiah(overall.piutangSisa)}
              hint="Uang yang belum masuk"
              icon={ArrowDownCircle}
              tone="emerald"
            />
            <FinanceStatCard
              label="Total Hutang"
              value={rupiah(overall.hutangSisa)}
              hint="Uang yang belum keluar"
              icon={ArrowUpCircle}
              tone="rose"
            />
            <FinanceStatCard
              label="Jatuh Tempo Hari Ini"
              value={rupiah(financeStats.dueToday)}
              hint={`${financeStats.dueTodayCount} catatan`}
              icon={CalendarClock}
              tone="amber"
            />
            <FinanceStatCard
              label="Terlambat"
              value={rupiah(financeStats.overdueSum)}
              hint={`${financeStats.overdueCount} catatan`}
              icon={AlertTriangle}
              tone={financeStats.overdueCount > 0 ? "danger" : "muted"}
            />
            <FinanceStatCard
              label="Terbayar Bulan Ini"
              value={rupiah(financeStats.paidThisMonth)}
              hint="Arus kas periode ini"
              icon={CheckCircle2}
              tone="sky"
            />
          </div>
        </section>

        <div className="rounded-2xl border bg-card p-ms-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-ms-2 text-ms-xs">
            <span className="font-medium text-muted-foreground">Periode:</span>
            <div className="flex flex-wrap gap-ms-1">
              {([
                { v: "all", l: "Semua" },
                { v: "week", l: "7 hari" },
                { v: "month", l: "30 hari" },
                { v: "custom", l: "Custom" },
              ] as const).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setPeriod(opt.v)}
                  aria-pressed={period === opt.v}
                  className={
                    "rounded-full border px-ms-3 py-1 text-ms-xs transition-colors " +
                    (period === opt.v
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-transparent bg-muted/50 text-muted-foreground hover:bg-accent hover:text-foreground")
                  }
                >
                  {opt.l}
                </button>
              ))}
            </div>
            {period === "custom" && (
              (() => {
                const invalidRange = Boolean(
                  draftFrom && draftTo && draftFrom > draftTo,
                );
                return (
              <div className="flex flex-wrap items-center gap-ms-2">
                <Input
                  type="date"
                  value={draftFrom}
                  onChange={(e) => setDraftFrom(e.target.value)}
                  className={
                    "h-9 w-auto rounded-lg text-ms-xs" +
                    (invalidRange ? " border-destructive" : "")
                  }
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  type="date"
                  value={draftTo}
                  onChange={(e) => setDraftTo(e.target.value)}
                  className={
                    "h-9 w-auto rounded-lg text-ms-xs" +
                    (invalidRange ? " border-destructive" : "")
                  }
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-9 rounded-lg px-ms-3 text-ms-xs"
                  onClick={() => {
                    setCustomFrom(draftFrom);
                    setCustomTo(draftTo);
                  }}
                  disabled={
                    invalidRange ||
                    (draftFrom === customFrom && draftTo === customTo)
                  }
                >
                  Terapkan
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9 rounded-lg px-ms-3 text-ms-xs"
                  onClick={() => {
                    setDraftFrom("");
                    setDraftTo("");
                    setCustomFrom("");
                    setCustomTo("");
                  }}
                  disabled={!draftFrom && !draftTo && !customFrom && !customTo}
                >
                  Reset
                </Button>
                {invalidRange && (
                  <span className="w-full text-ms-xs text-destructive">
                    Tanggal mulai tidak boleh lebih besar dari tanggal selesai.
                  </span>
                )}
              </div>
                );
              })()
            )}
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="grid w-full grid-cols-3 rounded-xl">
            <TabsTrigger value="hutang" className="rounded-lg gap-ms-1.5">
              <ArrowUpCircle className="h-3.5 w-3.5" /> Hutang
            </TabsTrigger>
            <TabsTrigger value="piutang" className="rounded-lg gap-ms-1.5">
              <ArrowDownCircle className="h-3.5 w-3.5" /> Piutang
            </TabsTrigger>
            <TabsTrigger value="laporan" className="rounded-lg gap-ms-1.5">
              <Scale className="h-3.5 w-3.5" /> Laporan
            </TabsTrigger>
          </TabsList>

          {(["hutang", "piutang"] as const).map((k) => (
            <TabsContent key={k} value={k} className="mt-3 space-ms-3">
              <div className="grid grid-cols-3 gap-ms-2 rounded-2xl border bg-card p-ms-3 text-center text-ms-xs shadow-sm">
                <div className="rounded-xl bg-muted/40 p-ms-2">
                  <div className="flex items-center justify-center gap-ms-1 text-muted-foreground">
                    <Wallet className="h-3 w-3" /> Total
                  </div>
                  <div className="mt-0.5 font-semibold tabular-nums">{rupiah(totals.total)}</div>
                </div>
                <div className="rounded-xl bg-success/10 p-ms-2">
                  <div className="flex items-center justify-center gap-ms-1 text-success dark:text-success">
                    <CheckCircle2 className="h-3 w-3" /> Terbayar
                  </div>
                  <div className="mt-0.5 font-semibold tabular-nums text-success">
                    {rupiah(totals.paid)}
                  </div>
                </div>
                <div className="rounded-xl bg-warning/10 p-ms-2">
                  <div className="flex items-center justify-center gap-ms-1 text-warning dark:text-warning">
                    <Coins className="h-3 w-3" /> Sisa
                  </div>
                  <div className="mt-0.5 font-semibold tabular-nums text-warning">
                    {rupiah(totals.sisa)}
                  </div>
                </div>
              </div>

              {loading ? (
                <ul className="space-ms-3" aria-busy="true" aria-live="polite">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <li key={i} className="rounded-2xl border bg-card p-ms-3 shadow-sm">
                      <div className="flex items-center justify-between gap-ms-3">
                        <div className="min-w-0 flex-1 space-ms-2">
                          <Skeleton className="h-4 w-2/5" />
                          <Skeleton className="h-3 w-1/3" />
                        </div>
                        <Skeleton className="h-6 w-20" />
                      </div>
                      <Skeleton className="mt-3 h-8 w-full" />
                    </li>
                  ))}
                </ul>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center gap-ms-3 rounded-2xl border border-dashed bg-card/40 py-12 text-center text-ms-sm text-muted-foreground">
                  <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary">
                    {k === "hutang" ? (
                      <ArrowUpCircle className="h-6 w-6" />
                    ) : (
                      <ArrowDownCircle className="h-6 w-6" />
                    )}
                  </div>
                  <p className="font-semibold text-foreground">Belum ada catatan {k}</p>
                  <p className="mx-auto max-w-xs text-ms-xs leading-relaxed">
                    Catat {k} secara manual atau tunggu {k === "hutang" ? "pembelian" : "penjualan"}{" "}
                    masuk otomatis.
                  </p>
                  <Button
                    size="sm"
                    className="mt-1 rounded-xl"
                    onClick={() => {
                      setAddPrefill(null);
                      setAddOpen(true);
                    }}
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    {k === "hutang" ? "Tambah hutang" : "Tambah piutang"}
                  </Button>
                </div>
              ) : (
                <div className="space-ms-4">
                  {groupedByParty.map((group) => {
                    let gTotal = 0;
                    let gPaid = 0;
                    for (const it of group.items) {
                      gTotal += Number(it.amount);
                      gPaid += paidByDebt.get(it.id) ?? 0;
                    }
                    const gSisa = Math.max(0, gTotal - gPaid);
                    return (
                      <section
                        key={group.key}
                        className="overflow-hidden rounded-2xl border bg-card shadow-sm"
                      >
                        <header className="flex flex-wrap items-center gap-ms-2 border-b bg-muted/30 px-ms-3 py-ms-2.5">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-ms-sm font-semibold text-foreground">
                              {group.name}
                            </div>
                            <div className="text-ms-2xs text-muted-foreground">
                              {group.items.length} catatan · sisa{" "}
                              <span className="font-semibold tabular-nums text-warning">
                                {rupiah(gSisa)}
                              </span>{" "}
                              dari <span className="tabular-nums">{rupiah(gTotal)}</span>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-lg"
                            onClick={() => {
                              setAddPrefill({
                                kind: k,
                                name: group.name,
                                supplierId: group.supplierId,
                                customerId: group.customerId,
                              });
                              setAddOpen(true);
                            }}
                            title={`Tambah ${k} untuk ${group.name}`}
                          >
                            <Plus className="mr-1 h-3.5 w-3.5" /> Tambah
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-8 rounded-lg bg-[#25D366]/15 text-[#1ea952] hover:bg-[#25D366]/25"
                            onClick={() => void sendPartyReportWA(group)}
                            title="Kirim laporan via MCM"
                          >
                            Kirim laporan
                          </Button>
                        </header>
                        <ul className="divide-y">
                          {group.items.map((d) => {
                    const paid = paidByDebt.get(d.id) ?? 0;
                    const sisa = Number(d.amount) - paid;
                    const lunas = sisa <= 0;
                    const overdue =
                      !lunas &&
                      d.due_date &&
                      new Date(d.due_date) < new Date(new Date().toDateString());
                    return (
                      <li
                        key={d.id}
                        className={
                          "p-ms-3 text-ms-sm transition-colors " +
                          (overdue
                            ? "bg-destructive/[0.04] hover:bg-destructive/[0.07]"
                            : "hover:bg-muted/30")
                        }
                      >
                        <div className="flex items-start gap-ms-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="min-w-0 max-w-full truncate font-medium">
                                {d.party_name}
                              </span>
                              {d.source !== "manual" && (
                                <StatusBadge
                                  size="xs"
                                  variant="info"
                                  className="max-w-[7rem]"
                                >
                                  {d.source === "purchase" ? "Pembelian" : "Penjualan"}
                                </StatusBadge>
                              )}
                              {lunas ? (
                                <StatusBadge size="xs" variant="lunas">Lunas</StatusBadge>
                              ) : overdue ? (
                                <StatusBadge size="xs" variant="danger">Telat</StatusBadge>
                              ) : null}
                            </div>
                            {d.note && (
                              <div className="mt-0.5 truncate text-ms-xs text-muted-foreground">
                                {d.note}
                              </div>
                            )}
                            <div
                              className={
                                "mt-1 flex items-center gap-ms-1 text-ms-xs " +
                                (overdue ? "text-destructive" : "text-muted-foreground")
                              }
                            >
                              <CalendarClock className="h-3 w-3 shrink-0" />
                              <span className="truncate">
                                {d.due_date
                                  ? `Jatuh tempo ${new Date(d.due_date).toLocaleDateString("id-ID")}`
                                  : "Tanpa jatuh tempo"}
                              </span>
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="font-semibold tabular-nums">
                              {rupiah(Number(d.amount))}
                            </div>
                            {paid > 0 && (
                              <div className="text-ms-2xs tabular-nums text-muted-foreground">
                                terbayar {rupiah(paid)}
                              </div>
                            )}
                            <div
                              className={
                                "text-ms-2xs font-medium tabular-nums " +
                                (lunas
                                  ? "text-success"
                                  : overdue
                                    ? "text-destructive"
                                    : "text-warning")
                              }
                            >
                              sisa {rupiah(Math.max(0, sisa))}
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-ms-1.5">
                          {!lunas && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 rounded-lg"
                              onClick={() => setPayFor(d)}
                            >
                              <Plus className="mr-1 h-3.5 w-3.5" /> Bayar
                            </Button>
                          )}
                          {!lunas && (
                            <Button
                              size="sm"
                              variant="secondary"
                              className="h-8 rounded-lg bg-[#25D366]/15 text-[#1ea952] hover:bg-[#25D366]/25"
                              onClick={() => setReminderFor(d)}
                              title="Kirim pengingat via MCM"
                            >
                              Tagih
                            </Button>
                          )}
                          {d.source === "manual" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 rounded-lg"
                              onClick={() => setEditFor(d)}
                              title="Edit catatan"
                            >
                              Edit
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="ml-auto h-8 rounded-lg text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => void removeDebt(d)}
                          >
                            Hapus
                          </Button>
                        </div>
                        <PaymentHistory
                          debtId={d.id}
                          payments={payments.filter((p) => p.debt_id === d.id)}
                          onChange={refresh}
                        />
                      </li>
                    );
                          })}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          ))}

          <TabsContent value="laporan" className="mt-3 space-ms-3">
            <PaymentsReport
              debts={debts}
              payments={payments}
              inPeriod={inPeriod}
              onSendWA={() => void sendFullReportWA()}
              onRemovePayment={async (id: string) => {
                if (
                  !(await confirm({
                    title: "Hapus pembayaran?",
                    confirmText: "Hapus",
                    destructive: true,
                  }))
                )
                  return;
                const { error } = await supabase
                  .from("debt_payments")
                  .delete()
                  .eq("id", id);
                if (error) notifyError(error);
                else {
                  toast.success("Pembayaran dihapus");
                  void refresh();
                }
              }}
            />
          </TabsContent>
        </Tabs>
      </main>

      <AddDebtDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        defaultKind={activeKind}
        prefill={addPrefill}
        uid={uid}
        suppliers={suppliers}
        customers={customers}
        onCreated={refresh}
      />

      <PaymentDialog
        debt={payFor}
        uid={uid}
        sisa={
          payFor
            ? Number(payFor.amount) - (paidByDebt.get(payFor.id) ?? 0)
            : 0
        }
        onClose={() => setPayFor(null)}
        onSaved={refresh}
      />

      <ReminderDialog
        debt={reminderFor}
        uid={uid}
        sisa={
          reminderFor
            ? Math.max(
                0,
                Number(reminderFor.amount) -
                  (paidByDebt.get(reminderFor.id) ?? 0),
              )
            : 0
        }
        onClose={() => setReminderFor(null)}
        onSend={async (extra) => {
          const d = reminderFor;
          if (!d) return;
          await sendReminderWA(d, extra);
          if (extra) await refresh();
          setReminderFor(null);
        }}
      />

      <EditDebtDialog
        debt={editFor}
        minAmount={
          editFor ? paidByDebt.get(editFor.id) ?? 0 : 0
        }
        onClose={() => setEditFor(null)}
        onLocalUpdate={(patch) =>
          setDebts((prev) => prev.map((x) => (x.id === patch.id ? { ...x, ...patch } : x)))
        }
        onSaved={refresh}
      />
    </div>
  );
}

function PaymentHistory({
  debtId,
  payments,
  onChange,
}: {
  debtId: string;
  payments: Payment[];
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (payments.length === 0) return null;
  return (
    <div className="mt-2 border-t pt-2 text-ms-xs">
      <button
        type="button"
        className="text-muted-foreground hover:underline"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Sembunyikan" : `Lihat ${payments.length} pembayaran`}
      </button>
      {open && (
        <ul className="mt-1 space-y-1">
          {payments
            .slice()
            .sort((a, b) => (a.paid_at < b.paid_at ? 1 : -1))
            .map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-ms-2"
              >
                <span>
                  {new Date(p.paid_at).toLocaleDateString("id-ID")}
                  {p.note ? ` · ${p.note}` : ""}
                </span>
                <span className="flex items-center gap-ms-2">
                  <span className="font-medium text-success">
                    {rupiah(Number(p.amount))}
                  </span>
                  <button
                    type="button"
                    aria-label="Hapus pembayaran"
                    className="text-destructive hover:underline"
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: "Hapus pembayaran?",
                          confirmText: "Hapus",
                          destructive: true,
                        }))
                      )
                        return;
                      const { error } = await supabase
                        .from("debt_payments")
                        .delete()
                        .eq("id", p.id);
                      if (error) notifyError(error);
                      else {
                        toast.success("Pembayaran dihapus");
                        onChange();
                      }
                    }}
                  >
                    ✕
                  </button>
                </span>
              </li>
            ))}
        </ul>
      )}
      <span className="sr-only">debt {debtId}</span>
    </div>
  );
}

function PaymentsReport({
  debts,
  payments,
  inPeriod,
  onSendWA,
  onRemovePayment,
}: {
  debts: Debt[];
  payments: Payment[];
  inPeriod: (iso: string) => boolean;
  onSendWA: () => void;
  onRemovePayment: (id: string) => void | Promise<void>;
}) {
  const debtById = useMemo(
    () => new Map(debts.map((d) => [d.id, d])),
    [debts],
  );

  const filtered = useMemo(() => {
    return payments
      .filter((p) => inPeriod(p.paid_at))
      .sort((a, b) => (a.paid_at < b.paid_at ? 1 : -1));
  }, [payments, inPeriod]);

  const totals = useMemo(() => {
    let masuk = 0;
    let keluar = 0;
    for (const p of filtered) {
      const d = debtById.get(p.debt_id);
      if (!d) continue;
      if (d.kind === "hutang") keluar += Number(p.amount);
      else masuk += Number(p.amount);
    }
    return { masuk, keluar, net: masuk - keluar };
  }, [filtered, debtById]);

  const grouped = useMemo(() => {
    const map = new Map<string, Payment[]>();
    for (const p of filtered) {
      const day = p.paid_at.slice(0, 10);
      const cur = map.get(day);
      if (cur) cur.push(p);
      else map.set(day, [p]);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <div className="space-ms-3">
      <div className="rounded-lg border bg-card p-ms-3">
        <div className="flex flex-wrap items-center gap-ms-2">
          <div className="flex-1">
            <div className="text-ms-sm font-semibold">Riwayat pembayaran</div>
            <div className="text-ms-2xs text-muted-foreground">
              {filtered.length} pembayaran sesuai periode
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="bg-[#25D366]/15 text-[#1ea952] hover:bg-[#25D366]/25"
            onClick={onSendWA}
            title="Kirim laporan via MCM"
          >
            Kirim laporan MCM
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-ms-2 text-center text-ms-xs">
          <div>
            <div className="text-muted-foreground">Uang masuk</div>
            <div className="font-semibold text-success">
              {rupiah(totals.masuk)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Uang keluar</div>
            <div className="font-semibold text-red-600">
              {rupiah(totals.keluar)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Arus bersih</div>
            <div
              className={
                "font-semibold " +
                (totals.net >= 0 ? "text-success" : "text-red-600")
              }
            >
              {(totals.net >= 0 ? "+" : "−") + rupiah(Math.abs(totals.net))}
            </div>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-ms-sm text-muted-foreground">
          Belum ada pembayaran pada periode ini.
        </div>
      ) : (
        <div className="space-ms-3">
          {grouped.map(([day, list]) => (
            <section key={day} className="rounded-lg border bg-card">
              <header className="border-b px-ms-3 py-ms-2 text-ms-xs font-medium text-muted-foreground">
                {new Date(day + "T00:00:00").toLocaleDateString("id-ID", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </header>
              <ul className="divide-y">
                {list.map((p) => {
                  const d = debtById.get(p.debt_id);
                  const isIn = d?.kind === "piutang";
                  return (
                    <li
                      key={p.id}
                      className="flex items-start gap-ms-2 px-ms-3 py-ms-2 text-ms-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                          {d?.party_name ?? "—"}
                        </div>
                        <div className="text-ms-2xs text-muted-foreground">
                          {d
                            ? d.kind === "hutang"
                              ? "Bayar hutang"
                              : "Terima pembayaran piutang"
                            : "Catatan dihapus"}
                          {p.note ? ` · ${p.note}` : ""}
                        </div>
                      </div>
                      <div className="text-right">
                        <div
                          className={
                            "font-semibold " +
                            (isIn ? "text-success" : "text-red-600")
                          }
                        >
                          {(isIn ? "+" : "−") + rupiah(Number(p.amount))}
                        </div>
                        <button
                          type="button"
                          className="text-ms-2xs text-destructive hover:underline"
                          onClick={() => void onRemovePayment(p.id)}
                        >
                          Hapus
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Dropdown kontak dengan pencarian cepat. Lebih ringan dari cmdk dan
 * lebih ramah mobile: input tetap terlihat, tap target besar, hasil
 * difilter secara lokal tanpa request tambahan ke backend.
 */

/** Riwayat kontak terakhir dipilih (per user + per jenis), max 5 id. */
const RECENT_LIMIT = 5;
function recentKey(uid: string | null, kind: Kind) {
  return scopedKey("mcm:hutangPiutang:recentParty", uid, kind);
}
function readRecentParties(uid: string | null, kind: Kind): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(recentKey(uid, kind));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string").slice(0, RECENT_LIMIT)
      : [];
  } catch {
    return [];
  }
}
function pushRecentParty(uid: string | null, kind: Kind, id: string): string[] {
  const next = [id, ...readRecentParties(uid, kind).filter((v) => v !== id)].slice(
    0,
    RECENT_LIMIT,
  );
  try {
    window.localStorage.setItem(recentKey(uid, kind), JSON.stringify(next));
  } catch {
    /* private mode — abaikan */
  }
  return next;
}

function SearchablePartySelect({
  options,
  value,
  onChange,
  onOpenChange,
  placeholder,
  kind,
  recentIds = [],
  uid,
  onCreate,
}: {
  options: Party[];
  value: string;
  onChange: (id: string) => void;
  onOpenChange?: (open: boolean) => void;
  placeholder?: string;
  kind: Kind;
  recentIds?: string[];
  uid: string | null;
  onCreate?: (party: Party) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newContact, setNewContact] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const createNameRef = useRef<HTMLInputElement>(null);

  const { recent, rest } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = q
      ? options.filter(
          (o) =>
            o.name.toLowerCase().includes(q) ||
            (o.contact ?? "").toLowerCase().includes(q),
        )
      : options;
    const rank = new Map(recentIds.map((id, i) => [id, i]));
    const recentList = match
      .filter((o) => rank.has(o.id))
      .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    return {
      recent: recentList,
      rest: match.filter((o) => !rank.has(o.id)),
    };
  }, [options, query, recentIds]);

  const selected = options.find((o) => o.id === value);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCreating(false);
      setNewName("");
      setNewContact("");
      // Fokus input setelah popover ter-render agar keyboard mobile langsung muncul.
      const t = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(t);
    }
  }, [open]);

  // Saat masuk mode buat kontak, fokus ke input nama dan isi dengan query saat ini.
  useEffect(() => {
    if (creating) {
      setNewName(query.trim());
      const t = requestAnimationFrame(() => createNameRef.current?.focus());
      return () => cancelAnimationFrame(t);
    }
  }, [creating, query]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  const startCreate = () => {
    if (!uid) {
      toast.error("Sesi belum siap, coba lagi sebentar.");
      return;
    }
    setCreating(true);
  };

  const saveContact = async () => {
    if (!uid) return;
    const name = newName.trim();
    const contact = newContact.trim() || null;
    if (!name) {
      toast.error("Nama kontak wajib diisi.");
      return;
    }
    setBusy(true);
    const table = kind === "hutang" ? "suppliers" : "customers";
    const { data, error } = await supabase
      .from(table)
      .insert({ user_id: uid, name, contact })
      .select("id,name,contact")
      .single();
    setBusy(false);
    if (error || !data) {
      notifyError(error ?? new Error("Gagal menyimpan kontak"));
      return;
    }
    const party: Party = {
      id: data.id,
      name: data.name,
      contact: data.contact,
    };
    onCreate?.(party);
    onChange(party.id);
    setOpen(false);
    onOpenChange?.(false);
    toast.success(`${kind === "hutang" ? "Supplier" : "Customer"} baru ditambahkan`);
  };

  const empty = recent.length + rest.length === 0;
  const totalFound = recent.length + rest.length;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="truncate">
            {selected?.name ?? placeholder ?? "Pilih…"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        {!creating ? (
          <>
            <div className="flex items-center border-b px-3">
              <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Cari ${kind === "hutang" ? "supplier" : "customer"}…`}
                className="h-10 flex-1 rounded-none border-0 bg-transparent px-0 py-0 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              {query.trim().length > 0 && (
                <button
                  type="button"
                  aria-label="Hapus kata kunci"
                  onClick={() => {
                    setQuery("");
                    requestAnimationFrame(() => inputRef.current?.focus());
                  }}
                  className="ml-2 grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {!empty && (
              <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-1.5 text-ms-2xs text-muted-foreground">
                <span>
                  {totalFound} kontak ditemukan
                  {recent.length > 0 && rest.length > 0 && (
                    <span className="ml-1 text-muted-foreground/70">
                      ({recent.length} terakhir, {rest.length} lainnya)
                    </span>
                  )}
                </span>
                {query.trim() && (
                  <span className="truncate max-w-[55%] text-right">
                    cocok “{query.trim()}”
                  </span>
                )}
              </div>
            )}
            <div className="max-h-[260px] overflow-y-auto p-1">
              {empty ? (
                <div className="px-3 py-5 text-center">
                  <div className="mx-auto mb-2 grid h-9 w-9 place-items-center rounded-full bg-muted">
                    <Search className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="text-ms-sm font-medium text-foreground">
                    Tidak ada kontak yang cocok
                  </div>
                  <div className="mt-1 text-ms-2xs text-muted-foreground">
                    {query.trim() ? (
                      <>
                        Pencarian untuk "<span className="font-medium text-foreground">{query.trim()}</span>" tidak menemukan nama atau nomor.
                      </>
                    ) : (
                      "Belum ada data " + (kind === "hutang" ? "supplier" : "customer") + " tersimpan."
                    )}
                  </div>
                  {query.trim() && (
                    <div className="mt-3 space-y-1 text-ms-2xs text-muted-foreground">
                      <div className="font-medium text-foreground">Saran pencarian:</div>
                      <ul className="list-disc space-y-0.5 pl-4 text-left">
                        <li>Coba singkatan atau nama panggilan</li>
                        <li>Gunakan nomor HP awalan 08 tanpa spasi/titik</li>
                        <li>Periksa ejaan atau huruf kecil/besar</li>
                      </ul>
                    </div>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    className="mt-4 w-full"
                    onClick={startCreate}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Tambah kontak
                  </Button>
                </div>
              ) : (
                <>
                  {recent.length > 0 && (
                    <div className="px-2 pb-1 pt-1.5 text-ms-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Terakhir dipakai
                    </div>
                  )}
                  {recent.map((o) => (
                    <PartyOptionRow
                      key={o.id}
                      option={o}
                      selected={value === o.id}
                      query={query}
                      onPick={() => {
                        onChange(o.id);
                        setOpen(false);
                        onOpenChange?.(false);
                      }}
                    />
                  ))}
                  {recent.length > 0 && rest.length > 0 && (
                    <div className="my-1 border-t" />
                  )}
                  {rest.map((o) => (
                    <PartyOptionRow
                      key={o.id}
                      option={o}
                      selected={value === o.id}
                      query={query}
                      onPick={() => {
                        onChange(o.id);
                        setOpen(false);
                        onOpenChange?.(false);
                      }}
                    />
                  ))}
                </>
              )}
            </div>
          </>
        ) : (
          <div className="p-3">
            <div className="mb-2 text-ms-sm font-semibold text-foreground">
              Tambah {kind === "hutang" ? "supplier" : "customer"} baru
            </div>
            <div className="space-y-2">
              <div className="space-y-1">
                <Label className="text-ms-2xs">Nama</Label>
                <Input
                  ref={createNameRef}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="cth: Pak Andi"
                  className="h-9 text-ms-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-ms-2xs">Kontak (opsional)</Label>
                <Input
                  value={newContact}
                  onChange={(e) => setNewContact(e.target.value)}
                  placeholder="Nomor WA / email"
                  className="h-9 text-ms-sm"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setCreating(false)}
                  disabled={busy}
                >
                  Batal
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="flex-1"
                  onClick={() => void saveContact()}
                  disabled={busy || !newName.trim()}
                >
                  {busy ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Simpan
                </Button>
              </div>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function PartyOptionRow({
  option,
  selected,
  query,
  onPick,
}: {
  option: Party;
  selected: boolean;
  query: string;
  onPick: () => void;
}) {
  return (
    <div className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-ms-sm transition-colors hover:bg-accent hover:text-accent-foreground">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">
          <HighlightText text={option.name} query={query} />
        </div>
        {option.contact && (
          <div className="truncate text-ms-2xs text-muted-foreground">
            <HighlightText text={option.contact} query={query} />
          </div>
        )}
      </div>
      {selected ? (
        <span className="flex items-center gap-1 text-ms-2xs font-semibold text-success">
          <Check className="h-3.5 w-3.5" />
          Dipilih
        </span>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={(e) => {
            e.stopPropagation();
            onPick();
          }}
          className="h-7 text-ms-2xs"
        >
          Pilih
        </Button>
      )}
    </div>
  );
}

function HighlightText({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const lower = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  while (remaining.length > 0) {
    const idx = remaining.toLowerCase().indexOf(lower);
    if (idx === -1) {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }
    if (idx > 0) {
      parts.push(<span key={key++}>{remaining.slice(0, idx)}</span>);
    }
    const match = remaining.slice(idx, idx + q.length);
    parts.push(
      <mark
        key={key++}
        className="rounded-sm bg-primary/20 px-0.5 font-semibold text-primary"
      >
        {match}
      </mark>,
    );
    remaining = remaining.slice(idx + q.length);
  }
  return <>{parts}</>;
}

function AddDebtDialog({
  open,
  onOpenChange,
  defaultKind,
  prefill,
  uid,
  suppliers,
  customers,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultKind: Kind;
  prefill?: {
    kind: Kind;
    name: string;
    supplierId?: string | null;
    customerId?: string | null;
  } | null;
  uid: string | null;
  suppliers: Party[];
  customers: Party[];
  onCreated: () => void;
}) {
  const [kind, setKind] = useState<Kind>(defaultKind);
  const [partyMode, setPartyMode] = useState<"manual" | "link">("manual");
  const [partyId, setPartyId] = useState<string>("");
  const [partyName, setPartyName] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  // Di Android WebView, "touch release" setelah memilih item Select bisa
  // tembus ke overlay Dialog sehingga dialog ikut tertutup dan user
  // terlempar balik ke halaman Hutang & Piutang. Kunci penutupan dialog
  // selama dropdown terbuka dan sesaat setelahnya.
  const selectGuardRef = useRef(0);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [createdParties, setCreatedParties] = useState<Party[]>([]);
  const handleOpenChange = (v: boolean) => {
    if (!v && Date.now() < selectGuardRef.current) return;
    onOpenChange(v);
  };

  useEffect(() => {
    if (open) {
      const k = prefill?.kind ?? defaultKind;
      setKind(k);
      setRecentIds(readRecentParties(uid, k));
      const linkId =
        k === "hutang" ? prefill?.supplierId : prefill?.customerId;
      if (linkId) {
        setPartyMode("link");
        setPartyId(linkId);
        setPartyName("");
      } else if (prefill?.name) {
        setPartyMode("manual");
        setPartyId("");
        setPartyName(prefill.name);
      } else {
        setPartyMode("manual");
        setPartyId("");
        setPartyName("");
      }
      setAmount("");
      setDue("");
      setNote("");
    }
  }, [open, defaultKind, prefill, uid]);

  // Jenis (hutang/piutang) bisa diganti setelah dialog terbuka.
  useEffect(() => {
    if (open) setRecentIds(readRecentParties(uid, kind));
  }, [open, kind, uid]);

  const partyOptions = useMemo(() => {
    const base = kind === "hutang" ? suppliers : customers;
    const map = new Map<string, Party>();
    for (const p of base) map.set(p.id, p);
    for (const p of createdParties) map.set(p.id, p);
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [kind, suppliers, customers, createdParties]);

  const submit = async () => {
    if (!uid) return;
    let nm = partyName.trim();
    let supplier_id: string | null = null;
    let customer_id: string | null = null;
    if (partyMode === "link" && partyId) {
      const sel = partyOptions.find((p) => p.id === partyId);
      if (!sel) return toast.error("Pilih kontak");
      nm = sel.name;
      if (kind === "hutang") supplier_id = sel.id;
      else customer_id = sel.id;
    }
    if (!nm) return toast.error("Nama pihak wajib diisi");
    const amt = Number(amount.replace(/[^\d.,]/g, "").replace(",", "."));
    if (!amt || amt <= 0) return toast.error("Jumlah tidak valid");

    setSaving(true);
    const { error } = await supabase.from("debts").insert({
      user_id: uid,
      kind,
      party_name: nm,
      supplier_id,
      customer_id,
      amount: amt,
      due_date: due || null,
      note: note.trim() || null,
      source: assertDebtSource("manual"),
    });
    setSaving(false);
    if (error) {
      notifyError(error);
      return;
    }
    toast.success("Tersimpan");
    onCreated();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => {
          if (Date.now() < selectGuardRef.current) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (Date.now() < selectGuardRef.current) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Tambah catatan</DialogTitle>
          <DialogDescription>
            Catat hutang atau piutang baru secara manual.
          </DialogDescription>
        </DialogHeader>
        <div className="space-ms-3">
          <div className="grid grid-cols-2 gap-ms-2">
            <Button
              type="button"
              variant={kind === "hutang" ? "default" : "outline"}
              onClick={() => setKind("hutang")}
              size="sm"
            >
              Hutang saya
            </Button>
            <Button
              type="button"
              variant={kind === "piutang" ? "default" : "outline"}
              onClick={() => setKind("piutang")}
              size="sm"
            >
              Piutang saya
            </Button>
          </div>

          <div className="space-y-1">
            <Label className="text-ms-xs">
              Pihak {kind === "hutang" ? "(supplier/orang)" : "(customer/orang)"}
            </Label>
            <div className="flex gap-ms-2">
              <Button
                type="button"
                size="sm"
                variant={partyMode === "manual" ? "default" : "outline"}
                onClick={() => setPartyMode("manual")}
              >
                Ketik nama
              </Button>
              <Button
                type="button"
                size="sm"
                variant={partyMode === "link" ? "default" : "outline"}
                onClick={() => setPartyMode("link")}
                disabled={partyOptions.length === 0}
              >
                Pilih kontak
              </Button>
            </div>
            {partyMode === "manual" ? (
              <Input
                value={partyName}
                onChange={(e) => setPartyName(e.target.value)}
                placeholder="cth: Pak Andi"
              />
            ) : (
              <SearchablePartySelect
                options={partyOptions}
                value={partyId}
                kind={kind}
                placeholder="Pilih…"
                recentIds={recentIds}
                uid={uid}
                onChange={(v) => {
                  selectGuardRef.current = Date.now() + 600;
                  setPartyId(v);
                  setRecentIds(pushRecentParty(uid, kind, v));
                }}
                onOpenChange={(o) => {
                  selectGuardRef.current = o
                    ? Number.MAX_SAFE_INTEGER
                    : Date.now() + 600;
                }}
                onCreate={(party) => {
                  setCreatedParties((prev) => [...prev, party]);
                  setRecentIds(pushRecentParty(uid, kind, party.id));
                }}
              />
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-ms-xs">Jumlah (Rp)</Label>
            <NumericTextField
              value={amount}
              onValueChange={setAmount}
              decimal={false}
              placeholder="0"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-ms-xs">Jatuh tempo (opsional)</Label>
            <Input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-ms-xs">Catatan (opsional)</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="cth: pinjam modal"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({
  debt,
  uid,
  sisa,
  onClose,
  onSaved,
}: {
  debt: Debt | null;
  uid: string | null;
  sisa: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (debt) {
      setAmount(String(Math.max(0, sisa)));
      setPaidAt(new Date().toISOString().slice(0, 10));
      setNote("");
    }
  }, [debt, sisa]);

  const submit = async () => {
    if (!uid || !debt) return;
    const amt = Number(amount.replace(/[^\d.,]/g, "").replace(",", "."));
    if (!amt || amt <= 0) return toast.error("Jumlah tidak valid");
    setSaving(true);
    const { error } = await supabase.from("debt_payments").insert({
      user_id: uid,
      debt_id: debt.id,
      amount: amt,
      paid_at: paidAt,
      note: note.trim() || null,
    });
    setSaving(false);
    if (error) {
      notifyError(error);
      return;
    }
    toast.success("Pembayaran dicatat");
    onSaved();
    onClose();
  };

  return (
    <Dialog open={!!debt} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Catat pembayaran</DialogTitle>
          <DialogDescription>
            {debt && (
              <>
                {debt.party_name} · sisa {rupiah(Math.max(0, sisa))}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-ms-3">
          <div className="space-y-1">
            <Label className="text-ms-xs">Jumlah (Rp)</Label>
            <NumericTextField
              value={amount}
              onValueChange={setAmount}
              decimal={false}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-ms-xs">Tanggal</Label>
            <Input
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-ms-xs">Catatan (opsional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Dialog "Catat Pembayaran → Kirim WA". Sebelum pesan pengingat dikirim,
 * user dapat opsional mencatat pembayaran baru (jumlah, tanggal, catatan).
 * Jika jumlah bayar > 0, pembayaran tersimpan lebih dulu ke `debt_payments`
 * lalu pesan WA di-generate dengan status & sisa yang sudah diperbarui.
 * Jika jumlah dikosongkan, dialog hanya mengirim pengingat tanpa mencatat
 * pembayaran baru — sehingga tombol ini tetap bisa dipakai untuk "tagih saja".
 */
function ReminderDialog({
  debt,
  uid,
  sisa,
  onClose,
  onSend,
}: {
  debt: Debt | null;
  uid: string | null;
  sisa: number;
  onClose: () => void;
  onSend: (
    extra: { amount: number; paidAt: string; note: string } | null,
  ) => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (debt) {
      setAmount("");
      setPaidAt(new Date().toISOString().slice(0, 10));
      setNote("");
    }
  }, [debt]);

  const parseAmt = () =>
    Number(amount.replace(/[^\d.,]/g, "").replace(",", "."));

  const doSend = async (recordPayment: boolean) => {
    if (!debt) return;
    let extra: { amount: number; paidAt: string; note: string } | null = null;
    if (recordPayment) {
      const amt = parseAmt();
      if (!amt || amt <= 0) {
        toast.error("Isi jumlah bayar terlebih dahulu.");
        return;
      }
      if (!uid) {
        toast.error("Sesi belum siap.");
        return;
      }
      setBusy(true);
      const { error } = await supabase.from("debt_payments").insert({
        user_id: uid,
        debt_id: debt.id,
        amount: amt,
        paid_at: paidAt,
        note: note.trim() || null,
      });
      if (error) {
        setBusy(false);
        notifyError(error);
        return;
      }
      extra = { amount: amt, paidAt, note };
      toast.success("Pembayaran dicatat, membuka WA…");
    } else {
      setBusy(true);
    }
    try {
      await onSend(extra);
    } finally {
      setBusy(false);
    }
  };

  const amt = parseAmt();
  const hasAmt = Number.isFinite(amt) && amt > 0;

  return (
    <Dialog open={!!debt} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Catat pembayaran & kirim WA</DialogTitle>
          <DialogDescription>
            {debt && (
              <>
                {debt.party_name} · sisa {rupiah(Math.max(0, sisa))}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-ms-3">
          <div className="space-y-1">
            <Label className="text-ms-xs">Jumlah bayar (Rp) — opsional</Label>
            <NumericTextField
              value={amount}
              onValueChange={setAmount}
              decimal={false}
              placeholder="Kosongkan bila hanya menagih"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
            {hasAmt && amt > sisa && (
              <p className="text-ms-2xs text-warning">
                Melebihi sisa ({rupiah(sisa)}). Tetap dapat disimpan.
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-ms-xs">Tanggal</Label>
            <Input
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-ms-xs">Catatan (opsional)</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="cth: transfer BCA"
            />
          </div>
        </div>
        <DialogFooter className="flex-col gap-ms-2 sm:flex-row">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={busy}
            className="w-full sm:w-auto"
          >
            Batal
          </Button>
          <Button
            variant="secondary"
            onClick={() => void doSend(false)}
            disabled={busy}
            className="w-full sm:w-auto"
          >
            Kirim tanpa mencatat
          </Button>
          <Button
            onClick={() => void doSend(true)}
            disabled={busy || !hasAmt}
            className="w-full bg-[#25D366] text-white hover:bg-[#1ea952] sm:w-auto"
          >
            {busy ? "Memproses…" : "Simpan & Kirim WA"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDebtDialog({
  debt,
  minAmount,
  onClose,
  onLocalUpdate,
  onSaved,
}: {
  debt: Debt | null;
  minAmount: number;
  onClose: () => void;
  onLocalUpdate: (patch: Partial<Debt> & { id: string }) => void;
  onSaved: () => void;
}) {
  const [partyName, setPartyName] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (debt) {
      setPartyName(debt.party_name);
      setAmount(String(debt.amount));
      setDue(debt.due_date ?? "");
      setNote(debt.note ?? "");
    }
  }, [debt]);

  const submit = async () => {
    if (!debt) return;
    const nm = partyName.trim();
    if (!nm) {
      toast.error("Nama pihak wajib diisi", {
        description: "Isi nama pihak sebelum menyimpan perubahan.",
      });
      return;
    }
    const amt = Number(amount.replace(/[^\d.,]/g, "").replace(",", "."));
    if (!amt || amt <= 0) {
      toast.error("Jumlah tidak valid", {
        description: "Masukkan angka lebih besar dari 0.",
      });
      return;
    }
    if (amt < minAmount) {
      toast.error("Jumlah lebih kecil dari total terbayar", {
        description: `Minimal ${rupiah(minAmount)}. Hapus sebagian pembayaran dulu jika ingin menurunkan nominal.`,
      });
      return;
    }
    setSaving(true);
    const toastId = toast.loading("Menyimpan perubahan…", {
      description: `${debt.kind === "hutang" ? "Hutang ke" : "Piutang dari"} ${nm}`,
    });
    const { data, error } = await supabase
      .from("debts")
      .update({
        party_name: nm,
        amount: amt,
        due_date: due || null,
        note: note.trim() || null,
      })
      .eq("id", debt.id)
      .select("id")
      .maybeSingle();
    setSaving(false);
    if (error) {
      // Sertakan kode/detail dari server agar pengguna bisa melaporkan masalah.
      const code = (error as { code?: string }).code;
      const details = (error as { details?: string }).details;
      const serverInfo = [code ? `kode ${code}` : null, details]
        .filter(Boolean)
        .join(" · ");
      toast.error("Gagal menyimpan perubahan", {
        id: toastId,
        description: serverInfo
          ? `${friendlyError(error)} (${serverInfo})`
          : friendlyError(error),
        duration: 8000,
      });
      return;
    }
    if (!data) {
      toast.error("Tidak ada perubahan yang tersimpan", {
        id: toastId,
        description:
          "Catatan mungkin sudah dihapus atau Anda tidak punya akses untuk mengubahnya.",
        duration: 8000,
      });
      return;
    }
    toast.success("Perubahan tersimpan", {
      id: toastId,
      description: `${debt.kind === "hutang" ? "Hutang ke" : "Piutang dari"} ${nm} · ${rupiah(amt)}`,
    });
    // Patch list segera agar baris menampilkan nilai baru tanpa menunggu refetch.
    onLocalUpdate({
      id: debt.id,
      party_name: nm,
      amount: amt,
      due_date: due || null,
      note: note.trim() || null,
    });
    onClose();
    // Sinkronisasi penuh di latar belakang (mis. nilai turunan dari server).
    onSaved();
  };

  return (
    <Dialog open={!!debt} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit catatan</DialogTitle>
          <DialogDescription>
            {debt
              ? `${debt.kind === "hutang" ? "Hutang ke" : "Piutang dari"} ${debt.party_name}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-ms-3">
          <div className="space-y-1">
            <Label className="text-ms-xs">Nama pihak</Label>
            <Input
              value={partyName}
              onChange={(e) => setPartyName(e.target.value)}
              placeholder="cth: Pak Andi"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-ms-xs">Jumlah (Rp)</Label>
            <NumericTextField
              value={amount}
              onValueChange={setAmount}
              decimal={false}
              placeholder="0"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
            {minAmount > 0 && (
              <p className="text-ms-2xs text-muted-foreground">
                Minimal {rupiah(minAmount)} (sudah terbayar).
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-ms-xs">Jatuh tempo (opsional)</Label>
            <Input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-ms-xs">Catatan (opsional)</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="cth: pinjam modal"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}