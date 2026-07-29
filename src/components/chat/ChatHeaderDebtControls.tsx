import { useEffect, useMemo, useState } from "react";
import { NumericTextField } from "@/components/NumericDraftInput";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, Loader2, ArrowRight, Equal, Pencil, X, Search, AlertTriangle, Send, FileText, FileSpreadsheet, ClipboardCopy, Bookmark, Trash2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { rupiah } from "@/lib/stock-format";
import { assertDebtSource } from "@/lib/debt-source";
import { DebtChip, debtChipTone } from "@/components/chat/DebtChip";
import { buildDebtReport, type DebtReportStyle } from "@/lib/debt-report";
import { exportDebtReport } from "@/lib/debt-report-export";
import {
  listReportTemplates,
  saveReportTemplate,
  deleteReportTemplate,
  renderTemplate,
  type DebtReportTemplate,
} from "@/lib/debt-report-templates";
import { sendMessage } from "@/lib/chat.functions";
import { emitDebtTx } from "@/lib/debt-tx-event";
import { planDebtPayment, type AllocPlan } from "@/lib/debt-allocation";
import {
  debtSyncStatus,
  normalizeParty,
  useDebtSyncMap,
  usePartyLinks,
  DEBT_SYNC_QUERY_KEY,
} from "@/lib/chat-debt-sync";

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
type PaymentRow = {
  id: string;
  debt_id: string;
  amount: number;
  paid_at: string | null;
  note: string | null;
  created_at: string;
};

type HistoryEntry = {
  id: string;
  at: string;
  kind: Kind;
  type: "tagihan" | "pembayaran";
  amount: number;
  note: string | null;
};

/** Lewat kontrol mana perubahan dibuat: ikon pensil (quick) atau tombol −/+. */
type AuditVia = "quick" | "button";

