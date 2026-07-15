import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PhotoEditorV2 as PhotoEditor } from "@/components/photo-editor/PhotoEditorV2";
import { displayUnit } from "@/lib/unit-label";
import {
  UNIT_GROUPS,
  UNIT_LABEL_ID,
  canonicalUnitLabel,
  formatQty,
  isDecimalKind,
  qtyPlaceholder,
  resolveKind,
  type UnitKind,
} from "@/lib/unit-kinds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Camera, Image as ImageIcon, Edit3, MapPin, Plus, PackagePlus, Trash2,
  Loader2, ChevronLeft, Package, FlaskConical, Copy, ExternalLink,
  AlertTriangle, RotateCw, Send, MessageCircle, Download, FileText, History,
  CheckCircle2, Wallet, HandCoins, Sparkles,
} from "lucide-react";
import {
  requestSignedUrl, uploadRequestPhoto, deleteRequestPhoto,
  type RequestTitle, type RequestTitleItem, type RequestPreparation,
} from "@/lib/request";
import { shareToWhatsApp, notifyShareResult, urlToFile } from "@/lib/share-wa";
import { shareToChat } from "@/lib/share-chat";
import { PickChatConversationDialog } from "@/components/PickChatConversationDialog";
import { publicTaskUrl, genPin, genShareToken } from "@/lib/prep";
import { signedUrl as prepSignedUrl } from "@/lib/prep";
import { ecerSignedUrl } from "@/lib/ecer";
import { fetchAddressBook, upsertManualEntry, normalizePhone, type AddressBookRow } from "@/lib/address-book";
import { useNavigate } from "@tanstack/react-router";
import { rupiah } from "@/lib/stock-format";
import { useLayoutMode, layoutGridClass, LayoutModeToggle } from "@/components/LayoutModeToggle";
import { DialogScrollProgress, type ScrollSection } from "@/components/DialogScrollProgress";
import { DialogSaveStatus, useSaveStatus, useSaveStatusToast, confirmDiscardIfDirty } from "@/components/DialogSaveStatus";
import { Field } from "@/components/DialogField";
import { buildReadOnlyToast } from "@/lib/prep-readonly-guard";
import { filterActivePreps, filterSentPreps, isSentPrep } from "@/lib/prep-active-selector";
import { buildPaymentMessageLines, formatPaymentRupiah, formatSoldPaymentSummary, getPaymentBreakdown, parsePaymentAmountInput } from "@/lib/payment-summary";
import { emitDebtTx } from "@/lib/debt-tx-event";
import { PendingVerificationSection } from "@/components/prep/PendingVerificationSection";
import { debounce } from "@/lib/realtime-debounce";

type CustomerRow = { id: string; name: string; contact: string | null };

