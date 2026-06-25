import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/friendly-error";
import { confirm } from "@/lib/confirm";
import { shareToWhatsApp, notifyShareResult } from "@/lib/share-wa";
import { useEntitlement } from "@/hooks/useEntitlement";
import { ProPaywall } from "@/components/ProPaywall";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

function HutangPiutangPage() {
  const ent = useEntitlement();
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
  const [editFor, setEditFor] = useState<Debt | null>(null);
  const [period, setPeriod] = useState<"all" | "week" | "month" | "custom">("all");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [draftFrom, setDraftFrom] = useState<string>("");
  const [draftTo, setDraftTo] = useState<string>("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null));
  }, []);

  if (!ent.loading && !ent.isPro) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <ProPaywall
          feature="Hutang & Piutang"
          description="Modul pelacakan hutang dan piutang, beserta riwayat pembayaran cicilan, hanya untuk pelanggan Pro."
        />
      </div>
    );
  }

  const refresh = async () => {
    setLoading(true);
    const [d, p, s, c] = await Promise.all([
      supabase
        .from("debts")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase.from("debt_payments").select("*"),
      supabase.from("suppliers").select("id,name,contact").order("name"),
      supabase.from("customers").select("id,name,contact").order("name"),
    ]);
    if (d.error) toast.error(friendlyError(d.error));
    else setDebts((d.data ?? []) as Debt[]);
    if (p.data) setPayments(p.data as Payment[]);
    if (s.data) setSuppliers(s.data as Party[]);
    if (c.data) setCustomers(c.data as Party[]);
    setLoading(false);
  };

  useEffect(() => {
    if (uid) void refresh();
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
    if (error) toast.error(friendlyError(error));
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

  const sendReminderWA = async (d: Debt) => {
    const paid = paidByDebt.get(d.id) ?? 0;
    const sisa = Math.max(0, Number(d.amount) - paid);
    const due = d.due_date
      ? `jatuh tempo ${new Date(d.due_date).toLocaleDateString("id-ID")}`
      : "tanpa jatuh tempo";
    const greet = `Halo ${d.party_name},`;
    const body = d.kind === "hutang"
      ? `Ini pengingat hutang saya kepada Anda sebesar *${rupiah(Number(d.amount))}* (${due}). Sudah terbayar ${rupiah(paid)}, sisa *${rupiah(sisa)}*. Mohon konfirmasi cara & waktu pelunasannya. Terima kasih.`
      : `Ini pengingat tagihan dari saya sebesar *${rupiah(Number(d.amount))}* (${due}). Sudah terbayar ${rupiah(paid)}, sisa *${rupiah(sisa)}*. Mohon segera diselesaikan ya, terima kasih.`;
    const text = `${greet}\n\n${body}${d.note ? `\n\nCatatan: ${d.note}` : ""}`;
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
    const text = [
      `*Laporan Hutang & Piutang*`,
      `Periode: ${periodLabel}`,
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
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-3 py-3 sm:px-6">
          <Link
            to="/"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-sm hover:bg-accent"
            aria-label="Kembali"
          >
            ←
          </Link>
          <h1 className="flex-1 truncate text-base font-semibold">
            Hutang & Piutang
          </h1>
          <Button
            size="sm"
            onClick={() => {
              setAddPrefill(null);
              setAddOpen(true);
            }}
          >
            {activeKind === "hutang" ? "+ Tambah hutang" : "+ Tambah piutang"}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-3 py-4 sm:px-6">
        <div className="mb-3 rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Periode:</span>
            <div className="flex flex-wrap gap-1">
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
                  className={
                    "rounded-md border px-2 py-1 text-xs " +
                    (period === opt.v
                      ? "bg-primary text-primary-foreground border-primary"
                      : "hover:bg-accent")
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
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="date"
                  value={draftFrom}
                  onChange={(e) => setDraftFrom(e.target.value)}
                  className={
                    "h-8 w-auto text-xs" +
                    (invalidRange ? " border-destructive" : "")
                  }
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  type="date"
                  value={draftTo}
                  onChange={(e) => setDraftTo(e.target.value)}
                  className={
                    "h-8 w-auto text-xs" +
                    (invalidRange ? " border-destructive" : "")
                  }
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-8 px-2 text-xs"
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
                  className="h-8 px-2 text-xs"
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
                  <span className="w-full text-xs text-destructive">
                    Tanggal mulai tidak boleh lebih besar dari tanggal selesai.
                  </span>
                )}
              </div>
                );
              })()
            )}
          </div>
        </div>

        <div className="mb-3 grid grid-cols-3 gap-2 rounded-lg border bg-card p-3 text-center text-xs">
          <div>
            <div className="text-muted-foreground">Sisa hutang</div>
            <div className="font-semibold text-red-600">
              {rupiah(overall.hutangSisa)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Sisa piutang</div>
            <div className="font-semibold text-emerald-600">
              {rupiah(overall.piutangSisa)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Selisih bersih</div>
            <div
              className={
                "font-semibold " +
                (overall.net >= 0 ? "text-emerald-600" : "text-red-600")
              }
            >
              {(overall.net >= 0 ? "+" : "−") +
                rupiah(Math.abs(overall.net)).replace("Rp ", "Rp ")}
            </div>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="hutang">Hutang saya</TabsTrigger>
            <TabsTrigger value="piutang">Piutang saya</TabsTrigger>
            <TabsTrigger value="laporan">Laporan</TabsTrigger>
          </TabsList>

          {(["hutang", "piutang"] as const).map((k) => (
            <TabsContent key={k} value={k} className="mt-3 space-y-3">
              <div className="grid grid-cols-3 gap-2 rounded-lg border bg-card p-3 text-center text-xs">
                <div>
                  <div className="text-muted-foreground">Total</div>
                  <div className="font-semibold">{rupiah(totals.total)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Terbayar</div>
                  <div className="font-semibold text-emerald-600">
                    {rupiah(totals.paid)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Sisa</div>
                  <div className="font-semibold text-amber-600">
                    {rupiah(totals.sisa)}
                  </div>
                </div>
              </div>

              {loading ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Memuat…
                </div>
              ) : filtered.length === 0 ? (
                <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
                  <p>Belum ada catatan {k}.</p>
                  <Button
                    size="sm"
                    className="mt-3"
                    onClick={() => {
                      setAddPrefill(null);
                      setAddOpen(true);
                    }}
                  >
                    {k === "hutang" ? "+ Tambah hutang" : "+ Tambah piutang"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
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
                        className="rounded-lg border bg-card"
                      >
                        <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold">
                              {group.name}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {group.items.length} catatan · sisa{" "}
                              <span className="font-medium text-amber-600">
                                {rupiah(gSisa)}
                              </span>{" "}
                              dari {rupiah(gTotal)}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
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
                            + Tambah {k}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="bg-[#25D366]/15 text-[#1ea952] hover:bg-[#25D366]/25"
                            onClick={() => void sendPartyReportWA(group)}
                            title="Kirim laporan via WhatsApp"
                          >
                            Kirim laporan WA
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
                        className="p-3 text-sm"
                      >
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-medium">
                                {d.party_name}
                              </span>
                              {d.source !== "manual" && (
                                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                                  {d.source === "purchase"
                                    ? "pembelian"
                                    : "penjualan"}
                                </span>
                              )}
                              {lunas ? (
                                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                                  Lunas
                                </span>
                              ) : overdue ? (
                                <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">
                                  Telat
                                </span>
                              ) : null}
                            </div>
                            {d.note && (
                              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                                {d.note}
                              </div>
                            )}
                            <div className="mt-1 text-xs text-muted-foreground">
                              {d.due_date
                                ? `Jatuh tempo ${new Date(d.due_date).toLocaleDateString("id-ID")}`
                                : "Tanpa jatuh tempo"}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold">
                              {rupiah(Number(d.amount))}
                            </div>
                            {paid > 0 && (
                              <div className="text-[11px] text-muted-foreground">
                                terbayar {rupiah(paid)}
                              </div>
                            )}
                            <div className="text-[11px] font-medium text-amber-600">
                              sisa {rupiah(Math.max(0, sisa))}
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 flex gap-2">
                          {!lunas && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setPayFor(d)}
                            >
                              + Bayar
                            </Button>
                          )}
                          {!lunas && (
                            <Button
                              size="sm"
                              variant="secondary"
                              className="bg-[#25D366]/15 text-[#1ea952] hover:bg-[#25D366]/25"
                              onClick={() => void sendReminderWA(d)}
                              title="Kirim pengingat via WhatsApp"
                            >
                              Tagih via WA
                            </Button>
                          )}
                          {d.source === "manual" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditFor(d)}
                              title="Edit catatan"
                            >
                              Edit
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
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

          <TabsContent value="laporan" className="mt-3 space-y-3">
            <PaymentsReport
              debts={debts}
              payments={payments}
              inPeriod={inPeriod}
              onSendWA={() => void sendFullReportWA()}
              onRemovePayment={async (id) => {
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
                if (error) toast.error(friendlyError(error));
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
    <div className="mt-2 border-t pt-2 text-xs">
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
                className="flex items-center justify-between gap-2"
              >
                <span>
                  {new Date(p.paid_at).toLocaleDateString("id-ID")}
                  {p.note ? ` · ${p.note}` : ""}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-medium text-emerald-600">
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
                      if (error) toast.error(friendlyError(error));
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

  useEffect(() => {
    if (open) {
      const k = prefill?.kind ?? defaultKind;
      setKind(k);
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
  }, [open, defaultKind, prefill]);

  const partyOptions = kind === "hutang" ? suppliers : customers;

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
      source: "manual",
    });
    setSaving(false);
    if (error) {
      toast.error(friendlyError(error));
      return;
    }
    toast.success("Tersimpan");
    onCreated();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tambah catatan</DialogTitle>
          <DialogDescription>
            Catat hutang atau piutang baru secara manual.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
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
            <Label className="text-xs">
              Pihak {kind === "hutang" ? "(supplier/orang)" : "(customer/orang)"}
            </Label>
            <div className="flex gap-2">
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
              <Select value={partyId} onValueChange={setPartyId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih…" />
                </SelectTrigger>
                <SelectContent>
                  {partyOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Jumlah (Rp)</Label>
            <Input
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Jatuh tempo (opsional)</Label>
            <Input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Catatan (opsional)</Label>
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
      toast.error(friendlyError(error));
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
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Jumlah (Rp)</Label>
            <Input
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tanggal</Label>
            <Input
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Catatan (opsional)</Label>
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
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Nama pihak</Label>
            <Input
              value={partyName}
              onChange={(e) => setPartyName(e.target.value)}
              placeholder="cth: Pak Andi"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Jumlah (Rp)</Label>
            <Input
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
            />
            {minAmount > 0 && (
              <p className="text-[11px] text-muted-foreground">
                Minimal {rupiah(minAmount)} (sudah terbayar).
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Jatuh tempo (opsional)</Label>
            <Input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Catatan (opsional)</Label>
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