type AuditRow = {
  id: string;
  actor_name: string | null;
  party_name: string | null;
  kind: string;
  action: string;
  amount: number;
  balance_before: number | null;
  balance_after: number | null;
  detail: unknown;
  created_at: string;
};

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
  conversationId,
}: {
  myId: string;
  peerUserId: string | null;
  peerPhone: string | null;
  peerName: string;
  /** Bila diisi, laporan bisa dikirim sekali klik ke percakapan ini. */
  conversationId?: string;
}) {
  const qc = useQueryClient();
  // Tautan manual nama chat → nama pihak di buku hutang/piutang, supaya
  // header memakai kontak yang sama dengan chip di daftar chat.
  const { data: partyLinks } = usePartyLinks();
  // SSOT saldo: sama persis dengan chip di daftar chat & halaman
  // Hutang & Piutang (debts + penjualan/pembelian hutang − pembayaran).
  const { data: debtSyncMap } = useDebtSyncMap();
  const ssot = debtSyncStatus(peerName, debtSyncMap, partyLinks);
  const ssotEntry = ssot.state === "unlinked" ? null : ssot.entry;
  const linkedPartyKey = partyLinks?.get(normalizeParty(peerName)) ?? null;
  const queryKey = [
    "chat-debts",
    myId,
    peerUserId ?? "",
    peerPhone ?? "",
    linkedPartyKey ?? "",
    normalizeParty(peerName),
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
          // Cocokkan juga lewat nama: persis, atau lewat tautan manual
          // (mis. chat "PANGAT" ditautkan ke catatan "PWNGAT").
          const rowKey = normalizeParty(r.name);
          if (rowKey && (rowKey === normalizeParty(peerName) || rowKey === linkedPartyKey)) {
            return true;
          }
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
          .select("id, debt_id, amount, paid_at, note, created_at")
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

  // Chip selalu tampil agar konsisten di semua percakapan & lokasi kartu.
  // Angka yang ditampilkan WAJIB dari SSOT bila kontak dikenali, supaya
  // header tidak pernah beda dengan daftar chat / halaman hutang piutang.
  const linked = !!ssotEntry || (!!summary && summary.hasAny);
  const hutang = ssotEntry ? ssotEntry.hutang : (summary?.hutang ?? 0);
  const piutang = ssotEntry ? ssotEntry.piutang : (summary?.piutang ?? 0);
  const safeSummary = summary ?? {
    debts: [] as DebtRow[],
    paidByDebt: new Map<string, number>(),
    customerId: null,
    customerName: null,
    supplierId: null,
    supplierName: null,
  };
  const tone = debtChipTone(hutang, piutang, linked);
  const dominantValue = tone === "hutang" ? hutang : piutang;

  // Peringatan selisih: bandingkan angka SSOT (dipakai chip & daftar chat)
  // dengan angka hasil hitung lokal dari catatan manual (tabel debts).
  const mismatch = useMemo(() => {
    if (!ssotEntry || !summary) return null;
    const dh = Math.round(ssotEntry.hutang - summary.hutang);
    const dp = Math.round(ssotEntry.piutang - summary.piutang);
    if (Math.abs(dh) < 1 && Math.abs(dp) < 1) return null;
    return { dh, dp };
  }, [ssotEntry, summary]);

  // Riwayat perubahan: gabungan entri tagihan (debts) & pembayaran
  // (debt_payments) untuk peer ini, terbaru di atas.
  const history = useMemo<HistoryEntry[]>(() => {
    const d = debtsQ.data;
    if (!d) return [];
    const kindByDebt = new Map(d.debts.map((x) => [x.id, x.kind]));
    const items: HistoryEntry[] = [
      ...d.debts.map((x) => ({
        id: `d-${x.id}`,
        at: x.created_at,
        kind: x.kind,
        type: "tagihan" as const,
        amount: Number(x.amount),
        note: null,
      })),
      ...d.payments.map((p) => ({
        id: `p-${p.id}`,
        at: p.created_at ?? `${p.paid_at ?? ""}T00:00:00Z`,
        kind: (kindByDebt.get(p.debt_id) ?? "piutang") as Kind,
        type: "pembayaran" as const,
        amount: Number(p.amount),
        note: p.note,
      })),
    ];
    return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }, [debtsQ.data]);

  const [historyQuery, setHistoryQuery] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [sendingReport, setSendingReport] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewBody, setPreviewBody] = useState("");
  const [reportStyle, setReportStyle] = useState<DebtReportStyle>("detail");
  const [previewEdit, setPreviewEdit] = useState(false);
  const [previewEdited, setPreviewEdited] = useState(false);
  const [templates, setTemplates] = useState<DebtReportTemplate[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [preparingPreview, setPreparingPreview] = useState(false);
  // Saat true, teks pratinjau dibangun ulang begitu data SSOT selesai disegarkan.
  const [resetPending, setResetPending] = useState(false);
  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);
  // Pratinjau alokasi pembayaran (tombol "−"): rincian tagihan terlama
  // mana saja yang akan dikurangi, sebelum benar-benar disimpan.
  const [payPlan, setPayPlan] = useState<
    { kind: Kind; amount: number; plan: AllocPlan; via: AuditVia } | null
  >(null);
  const [payingPlan, setPayingPlan] = useState(false);
  // Ditandai saat saldo baru saja berubah dari dalam chat, supaya tombol
  // "Kirim laporan" menonjol dan pemilik toko tidak lupa mengabarkan.
  const [dirty, setDirty] = useState(false);
  // Catatan perubahan sesi ini (sejak laporan terakhir dikirim) — dipakai
  // sebagai ringkasan konfirmasi terakhir sebelum "Kirim sekarang".
  const [changeLog, setChangeLog] = useState<SessionChange[]>([]);
  const [baseline, setBaseline] = useState<{ hutang: number; piutang: number } | null>(
    null,
  );
  const [confirmSend, setConfirmSend] = useState(false);

  /** Simpan saldo sebelum perubahan pertama supaya delta bisa dihitung. */
  const markBaseline = () => {
    setBaseline((b) => b ?? { hutang, piutang });
  };
  const recordChange = (entry: SessionChange) =>
    setChangeLog((prev) => [...prev, entry]);

  /** Nama pelaku (untuk kolom "siapa yang mengubah") di audit log. */
  const actorQ = useQuery({
    queryKey: ["debt-audit-actor", myId],
    enabled: !!myId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", myId)
        .maybeSingle();
      return (data?.display_name as string | null) ?? null;
    },
  });
  const actorName = actorQ.data ?? "Saya";

  const auditKey = ["debt-adjust-audit", myId, peerName, conversationId ?? ""];
  const auditQ = useQuery({
    queryKey: auditKey,
    enabled: !!myId,
    staleTime: 10_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("debt_adjust_audit")
        .select(
          "id, actor_name, party_name, kind, action, amount, balance_before, balance_after, detail, created_at",
        )
        .eq("user_id", myId)
        .eq("party_name", peerName)
        .order("created_at", { ascending: false })
        .limit(30);
      return (data ?? []) as AuditRow[];
    },
  });
  const [auditOpen, setAuditOpen] = useState(false);

  /**
   * Tulis jejak audit: siapa, kapan, lewat tombol mana, dan transaksi apa
   * saja yang ditambah / dibayar. Gagal menulis audit tidak boleh
   * membatalkan transaksi yang sudah tersimpan — cukup diamkan.
   */
  const writeAudit = async (
    entry: SessionChange,
    meta: { via: AuditVia; before: number },
  ) => {
    const after =
      entry.type === "pembayaran"
        ? meta.before - entry.amount
        : meta.before + entry.amount;
    try {
      await supabase.from("debt_adjust_audit").insert({
        user_id: myId,
        actor_name: actorName,
        conversation_id: conversationId ?? null,
        party_name: peerName,
        kind: entry.kind,
        action:
          meta.via === "quick"
            ? entry.type === "pembayaran"
              ? "edit cepat (pembayaran)"
              : "edit cepat (tagihan)"
            : entry.type === "pembayaran"
              ? "catat pembayaran"
              : "tambah tagihan",
        amount: entry.amount,
        balance_before: meta.before,
        balance_after: after,
        detail: entry.detail,
      });
      await qc.invalidateQueries({ queryKey: auditKey });
    } catch {
      /* audit bersifat pelengkap */
    }
  };

  /** Semua perubahan saldo dari chat memicu refresh SSOT di seluruh app. */
  const afterChange = async () => {
    setDirty(true);
    emitDebtTx({
      kind: "piutang",
      wasCash: false,
      amount: 0,
      partyId: null,
      at: Date.now(),
    });
    await Promise.all([
      qc.invalidateQueries({ queryKey }),
      qc.invalidateQueries({ queryKey: DEBT_SYNC_QUERY_KEY }),
    ]);
  };

  const reportBody = (style: DebtReportStyle = reportStyle) =>
    buildDebtReport({
      peerName,
      hutang,
      piutang,
      style,
      history: history.map((h) => ({
        at: h.at,
        kind: h.kind,
        type: h.type,
        amount: h.amount,
        note: h.note,
      })),
    });

  /** Buka pratinjau: segarkan SSOT dulu supaya angka yang dilihat = yang dikirim. */
  const openPreview = async () => {
    if (!conversationId) return;
    setPreparingPreview(true);
    try {
      await qc.invalidateQueries({ queryKey: DEBT_SYNC_QUERY_KEY });
      setPreviewBody(reportBody());
      setPreviewEdit(false);
      setPreviewEdited(false);
      setTemplates(listReportTemplates());
      setActiveTemplateId(null);
      setTemplateName("");
      setPreviewOpen(true);
    } finally {
      setPreparingPreview(false);
    }
  };

  const tplCtx = { peerName, hutang, piutang };

  /**
   * Tombol "−" tidak langsung menulis: tampilkan dulu rincian tagihan
   * (invoice) terlama yang akan dikurangi. Tombol "+" tetap langsung.
   */
  const requestDelta = async (delta: number, kind: Kind, via: AuditVia = "button") => {
    const before = kind === "hutang" ? hutang : piutang;
    if (delta >= 0) {
      markBaseline();
      await applyDelta({
        delta,
        kind,
        summary: safeSummary,
        myId,
        peerName,
        onDone: () => void afterChange(),
        onRecord: (e) => {
          recordChange(e);
          void writeAudit(e, { via, before });
        },
      });
      return;
    }
    const amount = Math.abs(delta);
    // Jaring pengaman terakhir: jangan pernah menulis pembayaran yang
    // membuat saldo akhir negatif, dari jalur mana pun.
    const saldo = kind === "hutang" ? hutang : piutang;
    if (amount > saldo) {
      toast.error(
        `Pembayaran ${rupiah(amount)} melebihi sisa ${kind} ${rupiah(saldo)} — saldo akhir akan negatif.`,
      );
      return;
    }
    const plan = planDebtPayment({
      debts: safeSummary.debts,
      paidByDebt: safeSummary.paidByDebt,
      kind,
      amount,
    });
    if (plan.lines.length === 0) {
      toast.error("Tidak ada tagihan terbuka untuk dibayar.");
      return;
    }
    setPayPlan({ kind, amount, plan, via });
  };

  const confirmPayPlan = async () => {
    if (!payPlan) return;
    setPayingPlan(true);
    try {
      markBaseline();
      await applyDelta({
        delta: -payPlan.amount,
        kind: payPlan.kind,
        summary: safeSummary,
        myId,
        peerName,
        onDone: () => void afterChange(),
        onRecord: (e) => {
          recordChange(e);
          void writeAudit(e, {
            via: payPlan.via,
            before: payPlan.kind === "hutang" ? hutang : piutang,
          });
        },
      });
      setPayPlan(null);
    } finally {
      setPayingPlan(false);
    }
  };

  /** Pakai ulang gaya tersimpan: placeholder diisi angka SSOT terbaru. */
  const applyTemplate = (t: DebtReportTemplate) => {
    setPreviewBody(renderTemplate(t.body, tplCtx));
    setActiveTemplateId(t.id);
    setPreviewEdited(false);
    setTemplateName(t.name);
  };

  const saveTemplate = () => {
    const name =
      templateName.trim() ||
      `Gaya ${new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "short" })}`;
    setSavingTemplate(true);
    try {
      const next = saveReportTemplate(name, previewBody, tplCtx);
      setTemplates(next);
      setActiveTemplateId(next[0]?.id ?? null);
      setTemplateName(name);
      toast.success(`Template "${name}" disimpan — bisa dipilih lagi nanti.`);
    } finally {
      setSavingTemplate(false);
    }
  };

  const removeTemplate = (t: DebtReportTemplate) => {
    const next = deleteReportTemplate(t.id);
    setTemplates(next);
    if (activeTemplateId === t.id) setActiveTemplateId(null);
    toast.info(`Template "${t.name}" dihapus.`);
  };

  /** Kembalikan teks & angka pratinjau ke hasil hitungan SSOT terbaru. */
  const resetPreviewToSsot = async () => {
    setResetPending(true);
    await qc.invalidateQueries({ queryKey: DEBT_SYNC_QUERY_KEY });
    await qc.invalidateQueries({ queryKey });
  };

  useEffect(() => {
    if (!resetPending || debtsQ.isFetching) return;
    const tpl = templates.find((t) => t.id === activeTemplateId);
    setPreviewBody(
      tpl ? renderTemplate(tpl.body, { peerName, hutang, piutang }) : reportBody(),
    );
    setPreviewEdited(false);
    setResetPending(false);
    toast.success("Pratinjau disegarkan ke angka SSOT terbaru.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetPending, debtsQ.isFetching, hutang, piutang]);

  const copyPreview = async () => {
    if (!previewBody.trim()) return;
    try {
      await navigator.clipboard.writeText(previewBody);
      toast.success("Teks laporan disalin ke clipboard.");
    } catch {
      toast.error("Gagal menyalin teks. Izinkan akses clipboard jika diminta.");
    }
  };

  const sendReport = async () => {
    if (!conversationId) return;
    setSendingReport(true);
    try {
      const body = previewBody || reportBody();
      await sendMessage({ data: { conversationId, body } });
      setDirty(false);
      setChangeLog([]);
      setBaseline(null);
      setConfirmSend(false);
      setPreviewOpen(false);
      toast.success("Laporan hutang/piutang terkirim ke chat.");
    } catch (e) {
      toast.error(
        (e as { message?: string })?.message ?? "Gagal mengirim laporan.",
      );
    } finally {
      setSendingReport(false);
    }
  };

  const runExport = async (format: "csv" | "pdf") => {
    setExporting(format);
    try {
      await qc.invalidateQueries({ queryKey: DEBT_SYNC_QUERY_KEY });
      await exportDebtReport(
        {
          peerName,
          hutang,
          piutang,
          history: history.map((h) => ({
            at: h.at,
            kind: h.kind,
            type: h.type,
            amount: h.amount,
            note: h.note,
          })),
        },
        format,
      );
      toast.success(
        format === "pdf" ? "Laporan PDF diunduh." : "Laporan Excel (CSV) diunduh.",
      );
    } catch (e) {
      toast.error(
        (e as { message?: string })?.message ?? "Gagal mengekspor laporan.",
      );
    } finally {
      setExporting(null);
    }
  };

  const filteredHistory = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    if (!q) return history;
    return history.filter((h) => {
      const amount = String(h.amount);
      const note = (h.note ?? "").toLowerCase();
      const type = (h.type === "tagihan" ? "tagihan" : "pembayaran").toLowerCase();
      const kind = (h.kind === "hutang" ? "hutang" : "piutang").toLowerCase();
      return (
        amount.includes(q) ||
        rupiah(h.amount).toLowerCase().includes(q) ||
        note.includes(q) ||
        type.includes(q) ||
        kind.includes(q)
      );
    });
  }, [history, historyQuery]);

  return (
    <>
    <Popover>
      <PopoverTrigger asChild>
        <DebtChip
          tone={tone}
          amount={dominantValue}
          aria-label={
            tone === "empty"
              ? `Belum ada catatan hutang/piutang dengan ${peerName}`
              : tone === "settled"
                ? `Catatan dengan ${peerName} lunas`
                : tone === "piutang"
                  ? `Piutang dari ${peerName}: ${rupiah(dominantValue)}`
                  : `Hutang kepada ${peerName}: ${rupiah(dominantValue)}`
          }
          title={
            tone === "empty"
              ? "Belum ada catatan — ketuk untuk mencatat hutang/piutang"
              : tone === "settled"
                ? "Tidak ada sisa hutang/piutang"
                : tone === "piutang"
                  ? `Piutang (dia berhutang ke Anda): ${rupiah(dominantValue)}`
                  : `Hutang (Anda berhutang ke dia): ${rupiah(dominantValue)}`
          }
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-ms-3">
        <div className="mb-2 text-ms-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          Tagihan dengan {peerName}
        </div>
        {mismatch && (
          <div className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-ms-2xs text-destructive">
            <div className="flex items-center gap-1 font-semibold">
              <AlertTriangle className="size-3.5" />
              Angka tidak sinkron
            </div>
            <div className="mt-1 space-y-0.5 text-foreground/80">
              {Math.abs(mismatch.dp) >= 1 && (
                <div>
                  Piutang: SSOT {rupiah(ssotEntry!.piutang)} vs catatan manual {rupiah(summary!.piutang)}
                  {" "}(selisih {rupiah(Math.abs(mismatch.dp))})
                </div>
              )}
              {Math.abs(mismatch.dh) >= 1 && (
                <div>
                  Hutang: SSOT {rupiah(ssotEntry!.hutang)} vs catatan manual {rupiah(summary!.hutang)}
                  {" "}(selisih {rupiah(Math.abs(mismatch.dh))})
                </div>
              )}
              <div className="text-muted-foreground">
                Selisih biasanya berasal dari penjualan berstatus hutang yang belum masuk catatan manual.
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="mt-2 h-7 w-full text-ms-2xs"
              disabled={syncing}
              onClick={async () => {
                setSyncing(true);
                try {
                  markBaseline();
                  if (Math.abs(mismatch.dp) >= 1) {
                    await applyDelta({
                      delta: mismatch.dp,
                      kind: "piutang",
                      summary: safeSummary,
                      myId,
                      peerName,
                      onDone: () => {},
                      onRecord: recordChange,
                    });
                  }
                  if (Math.abs(mismatch.dh) >= 1) {
                    await applyDelta({
                      delta: mismatch.dh,
                      kind: "hutang",
                      summary: safeSummary,
                      myId,
                      peerName,
                      onDone: () => {},
                      onRecord: recordChange,
                    });
                  }
                  await afterChange();
                } finally {
                  setSyncing(false);
                }
              }}
            >
              {syncing ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" />
              ) : (
                <Equal className="mr-1 size-3.5" />
              )}
              Selaraskan catatan manual ke SSOT
            </Button>
          </div>
        )}
        <div className="space-ms-2">
          <KindRow
            label="Piutang (dia berhutang)"
            balance={piutang}
            kind="piutang"
            otherBalance={hutang}
            onSubmit={(delta, via) => requestDelta(delta, "piutang", via)}
          />
          <KindRow
            label="Hutang (Anda berhutang)"
            balance={hutang}
            kind="hutang"
            otherBalance={piutang}
            onSubmit={(delta, via) => requestDelta(delta, "hutang", via)}
          />
        </div>
        <div className="mt-2 rounded-lg border">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-ms-2xs font-semibold"
            onClick={() => setAuditOpen((v) => !v)}
          >
            <span>Audit perubahan ({auditQ.data?.length ?? 0})</span>
            <span className="text-muted-foreground">
              {auditOpen ? "Tutup" : "Lihat"}
            </span>
          </button>
          {auditOpen ? (
            <div className="max-h-56 space-y-1.5 overflow-y-auto border-t p-2">
              {(auditQ.data ?? []).length === 0 ? (
                <div className="text-ms-2xs text-muted-foreground">
                  Belum ada perubahan tercatat untuk kontak ini.
                </div>
              ) : (
                (auditQ.data ?? []).map((a) => (
                  <div key={a.id} className="rounded-md border p-1.5 text-ms-2xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">
                        {a.action} · {a.kind}
                      </span>
                      <span
                        className={`font-mono font-semibold ${
                          a.action.includes("pembayaran") ? "text-success" : ""
                        }`}
                      >
                        {a.action.includes("pembayaran") ? "−" : "+"}
                        {rupiah(Number(a.amount))}
                      </span>
                    </div>
                    <div className="mt-0.5 text-muted-foreground">
                      {a.actor_name ?? "—"} · {formatWhen(a.created_at)}
                    </div>
                    <div className="text-muted-foreground">
                      Saldo {rupiah(Number(a.balance_before ?? 0))} →{" "}
                      {rupiah(Number(a.balance_after ?? 0))}
                    </div>
                    {Array.isArray(a.detail) && a.detail.length > 0 ? (
                      <ul className="mt-0.5 list-disc pl-4 text-muted-foreground">
                        {(a.detail as string[]).map((d, i) => (
                          <li key={i}>{d}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
        {conversationId ? (
          <Button
            type="button"
            size="sm"
            variant={dirty ? "default" : "outline"}
            className="mt-2 h-8 w-full text-ms-2xs"
            disabled={sendingReport || preparingPreview}
            onClick={() => void openPreview()}
          >
            {sendingReport || preparingPreview ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : (
              <Send className="mr-1 size-3.5" />
            )}
            Kirim laporan ke chat
          </Button>
        ) : null}
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 w-full text-ms-2xs"
            disabled={exporting !== null}
            onClick={() => void runExport("pdf")}
          >
            {exporting === "pdf" ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : (
              <FileText className="mr-1 size-3.5" />
            )}
            Ekspor PDF
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 w-full text-ms-2xs"
            disabled={exporting !== null}
            onClick={() => void runExport("csv")}
          >
            {exporting === "csv" ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="mr-1 size-3.5" />
            )}
            Ekspor Excel
          </Button>
        </div>
        {dirty ? (
          <p className="mt-1 text-ms-2xs leading-snug text-warning">
            Saldo baru saja berubah — kirim laporan agar kedua pihak sepakat.
          </p>
        ) : null}
        <p className="mt-3 text-ms-2xs leading-snug text-muted-foreground">
          <ArrowRight className="mr-1 inline h-2.5 w-2.5" />
          Tersinkron langsung ke Hutang & Piutang MCM Storage.
        </p>
        <div className="mt-3 border-t pt-2">
          <div className="mb-1.5 flex items-center justify-between gap-ms-2">
            <span className="text-ms-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Riwayat perubahan
            </span>
            {!debtsQ.isLoading && history.length > 0 && (
              <span className="text-ms-2xs text-muted-foreground">
                {filteredHistory.length}/{history.length}
              </span>
            )}
          </div>
          {!debtsQ.isLoading && history.length > 0 && (
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={historyQuery}
                onChange={(e) => setHistoryQuery(e.target.value)}
                placeholder="Cari nominal, catatan, jenis…"
                className="h-8 pl-7 pr-7 text-ms-xs"
              />
              {historyQuery && (
                <button
                  type="button"
                  onClick={() => setHistoryQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Hapus kata kunci"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          {debtsQ.isLoading ? (
            <div className="flex items-center gap-ms-1.5 text-ms-2xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Memuat…
            </div>
          ) : history.length === 0 ? (
            <p className="text-ms-2xs text-muted-foreground">
              Belum ada perubahan tercatat.
            </p>
          ) : filteredHistory.length === 0 ? (
            <p className="text-ms-2xs text-muted-foreground">
              Tidak ada riwayat cocok dengan “{historyQuery}”.
            </p>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-y-auto pr-1">
              {filteredHistory.slice(0, 30).map((h) => (
                <li
                  key={h.id}
                  className="flex items-start justify-between gap-ms-2 rounded-md bg-muted/40 px-2 py-1"
                >
                  <div className="min-w-0">
                    <div className="text-ms-2xs font-medium">
                      {highlight(
                        h.type === "tagihan" ? "Tambah tagihan" : "Pembayaran",
                        historyQuery,
                      )}
                      <span className="ml-1 font-normal text-muted-foreground">
                        {highlight(
                          h.kind === "hutang" ? "hutang" : "piutang",
                          historyQuery,
                        )}
                      </span>
                    </div>
                    <div className="truncate text-ms-2xs text-muted-foreground">
                      {formatWhen(h.at)}
                      {h.note ? (
                        <span>
                          {" · "}
                          {highlight(h.note, historyQuery)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 font-mono text-ms-2xs font-semibold ${
                      h.type === "tagihan" ? "text-warning" : "text-success"
                    }`}
                  >
                    {h.type === "tagihan" ? "+" : "−"}
                    {rupiah(h.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
    <Dialog open={previewOpen} onOpenChange={(o) => !sendingReport && setPreviewOpen(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pratinjau laporan</DialogTitle>
          <DialogDescription>
            Periksa angkanya dulu. Pesan ini akan dikirim ke chat {peerName}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-ms-2xs text-muted-foreground">Gaya pesan:</span>
          {(["ringkas", "detail"] as const).map((s) => (
            <Button
              key={s}
              type="button"
              size="sm"
              variant={reportStyle === s ? "default" : "outline"}
              className="h-7 px-2.5 text-ms-2xs capitalize"
              disabled={sendingReport}
              onClick={() => {
                setReportStyle(s);
                setPreviewBody(reportBody(s));
                setPreviewEdited(false);
                setActiveTemplateId(null);
              }}
            >
              {s}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant={previewEdit ? "default" : "outline"}
            className="ml-auto h-7 px-2.5 text-ms-2xs"
            disabled={sendingReport}
            onClick={() => setPreviewEdit((v) => !v)}
          >
            <Pencil className="mr-1 size-3" />
            {previewEdit ? "Selesai edit" : "Edit teks"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2.5 text-ms-2xs"
            disabled={sendingReport || resetPending}
            onClick={resetPreviewToSsot}
            title="Buang editan dan ambil ulang angka terbaru dari SSOT"
          >
            {resetPending ? (
              <Loader2 className="mr-1 size-3 animate-spin" />
            ) : (
              <RotateCcw className="mr-1 size-3" />
            )}
            Kembalikan ke SSOT
          </Button>
        </div>
        {templates.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-ms-2xs text-muted-foreground">Template saya:</span>
            {templates.map((t) => (
              <span
                key={t.id}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-ms-2xs ${
                  activeTemplateId === t.id ? "border-primary bg-primary/10" : ""
                }`}
              >
                <button
                  type="button"
                  className="max-w-[9rem] truncate"
                  disabled={sendingReport}
                  onClick={() => applyTemplate(t)}
                  title={`Pakai template "${t.name}"`}
                >
                  {t.name}
                </button>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={sendingReport}
                  onClick={() => removeTemplate(t)}
                  aria-label={`Hapus template ${t.name}`}
                >
                  <Trash2 className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {previewEdit ? (
          <Textarea
            value={previewBody}
            onChange={(e) => {
              setPreviewBody(e.target.value);
              setPreviewEdited(true);
            }}
            spellCheck={false}
            className="max-h-72 min-h-56 font-mono text-ms-xs leading-relaxed"
            aria-label="Edit teks laporan sebelum dikirim"
          />
        ) : (
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 text-ms-xs leading-relaxed">
            {previewBody}
          </pre>
        )}
        {previewEdited ? (
          <p className="text-ms-2xs leading-snug text-warning">
            Teks sudah diubah manual — angka tidak lagi otomatis mengikuti SSOT.
            Tekan gaya pesan untuk memulihkan teks asli.
          </p>
        ) : null}
        <div className="rounded-md border p-2">
          <div className="mb-1.5 flex items-center gap-1 text-ms-2xs font-medium">
            <Bookmark className="size-3 text-primary" />
            Simpan gaya ini sebagai template
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Nama template (mis. Tagihan sopan)"
              className="h-8 text-ms-2xs"
              disabled={sendingReport}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0 px-2.5 text-ms-2xs"
              disabled={sendingReport || savingTemplate || previewBody.trim().length === 0}
              onClick={saveTemplate}
            >
              {savingTemplate ? (
                <Loader2 className="mr-1 size-3 animate-spin" />
              ) : (
                <Bookmark className="mr-1 size-3" />
              )}
              Simpan
            </Button>
          </div>
          <p className="mt-1 text-ms-2xs leading-snug text-muted-foreground">
            Nama, nominal, dan tanggal otomatis jadi isian dinamis — saat template
            dipakai lagi, angkanya diambil ulang dari data terbaru.
          </p>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={sendingReport || previewBody.trim().length === 0}
            onClick={() => void copyPreview()}
          >
            <ClipboardCopy className="mr-1 size-3.5" />
            Salin teks
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={sendingReport}
            onClick={() => setPreviewOpen(false)}
          >
            Batal
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={sendingReport || previewBody.trim().length === 0}
            onClick={() => setConfirmSend(true)}
          >
            {sendingReport ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : (
              <Send className="mr-1 size-3.5" />
            )}
            Kirim sekarang
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog
      open={confirmSend}
      onOpenChange={(o) => !sendingReport && setConfirmSend(o)}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Konfirmasi kirim laporan</DialogTitle>
          <DialogDescription>
            Periksa ringkasan perubahan berikut sebelum laporan dikirim ke chat{" "}
            {peerName}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-ms-2xs">
          <div className="rounded-md border p-2">
            <div className="mb-1 font-semibold">Saldo yang akan dilaporkan</div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Piutang</span>
              <span className="font-mono font-semibold">
                {baseline && baseline.piutang !== piutang
                  ? `${rupiah(baseline.piutang)} → ${rupiah(piutang)}`
                  : rupiah(piutang)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Hutang</span>
              <span className="font-mono font-semibold">
                {baseline && baseline.hutang !== hutang
                  ? `${rupiah(baseline.hutang)} → ${rupiah(hutang)}`
                  : rupiah(hutang)}
              </span>
            </div>
          </div>
          {changeLog.length > 0 ? (
            <div className="rounded-md border p-2">
              <div className="mb-1 font-semibold">
                {changeLog.length} transaksi dibuat sejak laporan terakhir
              </div>
              <ul className="max-h-48 space-y-1.5 overflow-y-auto pr-0.5">
                {changeLog.map((c, i) => (
                  <li key={`${c.at}-${i}`} className="rounded border p-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold capitalize">
                        {c.type} {c.kind}
                      </span>
                      <span
                        className={`font-mono font-semibold ${
                          c.type === "pembayaran" ? "text-success" : ""
                        }`}
                      >
                        {c.type === "pembayaran" ? "−" : "+"}
                        {rupiah(c.amount)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-muted-foreground">
                      {c.detail.join(" · ")}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-2 text-muted-foreground">
              Tidak ada transaksi baru dari panel ini — laporan hanya
              mengabarkan saldo saat ini.
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={sendingReport}
            onClick={() => setConfirmSend(false)}
          >
            Periksa lagi
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={sendingReport}
            onClick={() => void sendReport()}
          >
            {sendingReport ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : (
              <Send className="mr-1 size-3.5" />
            )}
            Ya, kirim sekarang
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!payPlan} onOpenChange={(o) => !payingPlan && !o && setPayPlan(null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rincian pembayaran</DialogTitle>
          <DialogDescription>
            {payPlan
              ? `Pembayaran ${rupiah(payPlan.amount)} akan mengurangi tagihan ${
                  payPlan.kind === "hutang" ? "hutang" : "piutang"
                } ${peerName} mulai dari yang terlama.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        {payPlan ? (
          <div className="space-y-2">
            <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-0.5">
              {payPlan.plan.lines.map((l, i) => (
                <li key={l.debtId} className="rounded-md border p-2 text-ms-2xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold">
                      {i + 1}. {l.invoice}
                    </span>
                    <span className="font-mono font-semibold text-success">
                      −{rupiah(l.used)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-muted-foreground">
                    {formatWhen(l.createdAt)} · tagihan {rupiah(l.total)}
                  </div>
                  <div className="text-muted-foreground">
                    Sisa {rupiah(l.before)} → {rupiah(l.after)}
                    {l.after === 0 ? " (lunas)" : ""}
                  </div>
                </li>
              ))}
            </ul>
            <div className="rounded-md bg-muted/50 p-2 text-ms-2xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Dipakai</span>
                <span className="font-mono font-semibold">
                  {rupiah(payPlan.plan.applied)}
                </span>
              </div>
              {payPlan.plan.leftover > 0 ? (
                <div className="mt-0.5 flex items-center justify-between text-destructive">
                  <span>Sisa input tidak terpakai</span>
                  <span className="font-mono font-semibold">
                    {rupiah(payPlan.plan.leftover)}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={payingPlan}
            onClick={() => setPayPlan(null)}
          >
            Batal
          </Button>
          <Button type="button" disabled={payingPlan} onClick={() => void confirmPayPlan()}>
            {payingPlan ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : (
              <Minus className="mr-1 size-3.5" />
            )}
            Simpan pembayaran
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function highlight(text: string, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-primary/20 px-0.5">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

function KindRow({
  label,
  balance,
  kind,
  onSubmit,
  otherBalance,
}: {
  label: string;
  balance: number;
  kind: Kind;
  onSubmit: (delta: number, via: AuditVia) => Promise<void>;
  /** Saldo jenis lawan (untuk peringatan catatan yang bertentangan). */
  otherBalance: number;
}) {
  const [raw, setRaw] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [quick, setQuick] = useState(false);
  const [target, setTarget] = useState<string>("");
  const parsed = Number(raw.replace(/\D+/g, ""));
  const hasAmount = Number.isFinite(parsed) && parsed > 0;
  const targetParsed = Number(target.replace(/\D+/g, ""));
  const hasTarget = target.trim() !== "" && Number.isFinite(targetParsed);
  const delta = hasTarget ? targetParsed - balance : 0;
  // Sudah dikonfirmasi untuk nominal "tidak wajar" (butuh tekan dua kali).
  const [ack, setAck] = useState(false);
  useEffect(() => setAck(false), [raw, target]);

  /**
   * Validasi nominal sebelum menulis ke buku hutang/piutang.
   * - blok: pembayaran melebihi sisa (saldo akhir jadi negatif) atau saat
   *   tidak ada tagihan terbuka;
   * - peringatan: nominal jauh di luar kebiasaan, atau menambah tagihan
   *   jenis ini padahal jenis lawannya masih bersaldo (saling bertentangan).
   */
  const payBlock =
    hasAmount && balance <= 0
      ? `Tidak ada sisa ${kind} untuk dibayar.`
      : hasAmount && parsed > balance
        ? `Pembayaran ${rupiah(parsed)} melebihi sisa ${rupiah(balance)} — saldo akhir akan negatif.`
        : null;
  const targetBlock =
    hasTarget && targetParsed < 0 ? "Saldo akhir tidak boleh negatif." : null;
  const activeAmount = quick && hasTarget ? Math.abs(delta) : parsed;
  const unreasonable =
    (hasAmount || (quick && hasTarget && delta !== 0)) &&
    (activeAmount >= 1_000_000_000 ||
      (balance > 0 && activeAmount > balance * 100));
  const conflict =
    otherBalance > 0 &&
    ((hasAmount && !payBlock) || (quick && hasTarget && delta > 0));
  const warning = targetBlock
    ? null
    : unreasonable
      ? `Nominal ${rupiah(activeAmount)} jauh di luar kebiasaan untuk kontak ini. Pastikan tidak salah ketik.`
      : conflict
        ? `Kontak ini masih punya saldo ${kind === "piutang" ? "hutang" : "piutang"} ${rupiah(otherBalance)}. Menambah ${kind} sekaligus bisa membuat catatan saling bertentangan.`
        : null;
  /** Untuk peringatan (bukan blokir), butuh konfirmasi sekali. */
  const guard = (): boolean => {
    if (!warning) return true;
    if (ack) return true;
    setAck(true);
    toast.warning(warning, { description: "Tekan sekali lagi untuk tetap menyimpan." });
    return false;
  };

  const submit = async (sign: 1 | -1) => {
    if (!hasAmount) {
      toast.error("Isi jumlah dulu.");
      return;
    }
    if (sign === -1 && payBlock) {
      toast.error(payBlock);
      return;
    }
    if (!guard()) return;
    setBusy(true);
    try {
      await onSubmit(sign * parsed, "button");
      setRaw("");
      setAck(false);
    } finally {
      setBusy(false);
    }
  };

  const submitTarget = async () => {
    if (!hasTarget) {
      toast.error("Isi nominal baru dulu.");
      return;
    }
    if (targetBlock) {
      toast.error(targetBlock);
      return;
    }
    if (delta === 0) {
      toast.info("Nominal sudah sama.");
      return;
    }
    if (!guard()) return;
    setBusy(true);
    try {
      await onSubmit(delta, "quick");
      setTarget("");
      setAck(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border p-ms-2">
      <div className="mb-1.5 flex items-center justify-between gap-ms-2 text-ms-2xs">
        <span className="text-muted-foreground">{label}</span>
        <div className="flex items-center gap-ms-1.5">
          <span
            className={`font-mono font-semibold ${
              kind === "piutang"
                ? "text-success dark:text-success"
                : "text-warning dark:text-warning"
            }`}
          >
            {rupiah(balance)}
          </span>
          <button
            type="button"
            onClick={() => {
              setQuick((v) => !v);
              setTarget(quick ? "" : String(balance));
            }}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={quick ? "Tutup edit cepat" : "Edit cepat nominal"}
            title={quick ? "Tutup edit cepat" : "Edit cepat nominal"}
          >
            {quick ? <X className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
          </button>
        </div>
      </div>
      {quick ? (
        <div className="mb-1.5 rounded-md bg-muted/50 p-ms-1.5">
          <div className="flex items-center gap-ms-1.5">
            <NumericTextField
              value={target}
              onValueChange={setTarget}
              decimal={false}
              placeholder="Nominal baru"
              className="flex h-8 flex-1 rounded-md border border-input bg-background px-3 py-2 text-right font-mono text-ms-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy}
            />
            <Button
              type="button"
              size="icon"
              className="h-8 w-8 shrink-0"
              disabled={busy || !hasTarget || delta === 0}
              onClick={submitTarget}
              aria-label="Simpan nominal baru"
              title="Simpan nominal baru"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Equal className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <p className="mt-1 text-ms-2xs leading-snug text-muted-foreground">
            {hasTarget && delta !== 0
              ? delta > 0
                ? `Tambah tagihan ${rupiah(delta)}`
                : `Catat pembayaran ${rupiah(Math.abs(delta))}`
              : "Isi saldo akhir yang benar — selisihnya dicatat otomatis."}
          </p>
          {targetBlock ? (
            <p className="mt-1 flex items-start gap-1 text-ms-2xs leading-snug text-destructive">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              {targetBlock}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-center gap-ms-1.5">
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8 shrink-0"
          disabled={busy || balance <= 0 || !hasAmount || !!payBlock}
          onClick={() => submit(-1)}
          aria-label="Kurangi (catat pembayaran)"
          title={payBlock ?? "Catat pembayaran"}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Minus className="h-3.5 w-3.5" />}
        </Button>
        <NumericTextField
          value={raw}
          onValueChange={setRaw}
          decimal={false}
          placeholder="0"
          className="flex h-8 flex-1 rounded-md border border-input bg-background px-3 py-2 text-right font-mono text-ms-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
      {payBlock ? (
        <p className="mt-1 flex items-start gap-1 text-ms-2xs leading-snug text-destructive">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          {payBlock}
          {balance > 0 ? (
            <button
              type="button"
              className="ml-1 shrink-0 underline"
              onClick={() => setRaw(String(balance))}
            >
              Pakai {rupiah(balance)}
            </button>
          ) : null}
        </p>
      ) : warning ? (
        <p className="mt-1 flex items-start gap-1 text-ms-2xs leading-snug text-warning">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          {warning}
          {ack ? " Tekan sekali lagi untuk tetap menyimpan." : ""}
        </p>
      ) : null}
    </div>
  );
}

/** Satu perubahan saldo yang dibuat dari panel chat pada sesi berjalan. */
type SessionChange = {
  at: number;
  kind: Kind;
  type: "tagihan" | "pembayaran";
  amount: number;
  detail: string[];
};

async function applyDelta({
  delta,
  kind,
  summary,
  myId,
  peerName,
  onDone,
  onRecord,
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
  onRecord?: (entry: SessionChange) => void;
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
      onRecord?.({
        at: Date.now(),
        kind,
        type: "tagihan",
        amount: delta,
        detail: [`Tagihan baru ${rupiah(delta)} untuk ${partyName}`],
      });
      toast.success(
        `${kind === "hutang" ? "Hutang" : "Piutang"} baru ${rupiah(delta)} dicatat.`,
      );
    } else {
      // Catat pembayaran → alokasi terhadap debts terlama yang masih bersaldo.
      const remaining = Math.abs(delta);
      // SSOT alokasi: sama persis dengan pratinjau "Rincian pembayaran".
      const plan = planDebtPayment({
        debts: summary.debts,
        paidByDebt: summary.paidByDebt,
        kind,
        amount: remaining,
      });
      const rows: Array<{
        user_id: string;
        debt_id: string;
        amount: number;
        paid_at: string;
        note: string;
      }> = [];
      const today = new Date().toISOString().slice(0, 10);
      for (const l of plan.lines) {
        rows.push({
          user_id: myId,
          debt_id: l.debtId,
          amount: l.used,
          paid_at: today,
          note: `Dicatat dari chat · ${l.invoice}`,
        });
      }
      if (rows.length === 0) {
        toast.error("Tidak ada saldo untuk dibayar.");
        return;
      }
      const { error } = await supabase.from("debt_payments").insert(rows);
      if (error) throw error;
      const applied = plan.applied;
      const left = plan.leftover;
      onRecord?.({
        at: Date.now(),
        kind,
        type: "pembayaran",
        amount: applied,
        detail: plan.lines.map((l) => `${l.invoice} −${rupiah(l.used)}`),
      });
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