export const Route = createFileRoute("/_authenticated/request")({
  head: () => ({ meta: [{ title: "Penyiapan Request · MCM Storage" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    title: typeof s.title === "string" ? s.title : undefined,
    highlight: typeof s.highlight === "string" ? s.highlight : undefined,
    send:
      s.send === "wa" || s.send === "chat"
        ? (s.send as "wa" | "chat")
        : s.send === "1"
          ? ("wa" as const)
          : undefined,
  }),
  component: RequestPage,
});

type WarehouseItem = {
  id: string; name: string; category: string | null; base_unit: string;
  stock_base: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

function RequestPage() {
  const search = Route.useSearch();
  const router = useRouter();
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [titles, setTitles] = useState<RequestTitle[]>([]);
  const [titleItems, setTitleItems] = useState<RequestTitleItem[]>([]);
  // Peta title_id -> jumlah prep dalam siklus AKTIF (created_at > reprep_requested_at,
  // atau semuanya bila reprep_requested_at null). Dipakai untuk memutuskan
  // apakah tombol "Minta penyiapan ulang" ditampilkan (siklus sudah punya prep
  // = sudah selesai, boleh direset).
  const [activePrepCountByTitle, setActivePrepCountByTitle] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  type LoadErr = {
    source: string; message: string; code?: string; status?: number;
    hint?: string; details?: string; diagnosis: string;
  };
  const [loadError, setLoadError] = useState<LoadErr | null>(null);
  const [selectedTitleId, setSelectedTitleId] = useState<string | undefined>(search.title);
  const [highlightTitleId, setHighlightTitleId] = useState<string | undefined>(search.highlight);
  // Deep-link `send=1` dari Beranda (ReadyRequestSection). Buka dialog verifikasi
  // penjualan otomatis pada paket aktif pertama — sekali saja, lalu dikonsumsi.
  const [autoSendPending, setAutoSendPending] = useState<boolean>(
    search.send === "wa" || search.send === "chat",
  );
  const [autoSendChannel, setAutoSendChannel] = useState<"whatsapp" | "chat">(
    search.send === "chat" ? "chat" : "whatsapp",
  );
  const [creatingTitle, setCreatingTitle] = useState(false);
  const [editingTitle, setEditingTitle] = useState<RequestTitle | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [sendLinkTitle, setSendLinkTitle] = useState<RequestTitle | null>(null);
  const [historyTitle, setHistoryTitle] = useState<RequestTitle | "all" | null>(null);

  // Kiriman pegawai yang task_item-nya belum terlink ke folder ecer manapun.
  // Aturan produk: "kalau produk gak ada di label, tersimpan di request order."
  type UnroutedRow = {
    id: string;
    task_item_id: string;
    photo_path: string | null;
    photo_paths: string[] | null;
    submitted_at: string;
    warehouse_item_id: string | null;
    warehouse_item_name: string | null;
    name_snapshot: string | null;
    qty_requested: number | null;
    unit_label: string | null;
    location_url: string | null;
    thumb_url?: string | null;
  };
  const [unrouted, setUnrouted] = useState<UnroutedRow[]>([]);
  const [unroutedOpen, setUnroutedOpen] = useState(false);

  async function loadUnrouted() {
    try {
      const { data, error } = await sb
        .from("prep_submissions_unrouted")
        .select("id,task_item_id,photo_path,photo_paths,submitted_at,warehouse_item_id,warehouse_item_name,name_snapshot,qty_requested,unit_label,location_url")
        .order("submitted_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      const rows = (data ?? []) as UnroutedRow[];
      // Resolve thumbnail URLs (best effort — 60 min TTL).
      await Promise.all(rows.map(async (r) => {
        if (!r.photo_path) return;
        const a = await prepSignedUrl(r.photo_path, 3600);
        r.thumb_url = a ?? (await ecerSignedUrl(r.photo_path, 3600));
      }));
      setUnrouted(rows);
    } catch (e) {
      // Non-fatal: kartu tetap hilang senyap kalau view tak tersedia.
      // eslint-disable-next-line no-console
      console.warn("loadUnrouted:", (e as Error).message);
      setUnrouted([]);
    }
  }

  useEffect(() => { void loadUnrouted(); }, []);
  useEffect(() => {
    // Debounce 400ms: satu wave insert/update di prep_submissions/task_items
    // sering datang beruntun; kita hanya butuh SEKALI reload di akhir gelombang.
    const reload = debounce(() => { void loadUnrouted(); }, 400);
    const ch = supabase.channel("request_unrouted")
      .on("postgres_changes", { event: "*", schema: "public", table: "prep_submissions" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "prep_task_items" }, reload)
      .subscribe();
    return () => { reload.cancel(); void supabase.removeChannel(ch); };
  }, []);

  function diagnose(code?: string, status?: number, msg?: string): string {
    if (status === 0 || /Failed to fetch|NetworkError/i.test(msg ?? "")) return "Jaringan terputus — periksa koneksi internet.";
    if (code === "PGRST301" || /JWT expired/i.test(msg ?? "")) return "Sesi login kedaluwarsa. Muat ulang halaman atau login ulang.";
    if (code === "42501") return "Izin database hilang (GRANT belum diberikan ke role authenticated).";
    if (code === "PGRST116") return "Baris diblokir RLS / tidak ditemukan untuk akun ini.";
    if (code === "PGRST205") return "Tabel tidak ditemukan di skema Data API.";
    if (status && status >= 500) return `Backend error (HTTP ${status}). Coba beberapa saat lagi.`;
    if (status === 401 || status === 403) return "Tidak diizinkan — sesi belum siap atau policy menolak.";
    return "Permintaan gagal — lihat detail di bawah.";
  }

  async function loadAll() {
    setLoadError(null);
    setLoading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        setLoadError({ source: "session", message: "Sesi belum siap", diagnosis: "Sesi login belum aktif. Coba muat ulang halaman atau login kembali." });
        return;
      }
      const [wi, t, ti] = await Promise.all([
        supabase.from("warehouse_items").select("id,name,category,base_unit,stock_base").order("name"),
        sb.from("request_titles").select("*").order("position").order("created_at"),
        sb.from("request_title_items").select("*").order("position"),
      ]);
      for (const [src, res] of [["warehouse_items", wi], ["request_titles", t], ["request_title_items", ti]] as const) {
        if (res.error) {
          const code = (res.error as { code?: string }).code;
          const status = (res.error as { status?: number }).status;
          setLoadError({
            source: src, message: res.error.message, code, status,
            hint: (res.error as { hint?: string }).hint,
            details: (res.error as { details?: string }).details,
            diagnosis: diagnose(code, status, res.error.message),
          });
          return;
        }
      }
      if (wi.data) setItems(wi.data as WarehouseItem[]);
      if (t.data) setTitles(t.data as RequestTitle[]);
      if (ti.data) setTitleItems(ti.data as RequestTitleItem[]);
      // Ambil prep untuk menghitung siklus aktif per title. Query
      // di-scoped otomatis oleh RLS ke user aktif; tidak perlu filter
      // user_id manual (dan tetap aman kalaupun ada baris lain lolos).
      const titlesData = (t.data ?? []) as RequestTitle[];
      const reprepById = new Map<string, string | null>(
        titlesData.map((row) => [row.id, row.reprep_requested_at ?? null]),
      );
      const { data: prepRows } = await sb
        .from("request_preparations")
        .select("title_id,created_at");
      const counts: Record<string, number> = {};
      for (const row of (prepRows ?? []) as Array<{ title_id: string; created_at: string }>) {
        const cutoff = reprepById.get(row.title_id) ?? null;
        if (cutoff && !(row.created_at > cutoff)) continue;
        counts[row.title_id] = (counts[row.title_id] ?? 0) + 1;
      }
      setActivePrepCountByTitle(counts);
    } catch (e) {
      const err = e as { message?: string; status?: number; code?: string };
      setLoadError({
        source: "exception", message: err.message ?? String(e),
        code: err.code, status: err.status,
        diagnosis: diagnose(err.code, err.status, err.message),
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadAll(); }, []);

  useEffect(() => {
    void router.navigate({ to: "/request", search: { title: selectedTitleId, highlight: undefined }, replace: true });
    // M11: hapus `router` dari deps — lihat catatan sejenis di `_authenticated.ecer.tsx`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTitleId]);

  const selectedTitle = useMemo(
    () => titles.find((t) => t.id === selectedTitleId),
    [titles, selectedTitleId],
  );
  const selectedTitleItems = useMemo(
    () => titleItems.filter((i) => i.title_id === selectedTitleId).sort((a, b) => a.position - b.position),
    [titleItems, selectedTitleId],
  );

  // Scroll & highlight target title when arriving via deep-link
  useEffect(() => {
    if (!highlightTitleId || titles.length === 0) return;
    const scrollId = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-request-title-id="${highlightTitleId}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    const clearId = window.setTimeout(() => setHighlightTitleId(undefined), 2600);
    return () => { window.clearTimeout(scrollId); window.clearTimeout(clearId); };
  }, [highlightTitleId, titles]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-ms-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Memuat…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl space-ms-3 p-ms-4">
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-ms-4 text-ms-sm">
          <div className="mb-2 flex items-center gap-ms-2 font-semibold text-destructive">
            <AlertTriangle className="h-4 w-4" /> Gagal memuat Penyiapan Request
          </div>
          <div className="space-y-1 text-ms-xs">
            <div><b>Sumber:</b> {loadError.source}</div>
            <div className="rounded bg-warning/10 p-ms-2 text-warning dark:text-warning"><b>Diagnosa:</b> {loadError.diagnosis}</div>
            <div><b>Pesan:</b> {loadError.message}</div>
            {loadError.code && <div><b>Kode:</b> {loadError.code}</div>}
            {loadError.status !== undefined && <div><b>HTTP:</b> {loadError.status}</div>}
            {loadError.hint && <div><b>Hint:</b> {loadError.hint}</div>}
            {loadError.details && <div><b>Detail:</b> {loadError.details}</div>}
            <div><b>Jaringan:</b> {typeof navigator !== "undefined" && navigator.onLine ? "online" : "offline"}</div>
          </div>
          <div className="mt-3 flex gap-ms-2">
            <Button size="sm" onClick={() => void loadAll()}>
              <RotateCw className="mr-1 h-3.5 w-3.5" /> Coba lagi
            </Button>
            <Button size="sm" variant="outline" onClick={async () => {
              try { await navigator.clipboard.writeText(JSON.stringify(loadError, null, 2)); toast.success("Detail disalin"); }
              catch (e) { toast.error("Gagal menyalin: " + ((e as Error)?.message ?? String(e))); }
            }}>Salin detail</Button>
          </div>
        </div>
      </div>
    );
  }

  if (selectedTitle) {
    return (
      <TitleDetailView
        title={selectedTitle}
        warehouseItems={items}
        titleItems={selectedTitleItems}
        onBack={() => setSelectedTitleId(undefined)}
        onChanged={loadAll}
        autoOpenSend={autoSendPending}
        autoOpenSendChannel={autoSendChannel}
        onConsumeAutoOpenSend={() => setAutoSendPending(false)}
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-ms-4 p-ms-3 sm:p-ms-5">
      {/* Hero header — konsisten dengan halaman Penyiapan Ecer */}
      <section
        aria-labelledby="request-heading"
        className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-ms-4 shadow-sm sm:p-ms-5"
      >
        <div className="flex items-start justify-between gap-ms-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 inline-flex items-center gap-ms-1.5 rounded-full border bg-background/70 px-ms-2.5 py-0.5 text-ms-2xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
              <Sparkles className="h-3 w-3 text-primary" /> Modul Penyiapan
            </div>
            <h1
              id="request-heading"
              className="flex items-center gap-ms-2 text-ms-lg font-bold tracking-tight sm:text-ms-xl"
            >
              <PackagePlus className="h-5 w-5 text-primary" /> Penyiapan Request
            </h1>
            <p className="mt-1 max-w-xl text-ms-2xs leading-snug text-muted-foreground sm:text-ms-xs">
              Buat <b>Judul Request</b> berisi beberapa produk sekaligus (mis. <i>Paket Bu Ani</i>:
              Kristal 1g + Madu 250g). Tiap kotak penyiapan = 1 paket dengan satu foto + lokasi.
              Stok semua produk otomatis berkurang.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setCreatingTitle(true)}
            className="shrink-0 gap-ms-1"
            aria-label="Buat judul request baru"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Judul baru</span>
          </Button>
        </div>
      </section>

      <div className="flex flex-wrap justify-end gap-ms-2">
        <Button size="sm" variant="outline" onClick={() => setTestOpen(true)}>
          <FlaskConical className="mr-1 h-4 w-4" /> Uji Coba Alur Pegawai
        </Button>
        <Button size="sm" variant="outline" onClick={() => setHistoryTitle("all")}>
          <History className="mr-1 h-4 w-4" /> Riwayat kirim link
        </Button>
      </div>

      <PendingVerificationSection />

      {unrouted.length > 0 && (
        <Card className="border-warning/40 bg-warning/40 dark:bg-warning/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between gap-ms-2 text-ms-base">
              <div className="flex items-center gap-ms-2 text-warning dark:text-warning">
                <AlertTriangle className="h-4 w-4" />
                Kiriman tanpa folder ecer
                <span className="rounded-full bg-warning/20 px-ms-2 py-0.5 text-ms-2xs font-medium">
                  {unrouted.length}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-ms-xs"
                onClick={() => setUnroutedOpen((v) => !v)}
              >
                {unroutedOpen ? "Sembunyikan" : "Lihat"}
              </Button>
            </CardTitle>
          </CardHeader>
          {unroutedOpen && (
            <CardContent className="space-ms-2">
              <p className="text-ms-2xs leading-relaxed text-muted-foreground">
                Kiriman pegawai untuk produk yang <b>belum memiliki folder ecer yang cocok</b> (produk tidak punya judul,
                atau jumlah/satuan task tidak persis sama dengan judul ecer manapun).
                Buka folder ecer produk terkait dan sesuaikan judulnya, atau perbaiki jumlah/satuan di halaman Tugas Baru
                agar kiriman berikutnya otomatis masuk folder yang benar.
              </p>
              <div className="grid grid-cols-1 gap-ms-2 sm:grid-cols-2">
                {unrouted.map((r) => {
                  const label = r.warehouse_item_name || r.name_snapshot || "(tanpa nama)";
                  const qty = r.qty_requested != null
                    ? `${r.qty_requested}${r.unit_label ? ` ${r.unit_label}` : ""}`
                    : "";
                  const when = new Date(r.submitted_at).toLocaleString("id-ID", {
                    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                  });
                  return (
                    <div
                      key={r.id}
                      className="flex items-center gap-ms-2 rounded-lg border bg-card p-ms-2"
                    >
                      {r.thumb_url ? (
                        <a
                          href={r.thumb_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0"
                        >
                          <img
                            src={r.thumb_url}
                            alt={`Kiriman ${label}`}
                            className="h-14 w-14 rounded-md object-cover"
                            loading="lazy"
                          />
                        </a>
                      ) : (
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border bg-muted">
                          <ImageIcon className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1 text-ms-xs">
                        <div className="truncate font-medium">{label}</div>
                        <div className="text-ms-2xs text-muted-foreground">
                          {qty || "—"} · {when}
                        </div>
                        {r.location_url && (
                          <a
                            href={r.location_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-ms-1 text-ms-2xs text-primary hover:underline"
                          >
                            <MapPin className="h-3 w-3" /> Lokasi
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {titles.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-8 text-center text-ms-sm text-muted-foreground">
          Belum ada judul request. Klik tombol di atas untuk membuat yang pertama.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-ms-3 sm:grid-cols-2">
          {titles.map((t) => {
            const tItems = titleItems.filter((i) => i.title_id === t.id);
            const sendTitleWA = () => {
              const lines: string[] = [];
              lines.push(`*Request — ${t.name}*`);
              if (t.note) lines.push(t.note);
              if (tItems.length > 0) {
                lines.push("");
                lines.push("Isi paket:");
                tItems.forEach((i) => {
                  const w = items.find((wi) => wi.id === i.warehouse_item_id);
                  lines.push(`• ${w?.name ?? "?"} ${formatQty(i.target_grams, i.unit_label, w?.name)}`);
                });
              }
              void shareToWhatsApp({ text: lines.join("\n"), title: `Request ${t.name}` }).then(notifyShareResult);
            };
            const deleteTitle = async () => {
              if (!confirm(`Hapus judul request "${t.name}"? Aksi ini permanen.`)) return;
              try {
                const { error } = await sb.from("request_titles").delete().eq("id", t.id);
                if (error) throw error;
                toast.success("Judul dihapus");
                void loadAll();
              } catch (e) {
                toast.error("Gagal hapus: " + (e as Error).message);
              }
            };
            const activePrepCount = activePrepCountByTitle[t.id] ?? 0;
            const canRequestReprep = activePrepCount > 0;
            const requestReprep = async () => {
              if (!confirm(
                `Minta penyiapan ulang untuk "${t.name}"?\n\n` +
                `Title ini akan muncul lagi di portal pegawai (task baru).\n` +
                `Riwayat penyiapan lama TIDAK dihapus — hanya siklus penyiapan ` +
                `di-reset. Aksi ini dicatat di riwayat title.`,
              )) return;
              try {
                const { error } = await sb
                  .from("request_titles")
                  .update({ reprep_requested_at: new Date().toISOString() })
                  .eq("id", t.id);
                if (error) throw error;
                toast.success("Permintaan penyiapan ulang tercatat");
                void loadAll();
              } catch (e) {
                toast.error("Gagal minta penyiapan ulang: " + (e as Error).message);
              }
            };
            return (
              <button
                key={t.id}
                onClick={() => setSelectedTitleId(t.id)}
                data-request-title-id={t.id}
                className={`flex flex-col gap-ms-1 rounded-xl border bg-card p-ms-3 text-left hover:border-primary/40 hover:bg-accent ${highlightTitleId === t.id ? "ring-2 ring-primary border-primary animate-pulse" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <div className="truncate font-semibold">{t.name}</div>
                  <span className="rounded-full bg-primary/10 px-ms-2 py-0.5 text-ms-2xs font-medium text-primary">
                    {tItems.length} produk
                  </span>
                </div>
                <div className="text-ms-2xs text-muted-foreground line-clamp-2">
                  {tItems.length > 0
                    ? tItems
                        .map((i) => {
                          const w = items.find((wi) => wi.id === i.warehouse_item_id);
                          return `${w?.name ?? "?"} ${formatQty(i.target_grams, i.unit_label, w?.name)}`;
                        })
                        .join(" · ")
                    : "Belum ada produk"}
                </div>
                <div className="mt-1 flex flex-wrap gap-ms-1.5">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); setEditingTitle(t); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setEditingTitle(t); } }}
                    className="inline-flex cursor-pointer items-center gap-ms-1 rounded-md border px-ms-2 py-0.5 text-ms-2xs text-muted-foreground hover:bg-muted"
                  >
                    <Edit3 className="h-3 w-3" /> Edit
                  </div>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); sendTitleWA(); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); sendTitleWA(); } }}
                    className="inline-flex cursor-pointer items-center gap-ms-1 rounded-md border border-[#25D366]/40 bg-[#25D366]/15 px-ms-2 py-0.5 text-ms-2xs text-[#0b6b3a] hover:bg-[#25D366]/25 dark:text-[#7ee2a8]"
                    aria-label="Kirim via MCM"
                  >
                    <MessageCircle className="h-3 w-3" /> Kirim via MCM
                  </div>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); setSendLinkTitle(t); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setSendLinkTitle(t); } }}
                    className="inline-flex cursor-pointer items-center gap-ms-1 rounded-md border border-primary/40 bg-primary/10 px-ms-2 py-0.5 text-ms-2xs text-primary hover:bg-primary/20"
                    aria-label="Kirim link ke pegawai"
                    title="Buat link + PIN untuk pegawai yang menyiapkan"
                  >
                    <Send className="h-3 w-3" /> Kirim link ke pegawai
                  </div>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); setHistoryTitle(t); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setHistoryTitle(t); } }}
                    className="inline-flex cursor-pointer items-center gap-ms-1 rounded-md border px-ms-2 py-0.5 text-ms-2xs text-muted-foreground hover:bg-muted"
                    aria-label="Riwayat pengiriman"
                    title="Riwayat pengiriman link ke pegawai untuk judul ini"
                  >
                    <History className="h-3 w-3" /> Riwayat
                  </div>
                  {canRequestReprep && (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); void requestReprep(); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); void requestReprep(); } }}
                      className="inline-flex cursor-pointer items-center gap-ms-1 rounded-md border border-warning/40 bg-warning/10 px-ms-2 py-0.5 text-ms-2xs font-medium text-warning hover:bg-warning/20 dark:text-warning"
                      aria-label="Minta penyiapan ulang"
                      title={`Sudah disiapkan ${activePrepCount}× pada siklus ini. Reset agar bisa disiapkan lagi di task baru tanpa mengubah riwayat.`}
                    >
                      <RotateCw className="h-3 w-3" /> Minta penyiapan ulang
                    </div>
                  )}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); void deleteTitle(); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); void deleteTitle(); } }}
                    className="inline-flex cursor-pointer items-center gap-ms-1 rounded-md border border-destructive/40 bg-destructive/10 px-ms-2 py-0.5 text-ms-2xs text-destructive hover:bg-destructive/20"
                    aria-label="Hapus judul"
                  >
                    <Trash2 className="h-3 w-3" /> Hapus
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <TitleEditorDialog
        open={creatingTitle || !!editingTitle}
        existing={editingTitle}
        warehouseItems={items}
        existingItems={editingTitle ? titleItems.filter((i) => i.title_id === editingTitle.id) : []}
        onClose={() => { setCreatingTitle(false); setEditingTitle(null); }}
        onSaved={loadAll}
      />

      <WorkerTestDialog
        open={testOpen}
        titles={titles}
        titleItemsCount={titleItems.length}
        onClose={() => setTestOpen(false)}
      />

      <SendPrepLinkDialog
        title={sendLinkTitle}
        titleItems={sendLinkTitle ? titleItems.filter((i) => i.title_id === sendLinkTitle.id) : []}
        warehouseItems={items}
        onClose={() => setSendLinkTitle(null)}
      />

      <DeliveryHistoryDialog
        target={historyTitle}
        onClose={() => setHistoryTitle(null)}
      />
    </div>
  );
}

function TitleEditorDialog({
  open, existing, warehouseItems, existingItems, onClose, onSaved,
}: {
  open: boolean;
  existing: RequestTitle | null;
  warehouseItems: WarehouseItem[];
  existingItems: RequestTitleItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sections: ScrollSection[] = [
    { id: "title-sec-nama", label: "Nama judul" },
    { id: "title-sec-catatan", label: "Catatan" },
    { id: "title-sec-produk", label: "Produk dalam paket" },
  ];
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  type EditorRow = { warehouse_item_id: string; target_grams: string; unit_kind: UnitKind; unit_custom: string; note: string };
  const [rows, setRows] = useState<Array<EditorRow>>([]);
  const [busy, setBusy] = useState(false);
  const [initialSnap, setInitialSnap] = useState<{ name: string; note: string; rows: Array<EditorRow> }>({ name: "", note: "", rows: [] });
  const [negErrors, setNegErrors] = useState<Record<number, string>>({});
  // Pesan error terakhir dari save() — dibaca `useSaveStatusToast`
  // saat status berubah saving → dirty (gagal simpan).
  const [saveError, setSaveError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<AddressBookRow[]>([]);
  const [nameOpen, setNameOpen] = useState(false);
  const [nameActive, setNameActive] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchAddressBook()
      .then((rows) => { if (!cancelled) setContacts(rows); })
      .catch(() => { /* diam — combobox opsional, input tetap jalan */ });
    return () => { cancelled = true; };
  }, [open]);

  const nameSuggestions = useMemo(() => {
    const q = name.trim().toLowerCase();
    if (!q) return [] as AddressBookRow[];
    const exact = contacts.some((c) => c.name.trim().toLowerCase() === q);
    const filtered = contacts
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 6);
    // Simpan flag `exact` via ref lokal — dipakai untuk menyembunyikan opsi
    // "Pakai … sebagai nama baru" saat sudah ada kontak persis sama.
    (filtered as AddressBookRow[] & { __exact?: boolean }).__exact = exact;
    return filtered;
  }, [name, contacts]);

  function sanitizeQty(idx: number, raw: string): string {
    if (raw === "" || raw === "-") {
      if (raw === "-") {
        setNegErrors((e) => ({ ...e, [idx]: "Jumlah tidak boleh negatif. Minimum 0." }));
        toast.error("Jumlah tidak boleh negatif");
        return "0";
      }
      setNegErrors((e) => { const c = { ...e }; delete c[idx]; return c; });
      return raw;
    }
    const n = Number(raw);
    if (Number.isFinite(n) && n < 0) {
      setNegErrors((e) => ({ ...e, [idx]: "Jumlah tidak boleh negatif. Minimum 0." }));
      toast.error("Jumlah tidak boleh negatif");
      return "0";
    }
    setNegErrors((e) => { const c = { ...e }; delete c[idx]; return c; });
    return raw;
  }

  useEffect(() => {
    if (!open) return;
    const nextName = existing?.name ?? "";
    const nextNote = existing?.note ?? "";
    const nextRows: EditorRow[] =
      existingItems.length > 0
        ? existingItems.map((i) => {
            const kind = resolveKind(i.unit_label);
            return {
              warehouse_item_id: i.warehouse_item_id,
              target_grams: String(i.target_grams),
              unit_kind: kind,
              unit_custom: kind === "custom" ? (i.unit_label ?? "") : "",
              note: i.note ?? "",
            };
          })
        : [{ warehouse_item_id: "", target_grams: "1", unit_kind: "gr", unit_custom: "", note: "" }];
    setName(nextName);
    setNote(nextNote);
    setRows(nextRows);
    setInitialSnap({ name: nextName, note: nextNote, rows: nextRows });
  }, [open, existing, existingItems]);

  function addRow() {
    setRows((r) => [...r, { warehouse_item_id: "", target_grams: "1", unit_kind: "gr", unit_custom: "", note: "" }]);
  }
  function removeRow(idx: number) {
    setRows((r) => r.filter((_, i) => i !== idx));
  }
  function updateRow(idx: number, patch: Partial<typeof rows[number]>) {
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) { toast.error("Nama judul wajib diisi"); return; }
    if (Object.keys(negErrors).length > 0) { toast.error("Perbaiki jumlah yang negatif terlebih dahulu"); return; }
    if (rows.some((r) => r.target_grams !== "" && Number(r.target_grams) < 0)) {
      toast.error("Jumlah tidak boleh negatif"); return;
    }
    const validRows = rows.filter((r) => r.warehouse_item_id && Number(r.target_grams) > 0);
    if (validRows.length === 0) { toast.error("Tambahkan minimal 1 produk"); return; }
    setSaveError(null);
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Belum login");
      let titleId = existing?.id;
      if (existing) {
        const { error } = await sb.from("request_titles").update({
          name: trimmed, note: note.trim() || null,
        }).eq("id", existing.id);
        if (error) throw error;
        // Replace items
        await sb.from("request_title_items").delete().eq("title_id", existing.id);
      } else {
        const { data, error } = await sb.from("request_titles").insert({
          user_id: uid, name: trimmed, note: note.trim() || null,
        }).select("id").single();
        if (error) throw error;
        titleId = data.id;
      }
      const payload = validRows.map((r, idx) => ({
        title_id: titleId,
        warehouse_item_id: r.warehouse_item_id,
        target_grams: Number(r.target_grams),
        unit_label: canonicalUnitLabel(r.unit_kind, r.unit_custom),
        note: r.note.trim() || null,
        position: idx,
      }));
      const { error: e2 } = await sb.from("request_title_items").insert(payload);
      if (e2) throw e2;
      toast.success("Judul tersimpan");
      onSaved(); onClose();
    } catch (e) {
      setSaveError("Gagal: " + (e as Error).message);
    } finally { setBusy(false); }
  }

  async function deleteTitle() {
    if (!existing) return;
    if (!confirm("Hapus judul ini? Penyiapan yang sudah ada tidak akan dihapus.")) return;
    setBusy(true);
    try {
      const { error } = await sb.from("request_titles").delete().eq("id", existing.id);
      if (error) throw error;
      toast.success("Judul dihapus");
      onSaved(); onClose();
    } catch (e) {
      toast.error("Gagal hapus: " + (e as Error).message);
    } finally { setBusy(false); }
  }

  const saveStatus = useSaveStatus({ name, note, rows }, initialSnap, busy);
  useSaveStatusToast(saveStatus, {
    successMessage: "Judul tersimpan",
    errorMessage: saveError,
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && confirmDiscardIfDirty(saveStatus)) onClose(); }}>
      <DialogContent ref={scrollRef} className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader className="sticky top-0 z-10 -mx-6 -mt-6 border-b bg-background px-ms-6 pt-6 pb-3">
          <div className="flex items-start justify-between gap-ms-2">
            <DialogTitle>{existing ? "Edit Judul Request" : "Judul Request Baru"}</DialogTitle>
            <DialogSaveStatus status={saveStatus} className="shrink-0" />
          </div>
          <DialogDescription>Tambahkan beberapa produk dalam 1 paket. Saat penyiapan, stok semua produk akan otomatis berkurang.</DialogDescription>
          <DialogScrollProgress containerRef={scrollRef} sections={sections} className="mt-2" />
        </DialogHeader>
        <div className="space-ms-3">
          <Field id="title-sec-nama" label="Nama judul">
            <div className="relative">
              <Input
                value={name}
                onChange={(e) => { setName(e.target.value); setNameOpen(true); setNameActive(0); }}
                onFocus={() => setNameOpen(true)}
                onBlur={() => { window.setTimeout(() => setNameOpen(false), 120); }}
                onKeyDown={(e) => {
                  if (!nameOpen || nameSuggestions.length === 0) return;
                  if (e.key === "ArrowDown") { e.preventDefault(); setNameActive((i) => Math.min(i + 1, nameSuggestions.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setNameActive((i) => Math.max(i - 1, 0)); }
                  else if (e.key === "Enter") {
                    const pick = nameSuggestions[nameActive];
                    if (pick) { e.preventDefault(); setName(pick.name); setNameOpen(false); }
                  } else if (e.key === "Escape") { setNameOpen(false); }
                }}
                placeholder="cth. Paket Bu Ani"
                aria-autocomplete="list"
                aria-expanded={nameOpen && nameSuggestions.length > 0}
                aria-controls="judul-name-suggestions"
              />
              {nameOpen && nameSuggestions.length > 0 && (
                <ul
                  id="judul-name-suggestions"
                  role="listbox"
                  className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
                >
                  {nameSuggestions.map((c, i) => (
                    <li key={c.id} role="option" aria-selected={i === nameActive}>
                      <button
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); setName(c.name); setNameOpen(false); }}
                        onMouseEnter={() => setNameActive(i)}
                        className={`flex w-full items-center gap-ms-2 px-ms-2 py-1.5 text-left text-ms-sm ${i === nameActive ? "bg-accent text-accent-foreground" : ""}`}
                      >
                        <span aria-hidden>👤</span>
                        <span className="min-w-0 flex-1 truncate">{c.name}</span>
                        {c.phone ? (
                          <span className="shrink-0 text-ms-2xs text-muted-foreground">{c.phone}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                  {!(nameSuggestions as AddressBookRow[] & { __exact?: boolean }).__exact && (
                    <li role="option" aria-selected={false} className="border-t">
                      <button
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); setNameOpen(false); }}
                        className="flex w-full items-center gap-ms-2 px-ms-2 py-1.5 text-left text-ms-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span className="truncate">Pakai “{name.trim()}” sebagai nama baru</span>
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </div>
          </Field>
          <Field id="title-sec-catatan" label="Catatan (opsional)">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </Field>
          <div id="title-sec-produk">
            <div className="mb-1 flex items-center justify-between">
              <Label>Produk dalam paket</Label>
              <Button type="button" size="sm" variant="outline" onClick={addRow}>
                <Plus className="mr-1 h-3 w-3" /> Tambah
              </Button>
            </div>
            <div className="space-ms-2">
              {rows.map((r, idx) => (
                // L9: stack ke 2 baris di 411px (produk full-width, lalu
                // qty + satuan). Pada >=sm kembali ke 7/2/3 seperti semula.
                <div key={idx} className="grid grid-cols-12 gap-ms-1.5 rounded-md border bg-muted/30 p-ms-2">
                  <select
                    value={r.warehouse_item_id}
                    onChange={(e) => updateRow(idx, { warehouse_item_id: e.target.value })}
                    className="col-span-12 sm:col-span-7 h-9 rounded-md border bg-background px-ms-2 text-ms-xs"
                  >
                    <option value="">— pilih produk —</option>
                    {warehouseItems.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    inputMode={isDecimalKind(r.unit_kind) ? "decimal" : "numeric"}
                    step={isDecimalKind(r.unit_kind) ? "any" : "1"}
                    min="0"
                    value={r.target_grams}
                    onChange={(e) => updateRow(idx, { target_grams: sanitizeQty(idx, e.target.value) })}
                    className="col-span-5 sm:col-span-2 h-9 text-ms-xs"
                    placeholder={qtyPlaceholder(r.unit_kind)}
                  />
                  <select
                    value={r.unit_kind}
                    onChange={(e) => updateRow(idx, { unit_kind: e.target.value as UnitKind })}
                    className="col-span-7 sm:col-span-3 h-9 rounded-md border bg-background px-1 text-ms-xs"
                    aria-label="Satuan"
                  >
                    {UNIT_GROUPS.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.kinds.map((k) => (
                          <option key={k} value={k}>{UNIT_LABEL_ID[k]}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {r.unit_kind === "custom" ? (
                    <Input
                      value={r.unit_custom}
                      onChange={(e) => updateRow(idx, { unit_custom: e.target.value })}
                      className="col-span-12 h-8 text-ms-2xs"
                      placeholder="Satuan lain (mis. sachet, renceng…)"
                    />
                  ) : null}
                  <Input
                    value={r.note}
                    onChange={(e) => updateRow(idx, { note: e.target.value })}
                    className="col-span-11 h-8 text-ms-2xs"
                    placeholder="catatan item (opsional)"
                  />
                  <button aria-label="Hapus"
                    type="button"
                    onClick={() => removeRow(idx)}
                    className="col-span-1 flex items-center justify-center rounded-md border text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  {negErrors[idx] ? (
                    <p className="col-span-12 text-ms-2xs font-medium text-destructive">{negErrors[idx]}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter className="sticky bottom-0 z-10 -mx-6 -mb-6 flex-col gap-ms-2.5 border-t bg-background px-ms-6 py-ms-3 sm:flex-row sm:justify-between sm:gap-ms-2">
          <div className="flex w-full items-center justify-center sm:hidden">
            <DialogSaveStatus status={saveStatus} compact />
          </div>
          {existing ? (
            <Button variant="ghost" size="sm" className="min-h-11 text-destructive sm:min-h-9" onClick={deleteTitle} disabled={busy}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Hapus
            </Button>
          ) : (
            <span className="hidden sm:flex sm:items-center">
              <DialogSaveStatus status={saveStatus} compact />
            </span>
          )}
          <div className="grid grid-cols-1 gap-ms-2.5 sm:grid-cols-2 sm:gap-ms-2 [&>*]:min-h-11 sm:[&>*]:min-h-9">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Batal</Button>
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null} Simpan
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
// ------------------------------------------------------------------
// Kirim link ke pegawai (real task, bukan uji coba)
// ------------------------------------------------------------------
function SendPrepLinkDialog({
  title, titleItems, warehouseItems, onClose,
}: {
  title: RequestTitle | null;
  titleItems: RequestTitleItem[];
  warehouseItems: WarehouseItem[];
  onClose: () => void;
}) {
  const open = !!title;
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<{ url: string; pin: string; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workerName, setWorkerName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  // Aksi mana yang sedang diproses. Dipakai untuk menampilkan spinner
  // in-place (tanpa mengubah lebar tombol) dan mencuri fokus double-tap
  // — semua tombol aksi lain di-disable selama satu aksi berjalan supaya
  // baris berikutnya tidak ikut bergeser saat state berubah.
  type PendingAction = "copyMsg" | "copyLinkPin" | "sendWA" | "downloadPng" | "downloadPdf";
  const [pending, setPending] = useState<PendingAction | null>(null);
  const isPending = pending !== null;

  async function logDelivery(channel: "whatsapp" | "copy_message" | "copy_link_pin" | "download_png" | "download_pdf") {
    if (!title || !session) return;
    const nm = workerName.trim();
    if (!nm) return;
    try {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from as any)("prep_link_deliveries").insert({
        owner_user_id: uid,
        task_id: session.token ? (await resolveTaskId(session.token)) : null,
        title_id: title.id,
        title_name: title.name,
        worker_name: nm,
        channel,
      });
    } catch {
      // best-effort; don't block the user action on log failures
    }
  }

  async function resolveTaskId(shareToken: string): Promise<string | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from as any)("prep_tasks").select("id").eq("share_token", shareToken).maybeSingle();
      return (data?.id as string) ?? null;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    if (!open) {
      setSession(null); setError(null); setBusy(false);
      setWorkerName(""); setNameError(null); setPending(null);
    }
  }, [open]);

  function validateWorkerName(name: string): string | null {
    const trimmed = name.trim();
    if (!trimmed) return "Nama pegawai wajib diisi agar pesan bisa dibuat.";
    if (trimmed.length < 2) return "Nama pegawai minimal 2 karakter.";
    if (trimmed.length > 40) return "Nama pegawai maksimal 40 karakter.";
    if (!/^[\p{L}\p{M}\s'.-]+$/u.test(trimmed)) return "Nama pegawai hanya boleh huruf, spasi, titik, apostrof, atau tanda hubung.";
    return null;
  }

  async function createSession() {
    if (!title) return;
    const err = validateWorkerName(workerName);
    setNameError(err);
    if (err) return;
    setBusy(true);
    setError(null);
    try {
      const pin = genPin();
      const token = genShareToken();
      const noteLines: string[] = [];
      noteLines.push(`Siapkan paket untuk judul "${title.name}".`);
      if (title.note) noteLines.push(title.note);
      if (titleItems.length > 0) {
        noteLines.push("");
        noteLines.push("Target isi paket:");
        for (const i of titleItems) {
          const w = warehouseItems.find((wi) => wi.id === i.warehouse_item_id);
          noteLines.push(`• ${w?.name ?? "?"} ${formatQty(i.target_grams, i.unit_label, w?.name)}`);
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rpcErr } = await (supabase.rpc as any)("prep_create_task", {
        _title: `Request: ${title.name}`,
        _note: noteLines.join("\n"),
        _pin: pin,
        _share_token: token,
        _items: [],
        _max_submissions: 1,
      });
      if (rpcErr) throw rpcErr;
      setSession({ url: publicTaskUrl(token, pin), pin, token });
    } catch (e) {
      setError((e as Error).message || "Gagal membuat link tugas");
    } finally {
      setBusy(false);
    }
  }

  const waMessage = useMemo(() => {
    if (!session || !title) return "";
    const nm = workerName.trim();
    const greet = nm ? `Halo ${nm}, tolong bantu siapkan Request berikut ya 🙏` : `Halo, tolong bantu siapkan Request berikut ya 🙏`;
    const lines: string[] = [];
    lines.push(greet);
    lines.push("");
    lines.push(`*Judul Request:* ${title.name}`);
    if (titleItems.length > 0) {
      lines.push("");
      lines.push("*Isi paket:*");
      for (const i of titleItems) {
        const w = warehouseItems.find((wi) => wi.id === i.warehouse_item_id);
        lines.push(`• ${w?.name ?? "?"} ${formatQty(i.target_grams, i.unit_label, w?.name)}`);
      }
    }
    lines.push("");
    lines.push(`🔗 Link tugas: ${session.url}`);
    lines.push(`🔑 PIN: ${session.pin}`);
    lines.push("");
    lines.push("Buka link, masukkan PIN, lalu isi berat aktual + foto + lokasi. Terima kasih!");
    return lines.join("\n");
  }, [session, title, titleItems, warehouseItems, workerName]);

  const canPrepare = useMemo(() => {
    if (!session || !title) return false;
    return validateWorkerName(workerName) === null;
  }, [session, title, workerName]);

  async function copyLinkPin() {
    if (!session || pending) return;
    setPending("copyLinkPin");
    try {
      await navigator.clipboard.writeText(`Tugas: Request ${title?.name ?? ""}\nLink: ${session.url}\nPIN: ${session.pin}`);
      toast.success("Link + PIN disalin", { description: "Tempel di WhatsApp untuk kirim ulang." });
      void logDelivery("copy_link_pin");
    } catch (e) {
      toast.error("Gagal menyalin Link + PIN", { description: (e as Error)?.message ?? "Periksa izin clipboard." });
    } finally {
      setPending(null);
    }
  }

  async function copyMessage() {
    if (!waMessage || pending) return;
    setPending("copyMsg");
    try {
      await navigator.clipboard.writeText(waMessage);
      toast.success("Pesan WhatsApp disalin", { description: "Tempel di WhatsApp Business untuk kirim ke pegawai." });
      void logDelivery("copy_message");
    } catch (e) {
      toast.error("Gagal menyalin pesan", { description: (e as Error)?.message ?? "Periksa izin clipboard." });
    } finally {
      setPending(null);
    }
  }

  async function sendWA() {
    if (!session || !title || !waMessage || pending) return;
    setPending("sendWA");
    try {
      const res = await shareToWhatsApp({ text: waMessage, title: `Request ${title.name}`, url: session.url });
      notifyShareResult(res);
      void logDelivery("whatsapp");
    } finally {
      setPending(null);
    }
  }

  const qrUrl = session ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(session.url)}` : "";

  function fileSlug(): string {
    const base = (title?.name ?? "tugas").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "tugas";
    return `request-${base}`;
  }

  async function renderQrDataUrl(size = 512): Promise<string> {
    if (!session) throw new Error("Sesi belum siap");
    const { default: QRCode } = await import("qrcode");
    return await QRCode.toDataURL(session.url, { width: size, margin: 1, errorCorrectionLevel: "M" });
  }

  async function composePosterPng(): Promise<string> {
    if (!session || !title) throw new Error("Sesi belum siap");
    const qrData = await renderQrDataUrl(560);
    const qrImg = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("Gagal memuat QR"));
      im.src = qrData;
    });
    const W = 900, H = 1200;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas tidak tersedia");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#0f172a";
    ctx.font = "600 28px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Tugas Penyiapan Request", W / 2, 70);
    ctx.font = "700 40px system-ui, -apple-system, Segoe UI, sans-serif";
    // Wrap title
    const maxTitleWidth = W - 80;
    const words = title.name.split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(test).width > maxTitleWidth && cur) { lines.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) lines.push(cur);
    let ty = 130;
    for (const l of lines.slice(0, 2)) { ctx.fillText(l, W / 2, ty); ty += 48; }
    // QR
    const qrSize = 560;
    const qx = (W - qrSize) / 2;
    const qy = ty + 20;
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 2;
    ctx.strokeRect(qx - 12, qy - 12, qrSize + 24, qrSize + 24);
    ctx.drawImage(qrImg, qx, qy, qrSize, qrSize);
    // Link
    let y = qy + qrSize + 60;
    ctx.font = "500 20px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillStyle = "#475569";
    ctx.fillText("Link", W / 2, y);
    y += 30;
    ctx.font = "500 22px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "#0f172a";
    // shrink link to fit
    let linkText = session.url;
    while (ctx.measureText(linkText).width > W - 80 && linkText.length > 20) {
      ctx.font = `500 ${Math.max(14, parseInt(ctx.font) - 1)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      if (parseInt(ctx.font) <= 14) break;
    }
    ctx.fillText(linkText, W / 2, y);
    y += 60;
    ctx.font = "500 20px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillStyle = "#475569";
    ctx.fillText("PIN", W / 2, y);
    y += 44;
    ctx.font = "700 44px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "#0f172a";
    ctx.fillText(session.pin.split("").join("  "), W / 2, y);
    return canvas.toDataURL("image/png");
  }

  async function downloadPng() {
    if (!session || pending) return;
    setPending("downloadPng");
    try {
      const dataUrl = await composePosterPng();
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${fileSlug()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success("PNG diunduh");
      void logDelivery("download_png");
    } catch (e) {
      toast.error("Gagal unduh PNG: " + ((e as Error).message ?? String(e)));
    } finally {
      setPending(null);
    }
  }

  async function downloadPdf() {
    if (!session || !title || pending) return;
    setPending("downloadPdf");
    try {
      const qrData = await renderQrDataUrl(560);
      const { default: jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      let y = 20;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(12);
      doc.setTextColor(90);
      doc.text("Tugas Penyiapan Request", pageW / 2, y, { align: "center" });
      y += 10;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(20);
      doc.setTextColor(15);
      const titleLines = doc.splitTextToSize(title.name, pageW - 30);
      doc.text(titleLines.slice(0, 2), pageW / 2, y, { align: "center" });
      y += titleLines.slice(0, 2).length * 8 + 6;
      const qrSize = 90;
      doc.addImage(qrData, "PNG", (pageW - qrSize) / 2, y, qrSize, qrSize);
      y += qrSize + 12;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(90);
      doc.text("Link", pageW / 2, y, { align: "center" });
      y += 6;
      doc.setFont("courier", "normal");
      doc.setFontSize(11);
      doc.setTextColor(15);
      const linkLines = doc.splitTextToSize(session.url, pageW - 20);
      doc.text(linkLines, pageW / 2, y, { align: "center" });
      y += linkLines.length * 5 + 8;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(90);
      doc.text("PIN", pageW / 2, y, { align: "center" });
      y += 8;
      doc.setFont("courier", "bold");
      doc.setFontSize(24);
      doc.setTextColor(15);
      doc.text(session.pin.split("").join("  "), pageW / 2, y, { align: "center" });
      y += 14;
      // Items
      if (titleItems.length > 0) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(15);
        doc.text("Isi paket:", 15, y);
        y += 6;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        for (const i of titleItems) {
          const w = warehouseItems.find((wi) => wi.id === i.warehouse_item_id);
          const line = `• ${w?.name ?? "?"} ${formatQty(i.target_grams, i.unit_label, w?.name)}`;
          doc.text(line, 15, y);
          y += 5;
          if (y > 280) { doc.addPage(); y = 20; }
        }
      }
      doc.save(`${fileSlug()}.pdf`);
      toast.success("PDF diunduh");
      void logDelivery("download_pdf");
    } catch (e) {
      toast.error("Gagal unduh PDF: " + ((e as Error).message ?? String(e)));
    } finally {
      setPending(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-ms-2">
            <Send className="h-4 w-4 text-primary" /> Kirim link ke pegawai
          </DialogTitle>
          <DialogDescription>
            Buat tautan + PIN agar pegawai bisa membuka form Penyiapan Request untuk <b>{title?.name}</b> langsung dari HP-nya.
          </DialogDescription>
        </DialogHeader>

        {busy && !session ? (
          <div className="flex items-center justify-center gap-ms-2 py-8 text-ms-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Membuat link…
          </div>
        ) : error ? (
          <div className="space-ms-2">
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-ms-3 text-ms-xs text-destructive">
              <div className="flex items-center gap-ms-1 font-semibold"><AlertTriangle className="h-3.5 w-3.5" /> Gagal membuat link</div>
              <div className="mt-1 break-words">{error}</div>
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={() => { setError(null); setSession(null); }}>
              <RotateCw className="mr-1 h-3.5 w-3.5" /> Coba lagi
            </Button>
          </div>
        ) : session ? (
          <div className="space-ms-3">
            <div className="flex justify-center rounded-lg border bg-white p-ms-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrUrl} alt="QR tugas pegawai" width={200} height={200} />
            </div>
            <div className="space-y-1.5">
              <div>
                <Label className="text-ms-2xs uppercase tracking-wide text-muted-foreground">Link</Label>
                <div className="break-all rounded-md border bg-muted/30 px-ms-2 py-1.5 text-ms-2xs font-mono">
                  {session.url}
                </div>
              </div>
              <div>
                <Label className="text-ms-2xs uppercase tracking-wide text-muted-foreground">PIN</Label>
                <div className="rounded-md border bg-muted/30 px-ms-2 py-1.5 text-center text-ms-lg font-bold tracking-[0.4em] tabular-nums">
                  {session.pin}
                </div>
              </div>
            </div>
            <div>
              <Label className="text-ms-2xs uppercase tracking-wide text-muted-foreground">Nama pegawai</Label>
              <Input
                value={workerName}
                onChange={(e) => setWorkerName(e.target.value)}
                onBlur={() => setNameError(validateWorkerName(workerName))}
                placeholder="mis. Budi"
                maxLength={40}
                className="h-8"
              />
              {nameError && (
                <div className="mt-1.5 flex items-start gap-ms-1 text-ms-2xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{nameError}</span>
                </div>
              )}
            </div>
            <div>
              <Label className="text-ms-2xs uppercase tracking-wide text-muted-foreground">Pratinjau pesan WhatsApp</Label>
              <Textarea
                readOnly
                value={waMessage}
                rows={8}
                className="mt-1 resize-none text-ms-2xs leading-relaxed font-mono"
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
            <div className="grid grid-cols-1 gap-ms-2.5 sm:grid-cols-2 sm:gap-ms-2 [&>*]:min-h-11 sm:[&>*]:min-h-9">
              <Button variant="outline" size="sm" onClick={copyMessage} disabled={!canPrepare || (isPending && pending !== "copyMsg")} aria-busy={pending === "copyMsg"}>
                {pending === "copyMsg"
                  ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  : <Copy className="mr-1 h-3.5 w-3.5" />}
                Salin pesan
              </Button>
              <Button
                size="sm"
                onClick={() => void sendWA()}
                disabled={!canPrepare || (isPending && pending !== "sendWA")}
                aria-busy={pending === "sendWA"}
                className="bg-[#25D366] text-white hover:bg-[#20b959]"
              >
                {pending === "sendWA"
                  ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  : <Send className="mr-1 h-3.5 w-3.5" />}
                Kirim via WhatsApp
              </Button>
            </div>
            <Button variant="ghost" size="sm" className="min-h-11 w-full sm:min-h-9" onClick={copyLinkPin} disabled={!canPrepare || (isPending && pending !== "copyLinkPin")} aria-busy={pending === "copyLinkPin"}>
              {pending === "copyLinkPin"
                ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                : <Copy className="mr-1 h-3.5 w-3.5" />}
              Salin Link + PIN saja
            </Button>
            <div className="grid grid-cols-1 gap-ms-2.5 sm:grid-cols-2 sm:gap-ms-2 [&>*]:min-h-11 sm:[&>*]:min-h-9">
              <Button variant="outline" size="sm" onClick={() => void downloadPng()} disabled={isPending && pending !== "downloadPng"} aria-busy={pending === "downloadPng"}>
                {pending === "downloadPng"
                  ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  : <Download className="mr-1 h-3.5 w-3.5" />}
                Unduh PNG
              </Button>
              <Button variant="outline" size="sm" onClick={() => void downloadPdf()} disabled={isPending && pending !== "downloadPdf"} aria-busy={pending === "downloadPdf"}>
                {pending === "downloadPdf"
                  ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  : <FileText className="mr-1 h-3.5 w-3.5" />}
                Unduh PDF
              </Button>
            </div>
            <Button variant="ghost" size="sm" asChild className="min-h-11 w-full sm:min-h-9">
              <a href={session.url} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1 h-3.5 w-3.5" /> Buka di tab baru untuk cek
              </a>
            </Button>
            <div className="rounded-md border border-warning/40 bg-warning/5 p-ms-2.5 text-ms-2xs leading-relaxed text-warning dark:text-warning">
              <b>1 link + PIN = 1 paket penyiapan.</b> Setelah pegawai kirim foto & lokasi, PIN otomatis mati.
              Untuk pesanan berikutnya, tekan tombol di bawah agar dapat link + PIN baru.
            </div>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 w-full sm:min-h-9"
              onClick={() => { setSession(null); setError(null); setWorkerName(""); setNameError(null); }}
              disabled={isPending}
            >
              <RotateCw className="mr-1 h-3.5 w-3.5" /> Buat link baru untuk pegawai lain
            </Button>
          </div>
        ) : (
          <div className="space-ms-3 py-1">
            <div>
              <Label htmlFor="worker-name" className="text-ms-2xs uppercase tracking-wide text-muted-foreground">
                Nama pegawai <span className="text-destructive">*</span>
              </Label>
              <Input
                id="worker-name"
                value={workerName}
                onChange={(e) => { setWorkerName(e.target.value); if (nameError) setNameError(validateWorkerName(e.target.value)); }}
                onBlur={() => setNameError(validateWorkerName(workerName))}
                placeholder="mis. Budi"
                maxLength={40}
                className="h-8"
                autoComplete="off"
              />
              {nameError ? (
                <div className="mt-1.5 flex items-start gap-ms-1 text-ms-2xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{nameError}</span>
                </div>
              ) : (
                <div className="mt-1.5 text-ms-2xs text-muted-foreground">Wajib diisi sebelum link & PIN dibuat.</div>
              )}
            </div>
            <div className="rounded-md border border-warning/40 bg-warning/5 p-ms-2.5 text-ms-2xs leading-relaxed text-warning dark:text-warning">
              <b>Langkah:</b> masukkan nama pegawai yang akan mengerjakan, lalu tekan <b>Buat link & PIN</b>. Setelah itu baru bisa menyalin atau mengunduh pesan.
            </div>
            <Button className="w-full" onClick={() => void createSession()} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
              Buat link & PIN
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Tutup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TitleDetailView({
  title, warehouseItems, titleItems, onBack, onChanged, autoOpenSend, autoOpenSendChannel, onConsumeAutoOpenSend,
}: {
  title: RequestTitle;
  warehouseItems: WarehouseItem[];
  titleItems: RequestTitleItem[];
  onBack: () => void;
  onChanged: () => void;
  autoOpenSend?: boolean;
  autoOpenSendChannel?: "whatsapp" | "chat";
  onConsumeAutoOpenSend?: () => void;
}) {
  const [preps, setPreps] = useState<RequestPreparation[]>([]);
  const [prepItems, setPrepItems] = useState<Array<{ id: string; preparation_id: string; warehouse_item_id: string; actual_grams: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);

  useEffect(() => {
    void supabase.from("customers").select("id,name,contact").order("name").then(({ data }) => {
      setCustomers(((data ?? []) as CustomerRow[]));
    });
  }, []);

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await sb.from("request_preparations")
        .select("*").eq("title_id", title.id).order("created_at", { ascending: false });
      if (error) throw error;
      const list = (data ?? []) as RequestPreparation[];
      setPreps(list);
      if (list.length > 0) {
        const ids = list.map((p) => p.id);
        const { data: pi, error: piErr } = await sb.from("request_preparation_items")
          .select("id,preparation_id,warehouse_item_id,actual_grams").in("preparation_id", ids);
        if (piErr) throw piErr;
        setPrepItems((pi ?? []) as typeof prepItems);
      } else {
        setPrepItems([]);
      }
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message ?? String(e) };
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, [title.id]);

  async function handleDelete(p: RequestPreparation) {
    // `isSentPrep` = SSOT untuk "sudah masuk Riwayat Terkirim". Jangan
    // pernah tulis literal boolean atas sold_at di call site —
    // konsistensi definisi "sent" dijaga di satu tempat saja.
    const wasSold = isSentPrep(p);
    const msg = wasSold
      ? "Hapus catatan penyiapan ini? Penjualan & piutang yang sudah tercatat TIDAK ikut terhapus."
      : "Hapus penyiapan ini? Stok akan dikembalikan.";
    if (!confirm(msg)) return;
    try {
      await deleteRequestPhoto(p.photo_path);
      // Legacy photos di photo_paths[] juga dibersihkan.
      const extra = (p.photo_paths ?? []).filter((x) => x && x !== p.photo_path);
      for (const pp of extra) await deleteRequestPhoto(pp);
      const { error } = await sb.from("request_preparations").delete().eq("id", p.id);
      if (error) throw error;
      toast.success(wasSold ? "Penyiapan dihapus" : "Penyiapan dihapus, stok dikembalikan");
      onChanged(); void load();
    } catch (e) { toast.error("Gagal: " + (e as Error).message); }
  }

  return (
    <div className="mx-auto max-w-4xl space-ms-4 p-ms-3 sm:p-ms-5">
      <button onClick={onBack} className="inline-flex items-center gap-ms-1 text-ms-xs text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-3 w-3" /> Kembali
      </button>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-ms-2 text-ms-base">
            <Package className="h-4 w-4 text-primary" /> {title.name}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-ms-2 text-ms-xs">
          {title.note && <p className="text-muted-foreground whitespace-pre-wrap">{title.note}</p>}
          <div>
            <div className="mb-1 text-ms-2xs uppercase tracking-wide text-muted-foreground">Isi paket</div>
            <div className="flex flex-wrap gap-ms-1.5">
              {titleItems.map((i) => {
                const w = warehouseItems.find((x) => x.id === i.warehouse_item_id);
                return (
                  <span key={i.id} className="rounded-md bg-primary/10 px-ms-2 py-0.5 text-ms-2xs font-medium text-primary">
                    {w?.name ?? "?"} {formatQty(i.target_grams, i.unit_label, w?.name)}
                  </span>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="mr-1 h-4 w-4" /> Penyiapan Baru
        </Button>
      </div>

      {loading ? (
        <div className="p-ms-6 text-center text-ms-xs text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></div>
      ) : preps.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-ms-6 text-center text-ms-xs text-muted-foreground">
          Belum ada penyiapan untuk judul ini.
        </div>
      ) : (
        <PrepSections
          preps={preps}
          prepItems={prepItems}
          warehouseItems={warehouseItems}
          titleItems={titleItems}
          titleName={title.name}
          customers={customers}
          onDelete={handleDelete}
          onChanged={async () => {
            onChanged();
            return load();
          }}
          autoOpenSend={autoOpenSend}
          autoOpenSendChannel={autoOpenSendChannel}
          onConsumeAutoOpenSend={onConsumeAutoOpenSend}
        />
      )}

      <PrepEditorDialog
        open={creating}
        title={title}
        titleItems={titleItems}
        warehouseItems={warehouseItems}
        onClose={() => setCreating(false)}
        onSaved={() => { onChanged(); void load(); }}
      />
    </div>
  );
}

function PrepSections({
  preps, prepItems, warehouseItems, titleItems, titleName, customers, onDelete, onChanged,
  autoOpenSend, autoOpenSendChannel, onConsumeAutoOpenSend,
}: {
  preps: RequestPreparation[];
  prepItems: Array<{ id: string; preparation_id: string; warehouse_item_id: string; actual_grams: number }>;
  warehouseItems: WarehouseItem[];
  titleItems: RequestTitleItem[];
  titleName: string;
  customers: CustomerRow[];
  onDelete: (p: RequestPreparation) => void;
  onChanged: () => Promise<{ ok: boolean; error?: string }> | void;
  autoOpenSend?: boolean;
  autoOpenSendChannel?: "whatsapp" | "chat";
  onConsumeAutoOpenSend?: () => void;
}) {
  const [showHistory, setShowHistory] = useState(true);
  const [layout, setLayout] = useLayoutMode("requestPrep", "grid");
  const gridClass = layoutGridClass(layout);
  const active = filterActivePreps(preps);
  const sent = filterSentPreps(preps);
  const [justSentId, setJustSentId] = useState<string | null>(null);
  const [awaitingSentId, setAwaitingSentId] = useState<string | null>(null);
  // Pesan error sinkronisasi yang persisten (tidak hilang seperti toast).
  // Dipakai untuk banner di atas Riwayat Terkirim supaya user tidak tertipu
  // grid yang belum ter-refresh.
  const [syncError, setSyncError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const sentRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const historyHeaderRef = useRef<HTMLDivElement | null>(null);

  // Filter Riwayat Terkirim: nama produk + rentang tanggal (sold_at).
  const [filterQ, setFilterQ] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const warehouseNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of warehouseItems) m.set(w.id, w.name);
    return m;
  }, [warehouseItems]);
  const filteredSent = useMemo(() => {
    const q = filterQ.trim().toLowerCase();
    const fromMs = filterFrom ? new Date(filterFrom + "T00:00:00").getTime() : null;
    const toMs = filterTo ? new Date(filterTo + "T23:59:59.999").getTime() : null;
    return sent.filter((p) => {
      if (fromMs !== null || toMs !== null) {
        const t = p.sold_at ? new Date(p.sold_at).getTime() : NaN;
        if (!Number.isFinite(t)) return false;
        if (fromMs !== null && t < fromMs) return false;
        if (toMs !== null && t > toMs) return false;
      }
      if (!q) return true;
      if (titleName.toLowerCase().includes(q)) return true;
      if ((p.sold_party_name ?? "").toLowerCase().includes(q)) return true;
      const names = prepItems
        .filter((pi) => pi.preparation_id === p.id)
        .map((pi) => warehouseNameById.get(pi.warehouse_item_id) ?? "");
      return names.some((n) => n.toLowerCase().includes(q));
    });
  }, [sent, filterQ, filterFrom, filterTo, prepItems, warehouseNameById, titleName]);
  const hasFilter = !!(filterQ || filterFrom || filterTo);
  const clearFilter = () => { setFilterQ(""); setFilterFrom(""); setFilterTo(""); };

  // Fase 1: menunggu kartu yang barusan dikirim muncul di daftar Riwayat
  // setelah refetch. Kadang shareToWhatsApp membuka share sheet native yang
  // menjeda tab, jadi refetch bisa terlambat — kita polling sampai muncul,
  // maksimal ~8 detik, lalu lanjut ke fase highlight/scroll.
  useEffect(() => {
    if (!awaitingSentId) return;
    const found = sent.some((p) => p.id === awaitingSentId);
    if (found) {
      setJustSentId(awaitingSentId);
      setAwaitingSentId(null);
      setSyncError(null);
      return;
    }
    const fallback = setTimeout(() => {
      // Kalau sampai timeout belum muncul di daftar Riwayat, refetch mungkin
      // gagal atau backend belum menandai sold_at — jangan biarkan grid
      // menipu, tampilkan toast error + tombol coba ulang.
      toast.error("Gagal memindahkan ke Riwayat Terkirim", {
        description:
          "Data di grid mungkin belum sinkron. Klik Muat Ulang untuk mengambil data terbaru dari server.",
        duration: 12000,
        action: {
          label: "Muat Ulang",
          onClick: () => {
            void reloadNow();
          },
        },
      });
      setSyncError(
        "Paket yang baru dikirim belum muncul di Riwayat Terkirim. Data di grid mungkin belum sinkron dengan server.",
      );
      setAwaitingSentId(null);
    }, 8000);
    return () => clearTimeout(fallback);
  }, [awaitingSentId, sent, onChanged]); // eslint-disable-line react-hooks/exhaustive-deps

  // Helper reload manual dari banner/toast; menampilkan spinner + hasilnya.
  async function reloadNow() {
    setReloading(true);
    try {
      const res = await Promise.resolve(onChanged());
      if (res && res.ok === false) {
        const msg = res.error ?? "unknown";
        setSyncError("Muat ulang gagal: " + msg);
        toast.error("Muat ulang gagal", { description: msg });
      } else {
        setSyncError(null);
        toast.success("Data diperbarui");
      }
    } finally {
      setReloading(false);
    }
  }

  // Fase 2: gulir ke kartu dan tampilkan cincin highlight. Coba beberapa kali
  // karena section Riwayat perlu 1–2 frame untuk expand + kartu perlu mount.
  useEffect(() => {
    if (!justSentId) return;
    setShowHistory(true);
    let cancelled = false;
    let attempts = 0;
    const trigger = () => {
      if (cancelled) return;
      attempts += 1;
      const el = sentRefs.current.get(justSentId) ?? historyHeaderRef.current;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        toast.success("Dipindahkan ke Riwayat Terkirim");
        return;
      }
      if (attempts < 8) setTimeout(trigger, 150);
    };
    const raf = requestAnimationFrame(() => setTimeout(trigger, 80));
    const clear = setTimeout(() => setJustSentId(null), 5000);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(clear);
    };
  }, [justSentId]);

  const renderCard = (p: RequestPreparation, idx: number, listLen: number, inSent: boolean) => {
    // Kartu di Riwayat Terkirim WAJIB read-only: semua handler yang bisa
    // mengubah status (hapus / kirim ulang) diblokir di sumber, bukan hanya
    // disembunyikan di UI. Ini jaring pengaman kalau suatu saat ada tombol
    // yang lolos render, keyboard shortcut, atau state stale.
    // Read-only kalau kartu berada di panel Riwayat Terkirim ATAU prep
    // itu sendiri sudah `sent` (selector-based).
    const isReadOnly = inSent || isSentPrep(p);
    const guardedDelete = () => {
      if (isReadOnly) {
        const t = buildReadOnlyToast("delete", p);
        toast.error(t.title, { description: t.description });
        return;
      }
      onDelete(p);
    };
    const guardedSent = () => {
      if (isReadOnly) {
        const t = buildReadOnlyToast("resend", p);
        toast.error(t.title, { description: t.description });
        return;
      }
      setShowHistory(true);
      setAwaitingSentId(p.id);
      setSyncError(null);
      void Promise.resolve(onChanged()).then((res) => {
        if (res && res.ok === false) {
          const msg = res.error ?? "unknown";
          toast.error("Gagal muat ulang daftar", {
            description: msg + " — coba tekan tombol Muat Ulang.",
            duration: 10000,
            action: { label: "Coba Lagi", onClick: () => { void reloadNow(); } },
          });
          setSyncError(
            "Gagal memuat ulang daftar setelah pengiriman: " + msg +
            ". Grid mungkin belum menampilkan status terbaru.",
          );
          setAwaitingSentId(null);
        }
      });
    };
    return (
    <div
      key={p.id}
      ref={(node) => {
        if (!inSent) return;
        if (node) sentRefs.current.set(p.id, node);
        else sentRefs.current.delete(p.id);
      }}
      className={[
        inSent && justSentId === p.id
          ? "rounded-xl ring-2 ring-success ring-offset-2 ring-offset-background transition"
          : "",
        isReadOnly ? "group/readonly" : "",
      ].filter(Boolean).join(" ") || undefined}
      aria-readonly={isReadOnly || undefined}
    >
    <PrepCard
      index={listLen - idx}
      prep={p}
      items={prepItems.filter((pi) => pi.preparation_id === p.id)}
      warehouseItems={warehouseItems}
      titleItems={titleItems}
      titleName={titleName}
      customers={customers}
      onDelete={guardedDelete}
      onSent={guardedSent}
      autoOpenSend={!inSent && !!autoOpenSend && idx === 0}
      autoOpenSendChannel={autoOpenSendChannel}
      onConsumeAutoOpenSend={onConsumeAutoOpenSend}
    />
    </div>
    );
  };
  return (
    <div className="space-ms-4">
      {(syncError || (awaitingSentId && !reloading)) && (
        <div
          role="alert"
          className={
            syncError
              ? "flex items-start gap-ms-2 rounded-md border border-destructive/40 bg-destructive/10 p-ms-2 text-ms-2xs text-destructive"
              : "flex items-start gap-ms-2 rounded-md border border-warning/40 bg-warning/10 p-ms-2 text-ms-2xs text-warning dark:text-warning"
          }
        >
          {syncError ? (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
          )}
          <div className="flex-1">
            <div className="font-semibold">
              {syncError ? "Data mungkin tidak sinkron" : "Menyelaraskan dengan server…"}
            </div>
            <div className="opacity-90">
              {syncError ??
                "Menunggu paket yang baru dikirim muncul di Riwayat Terkirim. Kalau terlalu lama, tekan Muat Ulang."}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-ms-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-ms-2xs"
              onClick={() => void reloadNow()}
              disabled={reloading}
            >
              {reloading ? (
                <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Memuat…</>
              ) : (
                <><RotateCw className="mr-1 h-3 w-3" /> Muat Ulang</>
              )}
            </Button>
            {syncError && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-ms-2xs"
                onClick={() => setSyncError(null)}
              >
                Tutup
              </Button>
            )}
          </div>
        </div>
      )}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-ms-2xs uppercase tracking-wide text-muted-foreground">
            Siap Kirim <span className="text-foreground/70">({active.length})</span>
          </p>
          <LayoutModeToggle mode={layout} onChange={setLayout} />
        </div>
        {active.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card p-ms-4 text-center text-ms-2xs text-muted-foreground">
            Tidak ada penyiapan yang menunggu dikirim.
          </div>
        ) : (
          <div className={gridClass}>
            {active.map((p, idx) => renderCard(p, idx, active.length, false))}
          </div>
        )}
      </div>
      {sent.length > 0 && (
        <div ref={historyHeaderRef}>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="mb-2 flex w-full items-center justify-between rounded-md border bg-muted/30 px-ms-3 py-1.5 text-ms-2xs uppercase tracking-wide text-muted-foreground hover:bg-muted/50"
            aria-expanded={showHistory}
          >
            <span className="inline-flex items-center gap-ms-1.5">
              <History className="h-3.5 w-3.5" />
              Riwayat Terkirim <span className="text-foreground/70">({sent.length})</span>
            </span>
            <span className="text-ms-2xs">{showHistory ? "Sembunyikan" : "Tampilkan"}</span>
          </button>
          {showHistory && (
            <>
              <div className="mb-2 grid gap-ms-2 rounded-md border bg-muted/20 p-ms-2 sm:grid-cols-[1fr_auto_auto_auto]">
                <Input
                  value={filterQ}
                  onChange={(e) => setFilterQ(e.target.value)}
                  placeholder="Cari nama produk / pelanggan…"
                  className="h-8 text-ms-xs"
                  aria-label="Cari nama produk"
                />
                <Input
                  type="date"
                  value={filterFrom}
                  onChange={(e) => setFilterFrom(e.target.value)}
                  className="h-8 text-ms-xs"
                  aria-label="Dari tanggal"
                />
                <Input
                  type="date"
                  value={filterTo}
                  onChange={(e) => setFilterTo(e.target.value)}
                  className="h-8 text-ms-xs"
                  aria-label="Sampai tanggal"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-ms-xs"
                  onClick={clearFilter}
                  disabled={!hasFilter}
                >
                  Reset
                </Button>
              </div>
              {hasFilter && (
                <p className="mb-2 text-ms-2xs text-muted-foreground">
                  Menampilkan {filteredSent.length} dari {sent.length} paket terkirim.
                </p>
              )}
              {filteredSent.length === 0 ? (
                <div className="rounded-xl border border-dashed bg-card p-ms-4 text-center text-ms-2xs text-muted-foreground">
                  Tidak ada paket terkirim yang cocok dengan filter.
                </div>
              ) : (
                <div className={gridClass}>
                  {filteredSent.map((p, idx) => renderCard(p, idx, filteredSent.length, true))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PrepCard({
  index, prep, items, warehouseItems, titleItems, titleName, customers, onDelete, onSent,
  autoOpenSend, autoOpenSendChannel, onConsumeAutoOpenSend,
}: {
  index: number;
  prep: RequestPreparation;
  items: Array<{ id: string; warehouse_item_id: string; actual_grams: number }>;
  warehouseItems: WarehouseItem[];
  titleItems: RequestTitleItem[];
  titleName: string;
  customers: CustomerRow[];
  onDelete: () => void;
  onSent: () => void;
  autoOpenSend?: boolean;
  autoOpenSendChannel?: "whatsapp" | "chat";
  onConsumeAutoOpenSend?: () => void;
}) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  // Kanal aktif untuk dialog verifikasi: default WA (tombol Kirim di kartu),
  // dapat di-override oleh deep-link `send=chat` dari Beranda.
  const [dialogChannel, setDialogChannel] = useState<"whatsapp" | "chat">("whatsapp");
  // Auto-buka dialog verifikasi bila datang dari deep-link `send=1`. Dikonsumsi
  // sekali supaya tidak re-trigger saat kartu di-remount / user menutup dialog.
  useEffect(() => {
    if (!autoOpenSend) return;
    if (isSentPrep(prep)) return;
    setDialogChannel(autoOpenSendChannel ?? "whatsapp");
    setSendOpen(true);
    onConsumeAutoOpenSend?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenSend]);
  // Kumpulkan semua path foto (photo_path lama + photo_paths[] baru), dedup.
  const photoPaths = useMemo(() => {
    const all = [prep.photo_path, ...(prep.photo_paths ?? [])].filter((x): x is string => !!x);
    return Array.from(new Set(all));
  }, [prep.photo_path, prep.photo_paths]);
  useEffect(() => { requestSignedUrl(photoPaths[0] ?? null, 60 * 60).then(setPhoto); }, [photoPaths]);
  const sold = isSentPrep(prep);
  const unitFor = (wid: string) => {
    const w = warehouseItems.find((x) => x.id === wid);
    const ti = titleItems.find((t) => t.warehouse_item_id === wid);
    return displayUnit(w?.name, ti?.unit_label ?? w?.base_unit ?? "g");
  };
  return (
    <div
      className={
        "overflow-hidden rounded-xl border bg-card" +
        (sold ? " select-text" : "")
      }
      aria-readonly={sold || undefined}
      data-readonly={sold ? "true" : undefined}
    >
      <div className="flex items-center justify-between gap-ms-2 border-b bg-muted/30 px-ms-3 py-1.5">
        <div className="min-w-0 truncate text-ms-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          Paket #{index} · {prep.created_by}
        </div>
        <div className="flex shrink-0 items-center gap-ms-1">
          {!sold ? (
            <button
              onClick={() => { setDialogChannel("whatsapp"); setSendOpen(true); }}
              className="inline-flex items-center gap-ms-1 rounded-md border border-[#25D366]/40 bg-[#25D366]/15 px-ms-2 py-1 text-ms-2xs font-semibold text-[#0b6b3a] hover:bg-[#25D366]/25 dark:text-[#7ee2a8]"
              aria-label="Kirim ke pelanggan"
              title="Kirim foto + tagihan ke pelanggan (potong stok & catat piutang bila hutang)"
            >
              <Send className="h-3 w-3" /> Kirim
            </button>
          ) : (
            <span className="inline-flex items-center gap-ms-1 rounded-md border border-success/40 bg-success/10 px-ms-2 py-1 text-ms-2xs font-semibold text-success dark:text-success">
              <CheckCircle2 className="h-3 w-3" /> Terkirim
            </span>
          )}
          {!sold && (
            <button
              onClick={onDelete}
              className="rounded-md border border-destructive/40 bg-destructive/10 p-ms-1 text-destructive hover:bg-destructive/20"
              aria-label="Hapus penyiapan"
              title="Hapus penyiapan"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {photo ? (
        <img src={photo} alt="" className="aspect-square w-full object-cover" />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center bg-muted text-ms-xs text-muted-foreground">No photo</div>
      )}
      <div className="space-y-1.5 p-ms-3 text-ms-2xs">
        {sold && (
          <div className="rounded-md border border-success/30 bg-success/5 p-ms-2 text-ms-2xs text-success dark:text-success space-y-0.5">
            <div className="flex items-center gap-ms-1 font-semibold">
              {prep.sold_payment_method === "kas" ? <Wallet className="h-3 w-3" /> : <HandCoins className="h-3 w-3" />}
              {formatSoldPaymentSummary(
                prep.sold_payment_method,
                Number(prep.sold_total ?? 0),
                Number(prep.sold_paid_amount ?? 0),
              )}
            </div>
            <div className="text-success/80 dark:text-success/80">
              ke <b>{prep.sold_party_name ?? "-"}</b>
              {prep.sold_at && <> · {new Date(prep.sold_at).toLocaleString("id-ID")}</>}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-ms-1">
          {items.map((it) => {
            const w = warehouseItems.find((x) => x.id === it.warehouse_item_id);
            return (
              <span key={it.id} className="rounded bg-primary/10 px-1.5 py-0.5 text-ms-2xs font-medium text-primary">
                {w?.name ?? "?"} {it.actual_grams}{unitFor(it.warehouse_item_id)}
              </span>
            );
          })}
          {sold && items.length === 0 && (
            <span className="text-ms-2xs italic text-muted-foreground">Item sudah dikonversi ke penjualan</span>
          )}
        </div>
        {prep.location_url && (
          <a href={prep.location_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-ms-1 text-primary hover:underline">
            <MapPin className="h-3 w-3" /> Lokasi
          </a>
        )}
        {prep.note && <div className="text-muted-foreground">{prep.note}</div>}
        <div className="text-muted-foreground">{new Date(prep.created_at).toLocaleString("id-ID")}</div>
      </div>

      {/* Dialog Kirim hanya di-mount untuk paket yang belum terkirim, supaya
          tidak ada jalur (state stale, race, keyboard shortcut) yang bisa
          memicu proses kirim/ubah status pada paket Riwayat. */}
      {!sold && (
        <SendPrepToCustomerDialog
          open={sendOpen}
          onClose={() => setSendOpen(false)}
          channel={dialogChannel}
          prep={prep}
          items={items}
          warehouseItems={warehouseItems}
          titleItems={titleItems}
          titleName={titleName}
          customers={customers}
          photoPaths={photoPaths}
          unitFor={unitFor}
          onSent={() => { setSendOpen(false); onSent(); }}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// SendPrepToCustomerDialog
// Konversi 1 penyiapan request → penjualan + (opsional) piutang, lampirkan
// SEMUA foto ke pesan WhatsApp. Stok gudang aman: RPC atomik menghapus
// request_preparation_items (mengembalikan stok) lalu INSERT sales
// (memotong stok lagi). Bila metode = hutang, otomatis catat piutang di
// tabel debts terhubung ke customer_id.
// -----------------------------------------------------------------------
function SendPrepToCustomerDialog({
  open, onClose, channel = "whatsapp", prep, items, warehouseItems, titleItems, titleName,
  customers, photoPaths, unitFor, onSent,
}: {
  open: boolean;
  onClose: () => void;
  channel?: "whatsapp" | "chat";
  prep: RequestPreparation;
  items: Array<{ id: string; warehouse_item_id: string; actual_grams: number }>;
  warehouseItems: WarehouseItem[];
  titleItems: RequestTitleItem[];
  titleName: string;
  customers: CustomerRow[];
  photoPaths: string[];
  unitFor: (wid: string) => string;
  onSent: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sections: ScrollSection[] = [
    { id: "send-sec-ringkasan", label: "Ringkasan paket" },
    { id: "send-sec-pelanggan", label: "Pelanggan" },
    { id: "send-sec-harga", label: "Total harga" },
    { id: "send-sec-bayar", label: "Metode bayar" },
    { id: "send-sec-catatan", label: "Catatan" },
  ];
  const [mode, setMode] = useState<"link" | "manual">("link");
  const [customerId, setCustomerId] = useState<string>("");
  const [manualName, setManualName] = useState("");
  const [totalStr, setTotalStr] = useState("");
  const [payMethod, setPayMethod] = useState<"kas" | "hutang" | "partial">("kas");
  const [paidStr, setPaidStr] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // State kanal Chat MCM: dialog picker + percakapan yang dipilih user.
  // Hanya dipakai bila `channel === "chat"`.
  const [chatPickerOpen, setChatPickerOpen] = useState(false);
  const [chatConv, setChatConv] = useState<{ id: string; title: string } | null>(null);
  // Reset pilihan percakapan setiap kali dialog dibuka ulang / kanal berubah.
  useEffect(() => {
    if (open) { setChatConv(null); setChatPickerOpen(false); }
  }, [open, channel]);
  const [initialSnap, setInitialSnap] = useState<{ mode: "link" | "manual"; customerId: string; manualName: string; totalStr: string; payMethod: "kas" | "hutang" | "partial"; paidStr: string; note: string }>({ mode: "link", customerId: "", manualName: "", totalStr: "", payMethod: "kas", paidStr: "", note: "" });
  // Dibaca `useSaveStatusToast` saat saving → dirty (gagal kirim).
  const [sendError, setSendError] = useState<string | null>(null);

  // Reset saat dialog dibuka kembali.
  useEffect(() => {
    if (open) {
      const nextMode: "link" | "manual" = customers.length > 0 ? "link" : "manual";
      const nextCustomer = customers[0]?.id ?? "";
      const nextNote = prep.note ?? "";
      setMode(nextMode);
      setCustomerId(nextCustomer);
      setManualName("");
      setTotalStr("");
      setPayMethod("kas");
      setPaidStr("");
      setNote(nextNote);
      setInitialSnap({ mode: nextMode, customerId: nextCustomer, manualName: "", totalStr: "", payMethod: "kas", paidStr: "", note: nextNote });
    }
  }, [open, customers, prep.note]);

  const totalAmount = useMemo(() => {
    return parsePaymentAmountInput(totalStr);
  }, [totalStr]);

  const paidAmount = useMemo(() => {
    return parsePaymentAmountInput(paidStr);
  }, [paidStr]);
  const payment = useMemo(
    () => getPaymentBreakdown(payMethod, totalAmount, paidAmount),
    [payMethod, totalAmount, paidAmount],
  );
  const remaining = payment.remaining;
  const partialValid = payment.partialValid;

  const resolvedParty = useMemo(() => {
    if (mode === "link") {
      const c = customers.find((x) => x.id === customerId);
      return { id: c?.id ?? null, name: c?.name ?? "", contact: c?.contact ?? null };
    }
    return { id: null as string | null, name: manualName.trim(), contact: null as string | null };
  }, [mode, customerId, customers, manualName]);

  const totalQty = useMemo(() => items.reduce((s, it) => s + Number(it.actual_grams || 0), 0), [items]);
  const canSend = !!resolvedParty.name && totalAmount >= 0 && items.length > 0 && !busy && partialValid;
  const sendStatus = useSaveStatus({ mode, customerId, manualName, totalStr, payMethod, paidStr, note }, initialSnap, busy);
  useSaveStatusToast(sendStatus, {
    successMessage: "Terkirim",
    errorMessage: sendError,
  });

  function buildCaption(): string {
    const lines: string[] = [];
    lines.push(`*${titleName}*`);
    lines.push("");
    if (items.length > 0) {
      lines.push("Isi paket:");
      items.forEach((it) => {
        const w = warehouseItems.find((x) => x.id === it.warehouse_item_id);
        lines.push(`• ${w?.name ?? "?"} ${it.actual_grams}${unitFor(it.warehouse_item_id)}`);
      });
      lines.push("");
    }
    lines.push(`Total: *${formatPaymentRupiah(totalAmount)}*`);
    lines.push(...buildPaymentMessageLines(payment));
    if (resolvedParty.name) lines.push(`Untuk: ${resolvedParty.name}`);
    if (note.trim()) { lines.push(""); lines.push(`Catatan: ${note.trim()}`); }
    if (prep.location_url) {
      lines.push("");
      lines.push(`📍 Lokasi ambil:`);
      lines.push(prep.location_url);
    }
    lines.push("");
    lines.push("Terima kasih 🙏");
    return lines.join("\n");
  }

  async function fetchPhotoFiles(): Promise<File[]> {
    const files: File[] = [];
    for (let i = 0; i < photoPaths.length; i++) {
      const url = await requestSignedUrl(photoPaths[i], 60 * 10);
      if (!url) continue;
      const f = await urlToFile(url, `${(titleName || "paket").replace(/\W+/g, "-")}-${i + 1}.jpg`);
      if (f) files.push(f);
    }
    return files;
  }

  async function doSend(chosenConv?: { id: string; title: string }) {
    if (!canSend) return;
    if (!resolvedParty.name) { toast.error("Pilih atau isi nama pelanggan"); return; }
    if (totalAmount <= 0) {
      if (!confirm("Total belum diisi (Rp 0). Lanjutkan tanpa mencatat penjualan?")) return;
    }
    // Kanal Chat MCM: pastikan user memilih percakapan tujuan lebih dulu.
    // RPC pencatatan penjualan/piutang tidak dijalankan sampai target valid,
    // supaya tidak ada "tercatat tapi tidak terkirim".
    const conv = channel === "chat" ? (chosenConv ?? chatConv) : null;
    if (channel === "chat" && !conv) {
      setChatPickerOpen(true);
      return;
    }
    setSendError(null);
    setBusy(true);
    try {
      // 1) RPC atomik: hapus prep items (kembalikan stok) + catat sales + piutang.
      const { error: rpcErr } = await sb.rpc("send_request_prep_to_customer", {
        _prep_id: prep.id,
        _customer_id: resolvedParty.id,
        _party_name: resolvedParty.name,
        _total_amount: payment.total,
        _payment_method: payment.method,
        _note: note.trim() || null,
        _paid_amount: payment.method === "partial" ? payment.paid : null,
      });
      if (rpcErr) throw rpcErr;

      // Sabuk pengaman: broadcast agar ReadyRequestSection / ReadyEcerSection /
      // panel Piutang di /index refetch tanpa nunggu realtime. Amount = sisa
      // (0 kalau Lunas) — listener memakainya sebagai sinyal refresh.
      emitDebtTx({
        kind: "piutang",
        wasCash: payment.method === "kas",
        amount: payment.remaining,
        partyId: resolvedParty.id ?? null,
        at: Date.now(),
      });

      // Toast konfirmasi: penjualan (& piutang bila ada) sudah TERCATAT di
      // database. Tampilkan ringkasan total + metode bayar SEBELUM foto/pesan
      // dikirim ke pelanggan — supaya user punya bukti eksplisit bahwa
      // pencatatan sudah aman meski pengiriman pesan gagal di tengah jalan.
      const methodLabel =
        payment.method === "kas"
          ? "Lunas (kas)"
          : payment.method === "hutang"
            ? `Hutang penuh · piutang ${rupiah(payment.remaining)}`
            : `Dibayar ${rupiah(payment.paid)} · sisa piutang ${rupiah(payment.remaining)}`;
      const summaryLines = [
        `Pelanggan: ${resolvedParty.name}`,
        `Total: ${rupiah(payment.total)}`,
        `Metode: ${methodLabel}`,
        channel === "chat" && conv
          ? `Tujuan: MCM Chat → ${conv.title}`
          : `Tujuan: WhatsApp${resolvedParty.contact ? ` → ${resolvedParty.contact}` : ""}`,
      ].join("\n");
      toast.success(
        payment.method === "kas"
          ? "Penjualan tercatat — menyiapkan pesan…"
          : "Penjualan & piutang tercatat — menyiapkan pesan…",
        { description: summaryLines, duration: 6000 },
      );

      // 2) Kirim ke kanal terpilih dengan foto asli terlampir.
      const files = await fetchPhotoFiles();
      const text = buildCaption();
      if (channel === "chat" && conv) {
        const shots = files.map((f, i) => ({ id: `${prep.id}:${i}`, file: f }));
        const res = await shareToChat({
          conversationId: conv.id,
          caption: text,
          locationUrl: prep.location_url ?? null,
          shots,
        });
        if (res.status !== "shared") {
          throw new Error(res.error || "Gagal kirim ke MCM Chat");
        }
        toast.success(
          payment.method === "hutang"
            ? `Terkirim ke ${conv.title} — penjualan & piutang tercatat`
            : payment.method === "partial"
              ? `Terkirim ke ${conv.title} — dibayar ${rupiah(payment.paid)}, sisa ${rupiah(payment.remaining)} jadi piutang`
              : `Terkirim ke ${conv.title} — penjualan tercatat, stok gudang tersinkron`,
        );
      } else {
        const phone = normalizePhone(resolvedParty.contact) ?? undefined;
        const res = await shareToWhatsApp({
          text,
          title: titleName,
          files,
          // Jika ada foto, jangan set phone → biar share sheet muncul & foto ikut.
          phone: files.length === 0 ? phone : undefined,
        });
        notifyShareResult(res);
        toast.success(
          payment.method === "hutang"
            ? "Terkirim — penjualan & piutang tercatat"
            : payment.method === "partial"
              ? `Terkirim — dibayar ${rupiah(payment.paid)}, sisa ${rupiah(payment.remaining)} jadi piutang`
              : "Terkirim — penjualan tercatat, stok gudang tersinkron",
        );
      }
      onSent();
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? String(e);
      setSendError("Gagal kirim: " + msg);
    } finally {
      setBusy(false);
    }
  }
  const handleSend = () => { void doSend(); };

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => { if (!v && !busy && confirmDiscardIfDirty(sendStatus)) onClose(); }}>
      <DialogContent ref={scrollRef} className="sm:max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader className="sticky top-0 z-10 -mx-6 -mt-6 border-b bg-background px-ms-6 pt-6 pb-3">
          <div className="flex items-start justify-between gap-ms-2">
            <DialogTitle className="flex items-center gap-ms-2 text-ms-base">
              {channel === "chat" ? <MessageCircle className="h-4 w-4 text-primary" /> : <Send className="h-4 w-4 text-primary" />}
              {channel === "chat" ? "Kirim via MCM Chat" : "Kirim ke pelanggan"}
            </DialogTitle>
            <DialogSaveStatus status={sendStatus} className="shrink-0" />
          </div>
          <DialogDescription>
            {channel === "chat"
              ? "Foto + lokasi dikirim ke percakapan MCM. Stok gudang & piutang otomatis tercatat."
              : "Foto ikut terkirim. Stok gudang & piutang otomatis diperbarui."}
          </DialogDescription>
          <DialogScrollProgress containerRef={scrollRef} sections={sections} className="mt-2" />
        </DialogHeader>

        <div className="space-ms-3 text-ms-xs">
          {/* Ringkasan item */}
          <div id="send-sec-ringkasan" className="rounded-md border bg-muted/30 p-ms-2">
            <div className="mb-1 font-semibold">{titleName}</div>
            <div className="flex flex-wrap gap-ms-1">
              {items.map((it) => {
                const w = warehouseItems.find((x) => x.id === it.warehouse_item_id);
                return (
                  <span key={it.id} className="rounded bg-primary/10 px-1.5 py-0.5 text-ms-2xs font-medium text-primary">
                    {w?.name ?? "?"} {it.actual_grams}{unitFor(it.warehouse_item_id)}
                  </span>
                );
              })}
            </div>
            <div className="mt-1 text-ms-2xs text-muted-foreground">
              {photoPaths.length > 0
                ? `${photoPaths.length} foto akan dilampirkan`
                : "Tidak ada foto pada paket ini"}
              {totalQty > 0 && ` · total qty ${totalQty}`}
            </div>
          </div>

          {/* Pelanggan */}
          <Field id="send-sec-pelanggan" label="Pelanggan" size="compact">
            <div className="flex gap-ms-1 text-ms-2xs">
              <button
                type="button"
                onClick={() => setMode("link")}
                disabled={customers.length === 0}
                className={`flex-1 rounded-md border px-ms-2 py-1 ${mode === "link" ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"} ${customers.length === 0 ? "opacity-40" : ""}`}
              >
                Dari buku alamat
              </button>
              <button
                type="button"
                onClick={() => setMode("manual")}
                className={`flex-1 rounded-md border px-ms-2 py-1 ${mode === "manual" ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`}
              >
                Ketik nama
              </button>
            </div>
            {mode === "link" ? (
              customers.length === 0 ? (
                <div className="text-ms-2xs text-muted-foreground">
                  Belum ada pelanggan tersimpan. Pilih "Ketik nama" atau tambah di menu Hutang-Piutang.
                </div>
              ) : (
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="h-9 w-full rounded-md border bg-card px-ms-2 text-ms-xs"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.contact ? ` · ${c.contact}` : ""}
                    </option>
                  ))}
                </select>
              )
            ) : (
              <Input
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="Nama pelanggan"
                className="h-9 text-ms-xs"
              />
            )}
          </Field>

          {/* Total */}
          <Field
            id="send-sec-harga"
            label="Total harga (Rp)"
            size="compact"
            hint={totalAmount > 0 ? `= ${rupiah(totalAmount)}` : undefined}
          >
            <Input
              value={totalStr}
              onChange={(e) => setTotalStr(e.target.value)}
              placeholder="Contoh: 25000"
              inputMode="numeric"
              className="h-9 tabular-nums text-ms-xs"
            />
          </Field>

          {/* Metode bayar */}
          <Field id="send-sec-bayar" label="Metode bayar" size="compact">
            <div className="flex gap-ms-1">
              <button
                type="button"
                onClick={() => setPayMethod("kas")}
                className={`flex flex-1 items-center justify-center gap-ms-1 rounded-md border px-ms-2 py-1.5 text-ms-xs ${payMethod === "kas" ? "border-primary bg-primary/10 text-primary font-semibold" : "hover:bg-accent"}`}
              >
                <Wallet className="h-3.5 w-3.5" /> Lunas (kas)
              </button>
              <button
                type="button"
                onClick={() => setPayMethod("hutang")}
                className={`flex flex-1 items-center justify-center gap-ms-1 rounded-md border px-ms-2 py-1.5 text-ms-xs ${payMethod === "hutang" ? "border-primary bg-primary/10 text-primary font-semibold" : "hover:bg-accent"}`}
              >
                <HandCoins className="h-3.5 w-3.5" /> Hutang (piutang)
              </button>
              <button
                type="button"
                onClick={() => setPayMethod("partial")}
                className={`flex flex-1 items-center justify-center gap-ms-1 rounded-md border px-ms-2 py-1.5 text-ms-xs ${payMethod === "partial" ? "border-primary bg-primary/10 text-primary font-semibold" : "hover:bg-accent"}`}
              >
                <HandCoins className="h-3.5 w-3.5" /> Bayar sebagian
              </button>
            </div>
            {payMethod === "partial" && (
              <div className="mt-2 space-y-1">
                <label className="text-ms-2xs text-muted-foreground">Dibayar sekarang (Rp)</label>
                <Input
                  value={paidStr}
                  onChange={(e) => setPaidStr(e.target.value)}
                  placeholder="Contoh: 10000"
                  inputMode="numeric"
                  className="h-9 tabular-nums text-ms-xs"
                />
                <div className="text-ms-2xs text-muted-foreground">
                  {paidAmount > 0 && totalAmount > 0
                    ? paidAmount >= totalAmount
                      ? <span className="text-destructive">Dibayar tidak boleh ≥ total. Pilih Lunas.</span>
                      : <>Sisa {rupiah(remaining)} akan dicatat sebagai piutang atas <b>{resolvedParty.name || "-"}</b>.</>
                    : "Isi jumlah yang dibayar sekarang; sisanya masuk piutang."}
                </div>
              </div>
            )}
            {payMethod === "hutang" && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-ms-1.5 text-ms-2xs text-warning dark:text-warning">
                Akan otomatis dicatat sebagai piutang di menu Hutang-Piutang atas nama <b>{resolvedParty.name || "-"}</b>.
              </div>
            )}
          </Field>

          {/* Catatan */}
          <Field id="send-sec-catatan" label="Catatan (opsional)" size="compact">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="text-ms-xs"
              placeholder="Mis. antar sore, titip di warung, dsb."
            />
          </Field>
        </div>

        <DialogFooter className="sticky bottom-0 z-10 -mx-6 -mb-6 flex-col gap-ms-2 border-t bg-background px-ms-6 py-ms-3 sm:flex-col">
          <div className="flex w-full items-center justify-center">
            <DialogSaveStatus status={sendStatus} compact />
          </div>
          <div className="grid w-full grid-cols-1 gap-ms-2.5 sm:grid-cols-2 sm:gap-ms-2 [&>*]:min-h-11 sm:[&>*]:min-h-9">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Batal</Button>
            <Button size="sm" onClick={handleSend} disabled={!canSend}>
              {busy
                ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                : channel === "chat"
                  ? <MessageCircle className="mr-1 h-3.5 w-3.5" />
                  : <Send className="mr-1 h-3.5 w-3.5" />}
              {channel === "chat" ? "Kirim Chat & " : "Kirim & "}
              {payMethod === "hutang"
                ? "catat piutang"
                : payMethod === "partial"
                  ? "catat sebagian piutang"
                  : "catat penjualan"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {channel === "chat" && (
      <PickChatConversationDialog
        open={chatPickerOpen}
        onOpenChange={setChatPickerOpen}
        title="Pilih percakapan tujuan"
        onPick={(id, dispTitle) => {
          const picked = { id, title: dispTitle };
          setChatConv(picked);
          setChatPickerOpen(false);
          // Lanjutkan alur kirim dengan tujuan yang baru dipilih; RPC & share
          // dijalankan setelah picker ditutup supaya state tidak stale.
          void doSend(picked);
        }}
      />
    )}
    </>
  );
}

function PrepEditorDialog({
  open, title, titleItems, warehouseItems, onClose, onSaved,
}: {
  open: boolean;
  title: RequestTitle;
  titleItems: RequestTitleItem[];
  warehouseItems: WarehouseItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sections: ScrollSection[] = [
    { id: "prep-sec-produk", label: "Produk & jumlah aktual" },
    { id: "prep-sec-foto", label: "Foto bukti" },
    { id: "prep-sec-lokasi", label: "Lokasi & catatan" },
    { id: "prep-sec-tujuan", label: "Tujuan pengiriman" },
  ];
  const [rows, setRows] = useState<Array<{ warehouse_item_id: string; actual_grams: string }>>([]);
  const [initialRows, setInitialRows] = useState<Array<{ warehouse_item_id: string; actual_grams: string }>>([]);
  const [photo, setPhoto] = useState<{ blob: Blob; dataUrl: string } | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSrc, setEditorSrc] = useState<string | null>(null);
  const [locUrl, setLocUrl] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [note, setNote] = useState("");
  const [waPhone, setWaPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const [qtyErrors, setQtyErrors] = useState<Record<number, string>>({});
  // Kontak & autocomplete
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<AddressBookRow[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);
  // linked_user_id yang dipilih dari kontak — dipakai untuk start_dm.
  const [pickedLinkedUserId, setPickedLinkedUserId] = useState<string | null>(null);
  const [pickedName, setPickedName] = useState<string>("");
  // Simpan ke buku alamat otomatis saat kirim berhasil (default on).
  const [autoSaveContact, setAutoSaveContact] = useState(true);
  // Nama tujuan (untuk buku alamat) — di-prefill saat memilih kontak,
  // bisa juga diisi manual sebelum submit.
  const [recipientName, setRecipientName] = useState("");
  // Snapshot awal untuk indikator "Tersimpan / Perubahan belum tersimpan".
  // photoKey = "" saat belum ada foto, dataUrl saat sudah ada — cukup untuk
  // deteksi dirty tanpa membandingkan blob besar.
  const [initialFieldsSnap, setInitialFieldsSnap] = useState<{ photoKey: string; locUrl: string; note: string; waPhone: string; recipientName: string }>({ photoKey: "", locUrl: "", note: "", waPhone: "", recipientName: "" });
  // Dibaca `useSaveStatusToast` saat saving → dirty (gagal simpan).
  const [prepError, setPrepError] = useState<string | null>(null);

  function sanitizeActual(idx: number, raw: string): string {
    if (raw === "") {
      setQtyErrors((e) => { const c = { ...e }; delete c[idx]; return c; });
      return raw;
    }
    if (raw === "-") {
      setQtyErrors((e) => ({ ...e, [idx]: "Jumlah tidak boleh negatif. Minimum 0." }));
      toast.error("Jumlah tidak boleh negatif");
      return "0";
    }
    const n = Number(raw);
    if (Number.isFinite(n) && n < 0) {
      setQtyErrors((e) => ({ ...e, [idx]: "Jumlah tidak boleh negatif. Minimum 0." }));
      toast.error("Jumlah tidak boleh negatif");
      return "0";
    }
    setQtyErrors((e) => { const c = { ...e }; delete c[idx]; return c; });
    return raw;
  }

  /**
   * Normalisasi nomor WA ke format E.164 digit-only (tanpa "+").
   * - Hapus semua karakter non-digit (spasi, "-", "()", "+", dst).
   * - Awalan "00" (mis. 0062…) → buang prefix internasional 00.
   * - Awalan "0" lokal Indonesia (mis. 0812…) → ganti jadi "62".
   * Mengembalikan { digits, error }. digits = "" bila tidak valid.
   */
  function normalizeWaPhone(raw: string): { digits: string; error: string | null } {
    let d = (raw || "").replace(/\D/g, "");
    if (!d) return { digits: "", error: "Nomor MCM wajib diisi" };
    if (d.startsWith("00")) d = d.slice(2);
    else if (d.startsWith("0")) d = "62" + d.slice(1);
    if (d.length < 8 || d.length > 15) {
      return { digits: "", error: "Nomor MCM harus 8–15 digit (format internasional)" };
    }
    if (/^0+$/.test(d)) return { digits: "", error: "Nomor MCM tidak valid" };
    return { digits: d, error: null };
  }

  const waNorm = normalizeWaPhone(waPhone);

  useEffect(() => {
    if (!open) return;
    const init = titleItems.map((i) => ({ warehouse_item_id: i.warehouse_item_id, actual_grams: String(i.target_grams) }));
    setRows(init);
    setInitialRows(init);
    setPhoto(null); setLocUrl(""); setGps(null); setNote(""); setWaPhone("");
    setPickedLinkedUserId(null); setPickedName(""); setRecipientName("");
    setShowSuggest(false);
    setInitialFieldsSnap({ photoKey: "", locUrl: "", note: "", waPhone: "", recipientName: "" });
  }, [open, titleItems]);

  // Muat buku alamat saat dialog dibuka — dipakai untuk autocomplete
  // tujuan (baik nomor WA maupun user MCM lewat linked_user_id).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setContactsLoading(true);
    fetchAddressBook()
      .then((rows) => { if (!cancelled) setContacts(rows); })
      .catch(() => { /* diam-diam — autocomplete opsional */ })
      .finally(() => { if (!cancelled) setContactsLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  // Filter kontak berdasarkan input (nama / phone / phone_norm).
  const suggestList = useMemo(() => {
    const q = waPhone.trim().toLowerCase();
    const nq = normalizePhone(waPhone) ?? "";
    const base = contacts.slice().sort((a, b) => {
      // Kontak dengan linked_user_id (bisa Chat MCM) di atas.
      const la = a.linked_user_id ? 0 : 1;
      const lb = b.linked_user_id ? 0 : 1;
      if (la !== lb) return la - lb;
      return a.name.localeCompare(b.name);
    });
    if (!q) return base.slice(0, 8);
    return base
      .filter((r) =>
        r.name.toLowerCase().includes(q) ||
        (r.phone ?? "").toLowerCase().includes(q) ||
        (r.phone_norm ?? "").includes(nq),
      )
      .slice(0, 8);
  }, [contacts, waPhone]);

  function pickContact(row: AddressBookRow) {
    if (row.phone) setWaPhone(row.phone);
    setPickedLinkedUserId(row.linked_user_id);
    setPickedName(row.name);
    setRecipientName(row.name);
    setShowSuggest(false);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    const dataUrl = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f); });
    setEditorSrc(dataUrl); setEditorOpen(true);
    if (!gps && !locUrl && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setLocUrl(`https://www.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}`);
        },
        () => {},
        { enableHighAccuracy: true, timeout: 10000 },
      );
    }
  }

  function takeLocation() {
    if (!navigator.geolocation) { toast.error("GPS tidak tersedia"); return; }
    const id = toast.loading("Mengambil lokasi…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocUrl(`https://www.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}`);
        toast.success("Lokasi terisi", { id });
      },
      (err) => toast.error("Gagal: " + err.message, { id }),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function buildMessage() {
    const lines: string[] = [];
    lines.push(`*Penyiapan — ${title.name}*`);
    lines.push("");
    lines.push("Isi paket:");
    rows.forEach((r) => {
      const w = warehouseItems.find((x) => x.id === r.warehouse_item_id);
      const ti = titleItems.find((t) => t.warehouse_item_id === r.warehouse_item_id);
      const g = Number(r.actual_grams);
      if (w && g > 0) lines.push(`• ${w.name}: ${g} ${displayUnit(w.name, ti?.unit_label ?? w.base_unit)}`);
    });
    if (note.trim()) { lines.push(""); lines.push(`Catatan: ${note.trim()}`); }
    if (locUrl.trim()) { lines.push(""); lines.push(`Lokasi: ${locUrl.trim()}`); }
    return lines.join("\n");
  }

  async function save(opts?: { sendWa?: boolean; sendChat?: boolean }) {
    if (!photo) { toast.error("Wajib lampirkan foto"); return; }
    if (Object.keys(qtyErrors).length > 0 || rows.some((r) => r.actual_grams !== "" && Number(r.actual_grams) < 0)) {
      toast.error("Jumlah tidak boleh negatif. Perbaiki dulu."); return;
    }
    const validRows = rows.filter((r) => r.warehouse_item_id && Number(r.actual_grams) > 0);
    if (validRows.length === 0) { toast.error("Minimal 1 produk dengan gram > 0"); return; }
    let normalizedPhone = "";
    if (opts?.sendWa) {
      const n = normalizeWaPhone(waPhone);
      if (n.error) { toast.error(n.error); return; }
      normalizedPhone = n.digits;
    }
    if (opts?.sendChat) {
      if (!pickedLinkedUserId) {
        toast.error("Pilih kontak MCM dari daftar dulu untuk kirim via Chat");
        return;
      }
    }
    setPrepError(null);
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Belum login");
      const photoPath = await uploadRequestPhoto(uid, title.id, photo.blob);
      if (!photoPath) throw new Error("Upload foto gagal");
      const { data: prep, error } = await sb.from("request_preparations").insert({
        user_id: uid, title_id: title.id, photo_path: photoPath,
        location_url: locUrl.trim() || null,
        gps_lat: gps?.lat ?? null, gps_lng: gps?.lng ?? null,
        note: note.trim() || null, created_by: "admin",
      }).select("id").single();
      if (error) throw error;
      const payload = validRows.map((r) => ({
        preparation_id: prep.id,
        user_id: uid,
        warehouse_item_id: r.warehouse_item_id,
        actual_grams: Number(r.actual_grams),
      }));
      const { error: e2 } = await sb.from("request_preparation_items").insert(payload);
      if (e2) {
        await deleteRequestPhoto(photoPath);
        await sb.from("request_preparations").delete().eq("id", prep.id);
        throw e2;
      }
      toast.success("Penyiapan tersimpan, stok dikurangi");
      if (opts?.sendWa) {
        try {
          const file = new File([photo.blob], `penyiapan-${title.name}.jpg`, { type: photo.blob.type || "image/jpeg" });
          const res = await shareToWhatsApp({
            text: buildMessage(),
            title: `Penyiapan ${title.name}`,
            phone: normalizedPhone,
            files: [file],
          });
          notifyShareResult(res);
        } catch (err) {
          toast.error("Gagal kirim via MCM: " + (err as Error).message);
        }
      }
      // Simpan otomatis ke buku alamat bila di-opt-in dan kontak yang
      // dipakai belum ada rownya. Berlaku untuk WA (pakai nomor yang
      // ternormalisasi) maupun Chat MCM (pakai pickedLinkedUserId).
      if (autoSaveContact && (opts?.sendWa || opts?.sendChat)) {
        try {
          const nameForSave = (recipientName.trim() || pickedName.trim() || "").slice(0, 80);
          const phoneForSave = opts?.sendWa ? normalizedPhone : (waPhone.trim() || "");
          const phoneNorm = normalizePhone(phoneForSave);
          const alreadyExists = contacts.some((c) =>
            (pickedLinkedUserId && c.linked_user_id === pickedLinkedUserId) ||
            (phoneNorm && c.phone_norm === phoneNorm),
          );
          if (!alreadyExists && (nameForSave || phoneForSave)) {
            await upsertManualEntry({
              name: nameForSave || (phoneForSave ? `+${phoneForSave}` : "Tanpa nama"),
              phone: phoneForSave || null,
            });
          }
        } catch { /* opsional — jangan gagalkan flow utama */ }
      }
      // Kirim via Chat MCM: buka DM dengan text prefill di composer.
      // Foto sudah tersimpan di storage prep — sertakan signed URL supaya
      // pengguna tinggal tekan Send.
      if (opts?.sendChat && pickedLinkedUserId) {
        try {
          const { data: convId, error: dmErr } = await sb.rpc("start_dm", { _partner: pickedLinkedUserId });
          if (dmErr) throw dmErr;
          // C2: Auto-link chat ke request preparation supaya percakapan tercatat
          // dalam konteks pesanan (bukan DM lepas).
          try {
            await sb.rpc("chat_link_business", {
              _conv: String(convId),
              _kind: "request_prep",
              _id: prep.id,
            });
          } catch (linkErr) {
            console.warn("[chat] link business failed:", linkErr);
          }
          const photoSigned = await requestSignedUrl(photoPath, 60 * 60 * 24);
          const prefillText = [buildMessage(), photoSigned ? `Foto: ${photoSigned}` : ""].filter(Boolean).join("\n");
          try {
            window.localStorage.setItem(`mcm.chat.prefill.${convId}`, prefillText);
          } catch { /* ignore quota */ }
          onSaved(); onClose();
          navigate({ to: "/chat/$conversationId", params: { conversationId: String(convId) } });
          return;
        } catch (err) {
          toast.error("Gagal buka Chat MCM: " + (err as Error).message);
        }
      }
      onSaved(); onClose();
    } catch (e) {
      setPrepError("Gagal: " + (e as Error).message);
    } finally { setBusy(false); }
  }

  const prepStatus = useSaveStatus(
    { rows, photoKey: photo?.dataUrl ?? "", locUrl, note, waPhone, recipientName },
    { rows: initialRows, ...initialFieldsSnap },
    busy,
  );
  useSaveStatusToast(prepStatus, {
    successMessage: "Penyiapan tersimpan",
    errorMessage: prepError,
  });

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => { if (!o && !editorOpen && confirmDiscardIfDirty(prepStatus)) onClose(); }}>
      <DialogContent
        ref={scrollRef}
        className="max-h-[90vh] max-w-md overflow-y-auto"
        onInteractOutside={(event) => {
          if (editorOpen) event.preventDefault();
        }}
      >
        <DialogHeader className="sticky top-0 z-10 -mx-6 -mt-6 border-b bg-background px-ms-6 pt-6 pb-3">
          <div className="flex items-start justify-between gap-ms-2">
            <DialogTitle>Penyiapan Baru — {title.name}</DialogTitle>
            <DialogSaveStatus status={prepStatus} className="shrink-0" />
          </div>
          <DialogDescription>Atur jumlah aktual tiap produk, lampirkan 1 foto bukti + lokasi.</DialogDescription>
          <DialogScrollProgress containerRef={scrollRef} sections={sections} className="mt-2" />
        </DialogHeader>
        <div className="space-ms-3">
          <div id="prep-sec-produk">
            <Label>Produk &amp; jumlah aktual</Label>
            <div className="space-y-1.5">
              {rows.map((r, idx) => {
                const w = warehouseItems.find((x) => x.id === r.warehouse_item_id);
                const ti = titleItems.find((t) => t.warehouse_item_id === r.warehouse_item_id);
                const unit = displayUnit(w?.name, ti?.unit_label ?? w?.base_unit ?? "g");
                return (
                  // L9: stack di 411px agar nama produk tidak dipotong;
                  // qty + satuan berjajar di baris kedua.
                  <div key={idx} className="grid grid-cols-12 gap-ms-1.5">
                    <div className="col-span-12 sm:col-span-7 flex min-w-0 items-center rounded-md border bg-muted/30 px-ms-2 py-1.5 sm:py-0 text-ms-xs">
                      <span className="truncate">{w?.name ?? "?"}</span>
                    </div>
                    <Input
                      type="number" inputMode="decimal" step="any" min="0"
                      value={r.actual_grams}
                      onChange={(e) => setRows((rs) => rs.map((x, i) => i === idx ? { ...x, actual_grams: e.target.value } : x))}
                      className="col-span-8 sm:col-span-3 h-9 text-ms-xs"
                    />
                    <div className="col-span-4 sm:col-span-2 flex min-w-0 items-center justify-center rounded-md border bg-muted/30 px-1 text-ms-2xs font-medium text-muted-foreground">
                      <span className="truncate">{unit}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {(() => {
            const totals = new Map<string, number>();
            const details: Array<{ idx: number; name: string; qty: number; unit: string }> = [];
            rows.forEach((r) => {
              const g = Number(r.actual_grams);
              if (!r.warehouse_item_id || !(g > 0)) return;
              const w = warehouseItems.find((x) => x.id === r.warehouse_item_id);
              const ti = titleItems.find((t) => t.warehouse_item_id === r.warehouse_item_id);
              const unit = displayUnit(w?.name, ti?.unit_label ?? w?.base_unit ?? "g");
              totals.set(unit, (totals.get(unit) ?? 0) + g);
              const idx = rows.indexOf(r);
              details.push({ idx, name: w?.name ?? "?", qty: g, unit });
            });
            if (totals.size === 0) return null;
            return (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-ms-2 text-ms-2xs">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-semibold text-primary">Preview total</span>
                  {(() => {
                    const changed = rows.some((r, i) => (initialRows[i]?.actual_grams ?? "") !== r.actual_grams);
                    return (
                      <button
                        type="button"
                        onClick={() => setRows(initialRows.map((r) => ({ ...r })))}
                        disabled={!changed}
                        className="rounded border bg-background px-1.5 py-0.5 text-ms-2xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-40"
                      >
                        Reset ke awal
                      </button>
                    );
                  })()}
                </div>
                <div className="flex flex-wrap gap-ms-1.5">
                  {Array.from(totals.entries()).map(([unit, sum]) => (
                    <span key={unit} className="rounded bg-background px-1.5 py-0.5 font-medium">
                      {sum} {unit}
                    </span>
                  ))}
                </div>
                <ul className="mt-1.5 space-y-1 border-t border-primary/20 pt-1.5 text-muted-foreground">
                  {details.map((d) => (
                    <li key={d.idx} className="flex items-center justify-between gap-ms-2">
                      <span className="truncate">{d.name}</span>
                      <div className="flex items-center gap-ms-1">
                        <Input
                          type="number" inputMode="decimal" step="any" min="0"
                          value={rows[d.idx]?.actual_grams ?? ""}
                          onChange={(e) => {
                            const v = sanitizeActual(d.idx, e.target.value);
                            setRows((rs) => rs.map((x, i) => i === d.idx ? { ...x, actual_grams: v } : x));
                          }}
                          className="h-7 w-20 px-1.5 text-right text-ms-2xs font-mono tabular-nums"
                        />
                        <span className="w-10 text-left text-ms-2xs">{d.unit}</span>
                      </div>
                    </li>
                  ))}
                </ul>
                {Object.keys(qtyErrors).length > 0 ? (
                  <p className="mt-1.5 rounded border border-destructive/40 bg-destructive/10 px-1.5 py-1 text-ms-2xs font-medium text-destructive">
                    Jumlah tidak boleh negatif. Minimum 0.
                  </p>
                ) : null}
              </div>
            );
          })()}

          {photo ? (
            <div id="prep-sec-foto">
              <img src={photo.dataUrl} alt="" className="w-full rounded-lg border object-cover" />
              <div className="mt-1 flex gap-ms-2">
                <Button size="sm" variant="outline" onClick={() => { setEditorSrc(photo.dataUrl); setEditorOpen(true); }}>
                  <Edit3 className="mr-1 h-3 w-3" /> Edit
                </Button>
                <Button size="sm" variant="outline" className="text-destructive" onClick={() => setPhoto(null)}>Hapus</Button>
              </div>
            </div>
          ) : (
            <div id="prep-sec-foto" className="grid grid-cols-1 gap-ms-2.5 sm:grid-cols-2 sm:gap-ms-2 [&>*]:min-h-11 sm:[&>*]:min-h-10">
              <Button variant="outline" onClick={() => cameraRef.current?.click()}>
                <Camera className="mr-1 h-4 w-4" /> Kamera
              </Button>
              <Button variant="outline" onClick={() => galleryRef.current?.click()}>
                <ImageIcon className="mr-1 h-4 w-4" /> Galeri
              </Button>
            </div>
          )}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
          <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={onFile} />

          <div id="prep-sec-lokasi" className="flex gap-ms-2">
            <Input value={locUrl} onChange={(e) => setLocUrl(e.target.value)} placeholder="Link Google Maps (opsional)" className="flex-1" />
            <Button variant="outline" onClick={takeLocation}>
              <MapPin className="mr-1 h-4 w-4" /> GPS
            </Button>
          </div>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan (opsional)" />

          <div id="prep-sec-tujuan" className="space-ms-2">
            <Label className="text-ms-xs">Tujuan (Chat MCM / Nomor WA)</Label>
            {/* Nama penerima — dipakai untuk auto-save ke buku alamat */}
            <Input
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="Nama penerima (opsional, untuk simpan otomatis)"
              className="text-ms-xs"
            />
            <div className="relative">
              <Input
                type="tel"
                inputMode="tel"
                value={waPhone}
                onChange={(e) => {
                  setWaPhone(e.target.value);
                  setShowSuggest(true);
                  // Jika user mulai ubah nomor, reset user MCM yang di-pick
                  // supaya tombol Chat MCM tidak salah kirim ke akun lama.
                  if (pickedLinkedUserId) setPickedLinkedUserId(null);
                }}
                onFocus={() => setShowSuggest(true)}
                onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
                placeholder={contactsLoading ? "Memuat kontak…" : "Cari kontak / cth: 628123456789"}
              />
              {showSuggest && suggestList.length > 0 ? (
                <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
                  {suggestList.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickContact(c)}
                      className="flex w-full items-start justify-between gap-ms-2 border-b px-ms-2 py-1.5 text-left text-ms-xs hover:bg-accent last:border-b-0"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{c.name}</div>
                        <div className="truncate font-mono text-ms-2xs text-muted-foreground">
                          {c.phone || "—"}
                        </div>
                      </div>
                      <div className="shrink-0 text-[9px] uppercase tracking-wide text-muted-foreground">
                        {c.linked_user_id ? "MCM" : c.source}
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {pickedLinkedUserId ? (
              <p className="text-ms-2xs text-primary">
                Kontak MCM terpilih: <span className="font-medium">{pickedName || "(tanpa nama)"}</span> — bisa kirim via Chat MCM.
              </p>
            ) : waPhone.trim() === "" ? (
              <p className="text-ms-2xs text-muted-foreground">Ketik untuk cari kontak, atau isi nomor manual (awalan 0 → 62).</p>
            ) : waNorm.error ? (
              <p className="text-ms-2xs text-destructive">{waNorm.error}</p>
            ) : (
              <p className="text-ms-2xs text-muted-foreground">Akan dikirim ke: <span className="font-mono">+{waNorm.digits}</span></p>
            )}
            <label className="flex items-center gap-ms-2 text-ms-2xs text-muted-foreground">
              <input
                type="checkbox"
                checked={autoSaveContact}
                onChange={(e) => setAutoSaveContact(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              Simpan kontak ke buku alamat saat kirim berhasil
            </label>
          </div>
        </div>
        <DialogFooter className="sticky bottom-0 z-10 -mx-6 -mb-6 flex-col gap-ms-2 border-t bg-background px-ms-6 py-ms-3 sm:flex-col">
          <div className="flex w-full items-center justify-center">
            <DialogSaveStatus status={prepStatus} compact />
          </div>
          <Button
            size="sm"
            onClick={() => save({ sendWa: true })}
            disabled={busy || !!waNorm.error}
            className="w-full"
          >
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Send className="mr-1 h-3 w-3" />}
            Simpan &amp; Kirim via WhatsApp
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => save({ sendChat: true })}
            disabled={busy || !pickedLinkedUserId}
            className="w-full"
            title={pickedLinkedUserId ? "Buka DM MCM dengan pesan siap kirim" : "Pilih kontak MCM dari daftar dulu"}
          >
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <MessageCircle className="mr-1 h-3 w-3" />}
            Simpan &amp; Buka Chat MCM
          </Button>
          <div className="grid w-full grid-cols-1 gap-ms-2.5 sm:grid-cols-2 sm:gap-ms-2 [&>*]:min-h-11 sm:[&>*]:min-h-9">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Batal</Button>
            <Button size="sm" onClick={() => save()} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null} Simpan
            </Button>
          </div>
        </DialogFooter>

      </DialogContent>
    </Dialog>
    {/* PhotoEditor di-hoist ke luar DialogContent agar `fixed inset-0`-nya
        mengacu ke viewport (bukan ke DialogContent yang memakai transform),
        sehingga editor selalu tampil full-screen setelah file dipilih. */}
    {editorOpen && editorSrc && (
      <PhotoEditor
        src={editorSrc}
        onCancel={() => setEditorOpen(false)}
        onSave={(blob, dataUrl) => { setPhoto({ blob, dataUrl }); setEditorOpen(false); }}
      />
    )}
    </>
  );
}
// ------------------------------------------------------------------
// Mode Uji Coba Alur Pegawai
// ------------------------------------------------------------------
function WorkerTestDialog({
  open, titles, titleItemsCount, onClose,
}: {
  open: boolean;
  titles: RequestTitle[];
  titleItemsCount: number;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<{ url: string; pin: string; token: string } | null>(null);
  const [copying, setCopying] = useState(false);
  const [pin, setPin] = useState("");

  useEffect(() => {
    if (!open) { setSession(null); setPin(""); }
  }, [open]);

  async function createSession() {
    if (titles.length === 0) { toast.error("Buat minimal 1 judul Request dulu"); return; }
    if (titleItemsCount === 0) { toast.error("Judul Request belum punya produk"); return; }
    const usePin = pin.trim().length >= 4 ? pin.trim() : String(Math.floor(1000 + Math.random() * 9000));
    setBusy(true);
    try {
      const token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((b) => b.toString(16).padStart(2, "0")).join("");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)("prep_create_task", {
        _title: "UJI COBA Alur Pegawai (Request)",
        _note: "Sesi uji coba — boleh dihapus kapan saja.",
        _pin: usePin,
        _share_token: token,
        _items: [],
      });
      if (error) throw error;
      const url = publicTaskUrl(token, usePin);
      setSession({ url, pin: usePin, token: String(data) });
      toast.success("Sesi uji coba siap. PIN: " + usePin);
    } catch (e) {
      toast.error("Gagal buat sesi: " + (e as Error).message);
    } finally { setBusy(false); }
  }

  async function copyAll() {
    if (!session || copying) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(`Link: ${session.url}\nPIN: ${session.pin}`);
      toast.success("Link + PIN disalin", { description: "Sekarang bisa kirim ulang ke pegawai." });
    } catch (e) {
      toast.error("Gagal menyalin", { description: (e as Error)?.message ?? "Periksa izin clipboard." });
    } finally {
      setCopying(false);
    }
  }

  async function cancelSession() {
    if (!session) return;
    if (!confirm("Batalkan sesi uji coba? Semua paket Request yang dibuat lewat sesi ini akan dihapus dan stok dikembalikan.")) return;
    setBusy(true);
    try {
      // Ambil semua preparation yang dibuat via sesi uji ini, lalu hapus fotonya.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: preps } = await (supabase.from as any)("request_preparations")
        .select("id,photo_path").eq("via_task_id", session.token);
      const list = (preps ?? []) as Array<{ id: string; photo_path: string | null }>;
      for (const p of list) {
        if (p.photo_path) await deleteRequestPhoto(p.photo_path);
      }
      // Hapus preparations — trigger akan kembalikan stok via request_preparation_items ON DELETE.
      if (list.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase.from as any)("request_preparations")
          .delete().in("id", list.map((p) => p.id));
        if (error) throw error;
      }
      // Tutup tugas pegawai sementara (set status non-active dengan update share_token agar tidak bisa dipakai lagi).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from as any)("prep_tasks").update({ status: "cancelled" }).eq("id", session.token);
      toast.success(`Sesi dibatalkan. ${list.length} paket dihapus, stok dikembalikan.`);
      setSession(null);
    } catch (e) {
      toast.error("Gagal batalkan: " + (e as Error).message);
    } finally { setBusy(false); }
  }

  const qrUrl = session ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(session.url)}` : "";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-ms-2">
            <FlaskConical className="h-4 w-4 text-primary" /> Uji Coba Alur Pegawai
          </DialogTitle>
          <DialogDescription>
            Buat tugas pegawai sementara untuk menguji: QR/PIN, pilih judul Request, input gram, foto + lokasi, dan kirim.
            Sesi aktif beberapa jam — tidak akan mengganggu data nyata.
          </DialogDescription>
        </DialogHeader>

        {!session ? (
          <div className="space-ms-3">
            <Field label="PIN uji coba (opsional, min 4 digit)" size="xs">
              <Input
                inputMode="numeric" maxLength={8}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder="Kosongkan untuk acak"
              />
            </Field>
            <div className="rounded-md border bg-muted/30 p-ms-2.5 text-ms-2xs text-muted-foreground">
              Pastikan sudah ada minimal 1 Judul Request dengan beberapa produk. Saat ini: <b>{titles.length} judul</b>.
            </div>
            <Button className="w-full" onClick={createSession} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-1 h-4 w-4" />}
              Mulai Uji Coba
            </Button>
          </div>
        ) : (
          <div className="space-ms-3">
            <div className="flex justify-center rounded-lg border bg-white p-ms-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrUrl} alt="QR uji coba" width={200} height={200} />
            </div>
            <div className="space-y-1.5">
              <div>
                <Label className="text-ms-2xs uppercase tracking-wide text-muted-foreground">Link</Label>
                <div className="break-all rounded-md border bg-muted/30 px-ms-2 py-1.5 text-ms-2xs font-mono">
                  {session.url}
                </div>
              </div>
              <div>
                <Label className="text-ms-2xs uppercase tracking-wide text-muted-foreground">PIN</Label>
                <div className="rounded-md border bg-muted/30 px-ms-2 py-1.5 text-center text-ms-lg font-bold tracking-[0.4em] tabular-nums">
                  {session.pin}
                </div>
              </div>
            </div>
            <div className="rounded-md border border-warning/40 bg-warning/5 p-ms-2.5 text-ms-2xs leading-relaxed text-warning dark:text-warning">
              <b>Tips uji:</b> Buka link di tab baru / HP, masukkan PIN, scroll ke <b>"Paket Request"</b>,
              pilih satu judul, isi gram tiap produk, ambil foto + lokasi, lalu Kirim.
              Stok produk akan benar-benar berkurang. Tekan <b>"Batalkan sesi uji coba"</b> untuk mengembalikan stok &amp; menghapus paket uji.
            </div>
            <div className="grid grid-cols-1 gap-ms-2.5 sm:grid-cols-2 sm:gap-ms-2 [&>*]:min-h-11 sm:[&>*]:min-h-9">
              <Button variant="outline" size="sm" onClick={copyAll} disabled={copying} aria-busy={copying}>
                {copying
                  ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  : <Copy className="mr-1 h-3.5 w-3.5" />}
                Salin Link+PIN
              </Button>
              <Button size="sm" asChild>
                <a href={session.url} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-1 h-3.5 w-3.5" /> Buka di Tab Baru
                </a>
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={cancelSession}
              disabled={busy}
            >
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1 h-3.5 w-3.5" />}
              Batalkan sesi uji coba (kembalikan stok)
            </Button>
            <Button variant="ghost" size="sm" className="w-full" onClick={() => setSession(null)} disabled={busy}>
              Buat sesi baru
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------
// Riwayat pengiriman link ke pegawai
// ------------------------------------------------------------------
type DeliveryRow = {
  id: string;
  task_id: string | null;
  title_id: string | null;
  title_name: string;
  worker_name: string;
  channel: "whatsapp" | "copy_message" | "copy_link_pin" | "download_png" | "download_pdf";
  sent_at: string;
};
type TaskStatusRow = {
  id: string;
  status: "active" | "done" | "cancelled" | "expired";
  expires_at: string;
  completed_at: string | null;
};

function channelLabel(c: DeliveryRow["channel"]): string {
  switch (c) {
    case "whatsapp": return "WhatsApp";
    case "copy_message": return "Salin pesan";
    case "copy_link_pin": return "Salin Link+PIN";
    case "download_png": return "Unduh PNG";
    case "download_pdf": return "Unduh PDF";
  }
}

function taskStatusLabel(t: TaskStatusRow | undefined): { label: string; tone: string } {
  if (!t) return { label: "Tugas dihapus", tone: "border-muted text-muted-foreground bg-muted/40" };
  const expired = t.status === "expired" || new Date(t.expires_at).getTime() < Date.now();
  if (t.status === "done") return { label: "Selesai", tone: "border-success/40 bg-success/10 text-success dark:text-success" };
  if (t.status === "cancelled") return { label: "Dibatalkan", tone: "border-destructive/40 bg-destructive/10 text-destructive" };
  if (expired) return { label: "Kedaluwarsa", tone: "border-warning/40 bg-warning/10 text-warning dark:text-warning" };
  return { label: "Menunggu", tone: "border-primary/40 bg-primary/10 text-primary" };
}

function formatWaktu(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function DeliveryHistoryDialog({
  target, onClose,
}: {
  target: RequestTitle | "all" | null;
  onClose: () => void;
}) {
  const open = !!target;
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [tasks, setTasks] = useState<Record<string, TaskStatusRow>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filterTitleId = target && target !== "all" ? target.id : null;
  const headerLabel = !target ? "" : target === "all" ? "semua judul" : target.name;

  async function load() {
    if (!open) return;
    setLoading(true);
    setError(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = (supabase.from as any)("prep_link_deliveries")
        .select("id, task_id, title_id, title_name, worker_name, channel, sent_at")
        .order("sent_at", { ascending: false })
        .limit(200);
      if (filterTitleId) q = q.eq("title_id", filterTitleId);
      const { data, error: e } = await q;
      if (e) throw e;
      const list: DeliveryRow[] = data ?? [];
      setRows(list);
      const taskIds = Array.from(new Set(list.map((r) => r.task_id).filter(Boolean))) as string[];
      if (taskIds.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: taskData, error: te } = await (supabase.from as any)("prep_tasks")
          .select("id, status, expires_at, completed_at")
          .in("id", taskIds);
        if (te) throw te;
        const map: Record<string, TaskStatusRow> = {};
        (taskData ?? []).forEach((t: TaskStatusRow) => { map[t.id] = t; });
        setTasks(map);
      } else {
        setTasks({});
      }
    } catch (e) {
      setError((e as Error).message ?? "Gagal memuat riwayat");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) { setRows([]); setTasks({}); setError(null); return; }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filterTitleId]);

  // Group per (task_id or synthetic key) to avoid noise when user hits multiple buttons
  const grouped = useMemo(() => {
    const map = new Map<string, { key: string; title_name: string; worker_name: string; task_id: string | null; entries: DeliveryRow[] }>();
    for (const r of rows) {
      const key = r.task_id ?? `no-task:${r.id}`;
      const existing = map.get(key);
      if (existing) {
        existing.entries.push(r);
      } else {
        map.set(key, { key, title_name: r.title_name, worker_name: r.worker_name, task_id: r.task_id, entries: [r] });
      }
    }
    return Array.from(map.values());
  }, [rows]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-ms-2">
            <History className="h-4 w-4 text-primary" /> Riwayat pengiriman link
          </DialogTitle>
          <DialogDescription className="min-w-0">
            Daftar pengiriman link tugas ke pegawai untuk{" "}
            <b className="inline-block min-w-0 max-w-full truncate align-bottom">{headerLabel}</b>
            . Status diambil dari tugas terkait.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-ms-2 py-10 text-ms-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat riwayat…
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-ms-3 text-ms-xs text-destructive">
            <div className="flex items-center gap-ms-1 font-semibold"><AlertTriangle className="h-3.5 w-3.5" /> Gagal memuat</div>
            <div className="mt-1 break-words">{error}</div>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => void load()}>
              <RotateCw className="mr-1 h-3.5 w-3.5" /> Coba lagi
            </Button>
          </div>
        ) : grouped.length === 0 ? (
          <div className="rounded-md border border-dashed bg-muted/30 p-ms-6 text-center text-ms-xs text-muted-foreground">
            Belum ada riwayat pengiriman.
          </div>
        ) : (
          <div className="max-h-[60vh] space-ms-2 overflow-y-auto pr-1">
            {grouped.map((g) => {
              const t = g.task_id ? tasks[g.task_id] : undefined;
              const status = taskStatusLabel(t);
              const firstSent = g.entries[g.entries.length - 1]?.sent_at ?? g.entries[0].sent_at;
              const lastSent = g.entries[0]?.sent_at;
              return (
                <div key={g.key} className="rounded-lg border bg-card p-ms-3 text-ms-xs">
                  <div className="flex items-start justify-between gap-ms-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-ms-sm">{g.worker_name}</div>
                      {target === "all" && (
                        <div className="truncate text-ms-2xs text-muted-foreground">{g.title_name}</div>
                      )}
                    </div>
                    <span className={`shrink-0 rounded-full border px-ms-2 py-0.5 text-ms-2xs font-medium ${status.tone}`}>
                      {status.label}
                    </span>
                  </div>
                  <div className="mt-1.5 grid grid-cols-1 gap-ms-1 text-ms-2xs text-muted-foreground sm:grid-cols-2">
                    <div className="min-w-0"><span className="text-ms-2xs uppercase tracking-wide">Kirim pertama</span><br /><span className="truncate">{formatWaktu(firstSent)}</span></div>
                    {lastSent !== firstSent && (
                      <div className="min-w-0"><span className="text-ms-2xs uppercase tracking-wide">Kirim terakhir</span><br /><span className="truncate">{formatWaktu(lastSent)}</span></div>
                    )}
                    {t?.completed_at && (
                      <div className="min-w-0 sm:col-span-2"><span className="text-ms-2xs uppercase tracking-wide">Selesai</span><br /><span className="truncate">{formatWaktu(t.completed_at)}</span></div>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-ms-1">
                    {g.entries.map((e) => (
                        <span
                          key={e.id}
                          className="min-w-0 truncate rounded-full border bg-muted/40 px-ms-2 py-0.5 text-ms-2xs text-muted-foreground"
                          title={formatWaktu(e.sent_at)}
                        >
                          {channelLabel(e.channel)} · {formatWaktu(e.sent_at)}
                        </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="gap-ms-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RotateCw className="mr-1 h-3.5 w-3.5" /> Segarkan
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>Tutup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
