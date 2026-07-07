import { createFileRoute, useRouter, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PhotoEditor } from "@/components/PhotoEditor";
import { TaskQrCode } from "@/components/TaskQrCode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EcerLabel, EcerMeta, EcerBody } from "@/components/ecer/Typography";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Camera, Image as ImageIcon, Edit3, MapPin, Plus, Scale, Trash2,
  Share2, ExternalLink, Loader2, ChevronLeft, Package, AlertTriangle, RotateCw, Users, UserPlus, MessageCircle, RefreshCw, Link2, QrCode,
  Calendar, Clock, Hash, CheckCircle2, Boxes, Send, Wallet, HandCoins,
} from "lucide-react";
import {
  ECER_BUCKET, ecerSignedUrl, uploadEcerPhoto, deleteEcerPhoto,
  type EcerTitle, type EcerPreparation,
} from "@/lib/ecer";
import { shareToWhatsApp, buildWhatsAppUrl, notifyShareResult, copyText, urlToFile } from "@/lib/share-wa";
import { shareToChat } from "@/lib/share-chat";
import { PickChatConversationDialog } from "@/components/PickChatConversationDialog";
import { confirm } from "@/lib/confirm";
import { signedUrl as prepSignedUrl } from "@/lib/prep";
import { publicTaskUrl, genPin, genShareToken } from "@/lib/prep";
import { fmtItemQty } from "@/lib/stock-format";
import { rupiah } from "@/lib/stock-format";
import { displayUnit } from "@/lib/unit-label";
import { shortenUrlForToast } from "@/lib/shorten-url-for-toast";
import { copyUrlWithToast } from "@/lib/copy-url-toast";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useLayoutMode, layoutFieldPairClass } from "@/components/LayoutModeToggle";
import { buildReadOnlyToast } from "@/lib/prep-readonly-guard";
import { filterActivePreps, filterSentPreps, isSentPrep } from "@/lib/prep-active-selector";
import { buildPaymentMessageLines, formatPaymentRupiah, formatSoldPaymentSummary, getPaymentBreakdown, parsePaymentAmountInput } from "@/lib/payment-summary";
import { emitDebtTx } from "@/lib/debt-tx-event";

export const Route = createFileRoute("/_authenticated/ecer")({
  head: () => ({ meta: [{ title: "Penyiapan Ecer · MCM Storage" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    item: typeof s.item === "string" ? s.item : undefined,
    title: typeof s.title === "string" ? s.title : undefined,
    highlight: typeof s.highlight === "string" ? s.highlight : undefined,
    // "send=1" → auto-buka mode pilih + dialog "Kirim ke pembeli" untuk semua
    // kotak aktif pada judul yang dituju. Dipakai oleh shortcut di dashboard
    // supaya seluruh jalur "Kirim WA" wajib melewati verifikasi pembayaran.
    send: typeof s.send === "string" ? s.send : undefined,
  }),
  component: EcerPage,
});

type WarehouseItem = {
  id: string; name: string; category: string | null; base_unit: string;
  stock_base: number; image_path: string | null;
  package_type?: string | null;
  package_size?: number | null;
};

function EcerPage() {
  const search = Route.useSearch();
  const router = useRouter();
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [titles, setTitles] = useState<EcerTitle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{
    source: string;
    message: string;
    code?: string;
    status?: number | string;
    hint?: string;
    details?: string;
    diagnosis?: string;
  } | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>(search.item);
  const [selectedTitleId, setSelectedTitleId] = useState<string | undefined>(search.title);
  const [highlightTitleId, setHighlightTitleId] = useState<string | undefined>(search.highlight);
  // Ambil `send=1` sekali saat mount. URL sync effect di bawah akan
  // menghapus flag dari URL setelah render pertama, jadi kita simpan di
  // state agar TitleDetailView bisa mengonsumsinya walau URL sudah bersih.
  const [pendingAutoSend, setPendingAutoSend] = useState(search.send === "1");
  const [editingTitle, setEditingTitle] = useState<EcerTitle | null>(null);
  const [creatingTitle, setCreatingTitle] = useState(false);
  // Membuat judul lain untuk item tertentu langsung dari halaman detail.
  const [creatingTitleForItem, setCreatingTitleForItem] = useState<WarehouseItem | null>(null);
  // Membuat produk gudang baru (lanjut otomatis ke pembuatan judul untuk produk itu).
  const [creatingProduct, setCreatingProduct] = useState(false);

  function diagnose(err: { code?: string; message?: string; status?: number | string; details?: string }): string {
    const code = err?.code ?? "";
    const msg = (err?.message ?? "").toLowerCase();
    const status = String(err?.status ?? "");
    if (code === "PGRST301" || msg.includes("jwt") || status === "401") {
      return "Sesi login tidak valid / kedaluwarsa. Coba logout lalu login lagi.";
    }
    if (code === "42501" || msg.includes("permission denied")) {
      return "Permission denied — kemungkinan GRANT tabel di Data API belum diberikan ke role 'authenticated'.";
    }
    if (code === "PGRST116" || msg.includes("row-level security") || msg.includes("violates row-level")) {
      return "Terblokir oleh Row Level Security (RLS). Periksa policy SELECT untuk user yang login.";
    }
    if (code === "PGRST205" || msg.includes("not find the table") || msg.includes("does not exist")) {
      return "Tabel tidak ditemukan di schema cache. Restart PostgREST atau cek nama tabel.";
    }
    if (msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("load failed")) {
      return "Jaringan gagal terhubung ke server. Cek koneksi internet Anda.";
    }
    if (status.startsWith("5")) return "Server backend sedang bermasalah (5xx). Coba beberapa saat lagi.";
    return "Penyebab tidak dikenali — lihat detail di bawah.";
  }

  async function loadAll() {
    setLoading(true);
    setLoadError(null);
    try {
      const { data: sess, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) {
        setLoadError({ source: "auth.getSession", message: sessErr.message, diagnosis: "Gagal membaca sesi login dari browser." });
        setLoading(false); return;
      }
      if (!sess?.session) {
        setLoadError({
          source: "auth.getSession",
          message: "Belum ada sesi aktif.",
          diagnosis: "Anda belum login atau sesi sudah berakhir. Silakan login ulang.",
        });
        setLoading(false); return;
      }
      const [wi, et] = await Promise.all([
        supabase.from("warehouse_items").select("id,name,category,base_unit,stock_base,image_path,package_type,package_size").order("name"),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from as any)("ecer_titles").select("*").order("position").order("created_at"),
      ]);
      if (wi.error) {
        const e = wi.error as { code?: string; message: string; hint?: string; details?: string };
        setLoadError({
          source: "warehouse_items.select",
          message: e.message, code: e.code, hint: e.hint, details: e.details,
          diagnosis: diagnose({ code: e.code, message: e.message }),
        });
        setLoading(false); return;
      }
      if (et.error) {
        const e = et.error as { code?: string; message: string; hint?: string; details?: string };
        setLoadError({
          source: "ecer_titles.select",
          message: e.message, code: e.code, hint: e.hint, details: e.details,
          diagnosis: diagnose({ code: e.code, message: e.message }),
        });
        setLoading(false); return;
      }
      setItems((wi.data ?? []) as WarehouseItem[]);
      setTitles((et.data ?? []) as EcerTitle[]);
    } catch (e) {
      const err = e as { message?: string; status?: number; code?: string; name?: string };
      setLoadError({
        source: "loadAll/exception",
        message: err?.message || String(e),
        status: err?.status,
        code: err?.code ?? err?.name,
        diagnosis: diagnose({ message: err?.message, status: err?.status, code: err?.code }),
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadAll(); }, []);

  // sync URL when selection changes
  useEffect(() => {
    void router.navigate({
      to: "/ecer",
      search: { item: selectedItemId, title: selectedTitleId, highlight: undefined },
      replace: true,
    });
  }, [selectedItemId, selectedTitleId, router]);

  // Persist selected warehouse item so other surfaces (beranda) can sync filter
  useEffect(() => {
    try {
      if (selectedItemId) {
        localStorage.setItem("ecer:selectedItemId", selectedItemId);
      } else {
        localStorage.removeItem("ecer:selectedItemId");
      }
      window.dispatchEvent(
        new CustomEvent("ecer:selectedItemId", { detail: selectedItemId ?? null }),
      );
    } catch {
      // ignore storage errors (private mode, quota)
    }
  }, [selectedItemId]);

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedItemId),
    [items, selectedItemId],
  );
  const titlesForItem = useMemo(
    () => titles.filter((t) => t.warehouse_item_id === selectedItemId),
    [titles, selectedItemId],
  );
  const selectedTitle = useMemo(
    () => titles.find((t) => t.id === selectedTitleId),
    [titles, selectedTitleId],
  );

  // Auto-select product + scroll & highlight target title when arriving via deep link
  useEffect(() => {
    if (!highlightTitleId || titles.length === 0) return;
    const t = titles.find((x) => x.id === highlightTitleId);
    if (t && selectedItemId !== t.warehouse_item_id) {
      setSelectedItemId(t.warehouse_item_id);
    }
    const scrollId = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-title-id="${highlightTitleId}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    const clearId = window.setTimeout(() => setHighlightTitleId(undefined), 2600);
    return () => { window.clearTimeout(scrollId); window.clearTimeout(clearId); };
  }, [highlightTitleId, titles, selectedItemId]);

  async function refetchTitles() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.from as any)("ecer_titles").select("*").order("position").order("created_at");
    if (data) setTitles(data as EcerTitle[]);
  }

  async function refetchItems() {
    const { data } = await supabase
      .from("warehouse_items")
      .select("id,name,category,base_unit,stock_base,image_path,package_type,package_size")
      .order("name");
    if (data) setItems(data as WarehouseItem[]);
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Memuat…
      </div>
    );
  }

  if (loadError && items.length === 0 && titles.length === 0) {
    const navOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
    return (
      <div className="mx-auto max-w-lg p-4 sm:p-6">
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-5">
          <div className="mb-3 flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">Gagal memuat Penyiapan Ecer</div>
              <div className="mt-0.5 text-xs text-muted-foreground">Sumber: <code className="rounded bg-muted px-1 py-0.5">{loadError.source}</code></div>
            </div>
          </div>

          {loadError.diagnosis && (
            <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs leading-snug text-amber-700 dark:text-amber-400">
              <b>Kemungkinan penyebab:</b> {loadError.diagnosis}
            </div>
          )}

          <div className="space-y-1.5 rounded-md border bg-background/60 p-2.5 text-[11px] leading-snug">
            <div><span className="text-muted-foreground">Pesan:</span> <span className="break-words font-mono">{loadError.message}</span></div>
            {loadError.code && <div><span className="text-muted-foreground">Kode:</span> <span className="font-mono">{loadError.code}</span></div>}
            {loadError.status !== undefined && <div><span className="text-muted-foreground">HTTP:</span> <span className="font-mono">{String(loadError.status)}</span></div>}
            {loadError.hint && <div><span className="text-muted-foreground">Hint:</span> <span className="font-mono">{loadError.hint}</span></div>}
            {loadError.details && <div><span className="text-muted-foreground">Detail:</span> <span className="font-mono">{loadError.details}</span></div>}
            <div><span className="text-muted-foreground">Jaringan:</span> <span className="font-mono">{navOnline ? "online" : "offline"}</span></div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void loadAll()}>
              <RotateCw className="mr-1 h-4 w-4" /> Coba lagi
            </Button>
            <Button size="sm" variant="outline" onClick={() => {
              const txt = JSON.stringify(loadError, null, 2);
              if (navigator.clipboard) {
                void navigator.clipboard.writeText(txt).then(() => toast.success("Detail error disalin"));
              } else toast.message(txt);
            }}>Salin detail</Button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Detail view: a specific title ----
  if (selectedTitle && selectedItem) {
    return (
      <>
        <TitleDetailView
          item={selectedItem}
          title={selectedTitle}
          onBack={() => setSelectedTitleId(undefined)}
          onTitleUpdated={refetchTitles}
          onCreateTitle={() => setCreatingTitleForItem(selectedItem)}
          onCreateProduct={() => setCreatingProduct(true)}
          autoSend={pendingAutoSend}
          onAutoSendConsumed={() => setPendingAutoSend(false)}
        />
        {creatingTitleForItem && (
          <TitleFormDialog
            item={creatingTitleForItem}
            existing={null}
            onClose={() => setCreatingTitleForItem(null)}
            onSaved={(newId) => {
              setCreatingTitleForItem(null);
              void refetchTitles().then(() => {
                if (newId) setSelectedTitleId(newId);
              });
            }}
          />
        )}
        {creatingProduct && (
          <NewProductDialog
            onClose={() => setCreatingProduct(false)}
            onCreated={async (newItem) => {
              setCreatingProduct(false);
              await refetchItems();
              // Lanjutkan langsung ke pembuatan judul untuk produk baru.
              setCreatingTitleForItem(newItem);
              // Pindahkan konteks ke produk baru agar judul nanti muncul di sini.
              setSelectedItemId(newItem.id);
              setSelectedTitleId(undefined);
            }}
          />
        )}
      </>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-3 sm:p-5">
      <div className="flex items-center gap-2">
        <Scale className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold">Penyiapan Ecer</h1>
      </div>
      <p className="text-xs leading-snug text-muted-foreground">
        Buat <b>Judul Ecer</b> per produk (mis. <i>KRISTAL 1 gram</i>), lalu tambahkan kotak-kotak penyiapan
        berisi foto + lokasi + berat aktual yang ditimbang. Stok produk otomatis berkurang setiap penyiapan disimpan.
      </p>

      <div>
        <Label className="text-xs">Pilih produk</Label>
        <select
          value={selectedItemId ?? ""}
          onChange={(e) => { setSelectedItemId(e.target.value || undefined); setSelectedTitleId(undefined); }}
          className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
        >
          <option value="">— Pilih produk —</option>
          {items.map((it) => (
            <option key={it.id} value={it.id}>
              {it.category ? `[${it.category}] ` : ""}{it.name} · stok {fmtItemQty(it.stock_base, { ...it, base_unit: it.base_unit as "g" | "pcs" })}
            </option>
          ))}
        </select>
      </div>

      {selectedItem && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-base">{selectedItem.name}</CardTitle>
              <div className="text-xs text-muted-foreground">
                {selectedItem.category ?? "—"} · stok {fmtItemQty(selectedItem.stock_base, { ...selectedItem, base_unit: selectedItem.base_unit as "g" | "pcs" })}
              </div>
            </div>
            <Button size="sm" onClick={() => setCreatingTitle(true)}>
              <Plus className="h-4 w-4" /> Judul baru
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {titlesForItem.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
                Belum ada Judul Ecer. Buat satu untuk mulai mencatat penyiapan ecer.
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {titlesForItem.map((t) => (
                  <TitleCard
                    key={t.id}
                    title={t}
                    itemName={selectedItem.name}
                    onOpen={() => setSelectedTitleId(t.id)}
                    onEdit={() => setEditingTitle(t)}
                    onDeleted={refetchTitles}
                    highlighted={highlightTitleId === t.id}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(creatingTitle || editingTitle) && selectedItem && (
        <TitleFormDialog
          item={selectedItem}
          existing={editingTitle}
          onClose={() => { setCreatingTitle(false); setEditingTitle(null); }}
          onSaved={(newId) => {
            setCreatingTitle(false); setEditingTitle(null);
            void refetchTitles().then(() => { if (newId) setSelectedTitleId(newId); });
          }}
        />
      )}

      {creatingProduct && (
        <NewProductDialog
          onClose={() => setCreatingProduct(false)}
          onCreated={async (newItem) => {
            setCreatingProduct(false);
            await refetchItems();
            setSelectedItemId(newItem.id);
            setSelectedTitleId(undefined);
            setCreatingTitleForItem(newItem);
          }}
        />
      )}

      {creatingTitleForItem && (
        <TitleFormDialog
          item={creatingTitleForItem}
          existing={null}
          onClose={() => setCreatingTitleForItem(null)}
          onSaved={(newId) => {
            setCreatingTitleForItem(null);
            void refetchTitles().then(() => { if (newId) setSelectedTitleId(newId); });
          }}
        />
      )}

      <div className="pt-1">
        <Button variant="outline" size="sm" onClick={() => setCreatingProduct(true)}>
          <Plus className="h-4 w-4" /> Produk gudang baru
        </Button>
      </div>
    </div>
  );
}

function TitleCard({ title, itemName, onOpen, onEdit, onDeleted, highlighted }: {
  title: EcerTitle; itemName?: string; onOpen: () => void; onEdit: () => void; onDeleted: () => void;
  highlighted?: boolean;
}) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count: c } = await (supabase.from as any)("ecer_preparations")
        .select("id", { count: "exact", head: true })
        .eq("title_id", title.id);
      setCount(c ?? 0);
    })();
  }, [title.id]);

  async function onDelete() {
    const ok = typeof window !== "undefined" && window.confirm(
      "Hapus judul ecer? Semua kotak penyiapan di judul ini juga akan dihapus dan stok yang sudah dikurangi sebelumnya akan dikembalikan."
    );
    if (!ok) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from as any)("ecer_titles").delete().eq("id", title.id);
    if (error) { toast.error("Gagal: " + error.message); return; }
    toast.success("Judul dihapus");
    onDeleted();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      data-title-id={title.id}
      className={`cursor-pointer rounded-lg border bg-card p-3 transition hover:border-primary/40 hover:bg-accent/30 active:bg-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${highlighted ? "ring-2 ring-primary border-primary animate-pulse" : ""}`}
    >
      <div className="text-sm font-semibold leading-snug [overflow-wrap:anywhere]">{title.name}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        Target: <b>{title.target_grams} {displayUnit(itemName, title.unit_label)}</b> · {count ?? "…"} penyiapan
      </div>
      {title.note && <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{title.note}</div>}
      <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
        <span className="text-[11px] leading-snug text-muted-foreground">Tap untuk buka penyimpanan →</span>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onEdit(); }}>
            <Edit3 className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); void onDelete(); }}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function TitleFormDialog({ item, existing, onClose, onSaved }: {
  item: WarehouseItem; existing: EcerTitle | null;
  onClose: () => void; onSaved: (newId?: string) => void;
}) {
  const [name, setName] = useState(existing?.name ?? `${item.name} `);
  const [target, setTarget] = useState(existing ? String(existing.target_grams) : "1");
  const [unit, setUnit] = useState<"g" | "gram">((existing?.unit_label as "g" | "gram") ?? "gram");
  const [note, setNote] = useState(existing?.note ?? "");
  const [busy, setBusy] = useState(false);
  // Ikut mode layout tersimpan (key `readyEcer`) — di mode `compact`
  // pasangan input menumpuk penuh, selebihnya responsif 1→2 kolom.
  const [layout] = useLayoutMode("readyEcer", "grid");
  const pairClass = layoutFieldPairClass(layout);

  async function save() {
    if (!name.trim()) { toast.error("Nama wajib diisi"); return; }
    const t = Number(String(target).replace(",", "."));
    if (!Number.isFinite(t) || t <= 0) { toast.error("Target berat tidak valid"); return; }
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const userId = u.user?.id;
    if (!userId) { toast.error("Sesi tidak valid"); setBusy(false); return; }
    const payload = { name: name.trim(), target_grams: t, unit_label: unit, note: note.trim() || null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tbl = (supabase.from as any)("ecer_titles");
    const res = existing
      ? await tbl.update(payload).eq("id", existing.id).select("id").maybeSingle()
      : await tbl.insert({ ...payload, user_id: userId, warehouse_item_id: item.id }).select("id").single();
    setBusy(false);
    if (res.error) { toast.error("Gagal: " + res.error.message); return; }
    toast.success(existing ? "Tersimpan" : "Judul dibuat");
    onSaved((res.data as { id?: string } | null)?.id ?? existing?.id);
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? "Edit judul ecer" : "Judul ecer baru"}</DialogTitle>
          <DialogDescription>Produk: <b>{item.name}</b></DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Nama judul</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="mis. KRISTAL 1 gram"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck={false}
              inputMode="text"
            />
          </div>
          <div className={pairClass}>
            <div>
              <Label className="text-xs">Target berat</Label>
              <Input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Satuan</Label>
              <div className="mt-1 inline-flex h-9 rounded-md border bg-background p-0.5">
                {(["g", "gram"] as const).map((u) => (
                  <button key={u} onClick={() => setUnit(u)}
                    className={`h-full rounded px-3 text-xs font-medium ${unit === u ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                    {u}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <Label className="text-xs">Keterangan (opsional)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Peraturan penyiapan / catatan…" rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button onClick={save} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Simpan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Hero: branded receipt-style header for a title ----
// shortenUrlForToast dipindah ke src/lib/shorten-url-for-toast.ts agar
// bisa diuji unit tanpa render route.

function DetailHero({
  item, title, preps, onAdd, onCreateTitle, onCreateProduct, onScrollToWorker,
}: {
  item: WarehouseItem;
  title: EcerTitle;
  preps: EcerPreparation[];
  onAdd: () => void;
  onCreateTitle?: () => void;
  onCreateProduct?: () => void;
  onScrollToWorker: () => void;
}) {
  const isAdmin = useIsAdmin();
  const unit = displayUnit(item.name, title.unit_label);
  const totalActual = preps.reduce((s, p) => s + (Number(p.actual_grams) || 0), 0);
  const targetTotal = (Number(title.target_grams) || 0) * preps.length;
  const progress = targetTotal > 0 ? Math.min(100, Math.round((totalActual / targetTotal) * 100)) : 0;
  const last = preps[0];
  const lastDate = last ? new Date(last.created_at) : null;
  const fmtDate = (d: Date) => d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  const fmtTime = (d: Date) => d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) + " WIB";
  const ref = title.id.replace(/-/g, "").slice(0, 16).toUpperCase();

  // Permalink Penyiapan pegawai untuk judul ini. Dipakai admin untuk
  // membagikan link prefilled (mis. lewat WhatsApp ke pegawai lain / device
  // admin) tanpa harus menavigasi manual. Origin diambil dari window agar
  // otomatis cocok dengan custom domain/preview.
  const onCopyPrepLink = async () => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/tugas-baru?title_id=${encodeURIComponent(title.id)}`;
    // Pratinjau URL yang benar-benar masuk clipboard: strip protokol supaya
    // ringkas di layar HP, dan potong tengah pakai ellipsis Unicode jika
    // lebih panjang dari 56 char sehingga host + akhir query tetap
    // terlihat (paling informatif untuk verifikasi cepat). Bila clipboard
    // ditolak, helper menampilkan toast dengan tombol "Salin manual"
    // (window.prompt) + URL penuh sebagai fallback.
    await copyUrlWithToast(url, "Link Penyiapan pegawai disalin");
  };

  const [qrOpen, setQrOpen] = useState(false);
  // Permalink admin (untuk Salin link Shift+L). QR di dialog di bawah
  // TIDAK memakai URL ini — QR harus membuka portal pegawai (bukan aplikasi
  // admin), lengkap dengan PIN baru tiap kali dibuka.
  const prepPermalink =
    typeof window !== "undefined"
      ? `${window.location.origin}/tugas-baru?title_id=${encodeURIComponent(title.id)}`
      : `/tugas-baru?title_id=${encodeURIComponent(title.id)}`;

  // Sesi worker portal untuk QR: setiap kali dialog dibuka kita mint task
  // baru (share_token + PIN baru) yang sudah prefill item-nya ke judul ini
  // — supaya foto pegawai otomatis masuk folder ecer yang benar (trigger
  // prep_task_items_resolve_ecer_title mengunci ecer_title_id dari
  // (warehouse_item_id, qty, unit)).
  const [workerSession, setWorkerSession] = useState<{ url: string; pin: string; token: string } | null>(null);
  const [workerBusy, setWorkerBusy] = useState(false);
  const [workerErr, setWorkerErr] = useState<string | null>(null);

  const mintWorkerSession = async () => {
    setWorkerBusy(true);
    setWorkerErr(null);
    try {
      const pin = genPin();
      const token = genShareToken();
      const unitLabel = title.unit_label ?? null;
      const targetGrams = Number(title.target_grams) || 0;
      const payload = title.warehouse_item_id
        ? [{
            name: `${item.name} — ${title.name}`,
            category: null,
            qty_requested: targetGrams,
            unit_label: unitLabel,
            ref_photo_path: null,
            warehouse_item_id: title.warehouse_item_id,
            ecer_title_id: title.id,
          }]
        : [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rpcErr } = await (supabase.rpc as any)("prep_create_task", {
        _title: `Ecer: ${title.name}`,
        _note: `Penyiapan ${item.name} — ${title.name} (${targetGrams} ${unitLabel ?? ""}). Foto masuk folder ecer otomatis.`,
        _pin: pin,
        _share_token: token,
        _items: payload,
      });
      if (rpcErr) throw rpcErr;
      setWorkerSession({ url: publicTaskUrl(token, pin), pin, token });
    } catch (e) {
      setWorkerErr((e as Error).message || "Gagal membuat sesi pegawai");
      setWorkerSession(null);
    } finally {
      setWorkerBusy(false);
    }
  };

  // Setiap kali dialog dibuka: mint sesi baru (PIN baru). Saat ditutup:
  // kosongkan sesi supaya buka lagi = generate ulang.
  useEffect(() => {
    if (!qrOpen) {
      setWorkerSession(null);
      setWorkerErr(null);
      return;
    }
    void mintWorkerSession();
    // Sengaja tidak memasukkan mintWorkerSession ke deps (stable-enough,
    // hanya bergantung title.id yang tidak berubah selama komponen mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrOpen]);
  // Tooltip pratinjau URL yang akan disalin. Native `title=` bekerja di
  // desktop (hover) dan mobile (long-press) tanpa perlu TooltipProvider,
  // supaya admin bisa memastikan link yang benar sebelum menekan.
  const copyLinkTooltip = `Salin permalink Penyiapan pegawai (Shift+L):\n${prepPermalink}`;
  // Label a11y untuk tombol Salin link. Screen reader membaca aria-label
  // apa adanya, jadi kita ejakan pintasan supaya jelas ("Shift L" bukan
  // "Shift plus L"). `aria-keyshortcuts` mengikuti spec WAI-ARIA sehingga
  // AT modern juga bisa mengumumkannya lewat kanal pintasan terpisah.
  const copyLinkAriaLabel =
    "Salin permalink Penyiapan pegawai untuk judul ini — pintasan Shift L";
  const navigate = useNavigate();

  // Shortcut keyboard: Shift + L saat halaman folder ecer terbuka menyalin
  // permalink Penyiapan pegawai tanpa harus menyentuh tombol. Aktif hanya
  // untuk admin dan hanya jika fokus tidak sedang di input/textarea/select/
  // contenteditable — supaya tidak menabrak pengetikan (mis. edit judul).
  // Modifier lain (Ctrl/Meta/Alt) diblok agar tidak bentrok dengan shortcut
  // browser (Cmd+L, Ctrl+Shift+L, dst).
  useEffect(() => {
    if (!isAdmin) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (t?.isContentEditable) return;
      if (e.key === "L" || e.key === "l") {
        e.preventDefault();
        void onCopyPrepLink();
        return;
      }
      // Shift+Q: toggle dialog QR permalink Penyiapan pegawai. Toggle
      // (bukan sekadar open) supaya bisa tutup lagi lewat keyboard tanpa
      // pindah tangan ke mouse.
      if (e.key === "Q" || e.key === "q") {
        e.preventDefault();
        setQrOpen((v) => !v);
        return;
      }
      // Shift+P: buka halaman Tugas Baru dengan prefill judul saat ini.
      // Navigasi client-side (bukan window.location) supaya state router
      // dan cache TanStack Query tetap utuh.
      if (e.key === "P" || e.key === "p") {
        e.preventDefault();
        void navigate({ to: "/tugas-baru", search: { title_id: title.id } });
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // onCopyPrepLink stable-enough: hanya bergantung title.id yang tetap
    // selama komponen mount. Rebind saat admin flag/title berubah.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, title.id]);

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      {/* Brand strip */}
      <div className="relative bg-gradient-to-br from-primary/95 via-primary to-primary/80 px-4 pb-4 pt-4 text-primary-foreground sm:px-5 sm:pb-6 sm:pt-5">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400 via-primary-foreground/40 to-emerald-400" />
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase leading-none tracking-[0.18em] text-primary-foreground/80">
              <Scale className="h-3 w-3 shrink-0" />
              <span className="truncate">Detail penyiapan ecer</span>
            </div>
            <h2 className="mt-2 break-words text-base font-bold leading-snug sm:text-xl">{title.name}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] leading-none text-primary-foreground/85">
              <span
                className="inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-full bg-white/15 px-2 leading-none backdrop-blur-sm"
                title={item.name}
              >
                <Package className="h-3 w-3 shrink-0" />
                <span className="truncate">{item.name}</span>
              </span>
              <span className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-white/15 px-2 leading-none backdrop-blur-sm">
                Target <b className="ml-0.5">{title.target_grams} {unit}</b>
              </span>
              <span className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-emerald-400/25 px-2 font-semibold leading-none text-emerald-50 ring-1 ring-emerald-300/50 backdrop-blur-sm">
                <CheckCircle2 className="h-3 w-3 shrink-0" /> Aktif
              </span>
              <span className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-white/10 px-2 font-mono leading-none text-primary-foreground/90 backdrop-blur-sm sm:hidden">
                <Hash className="h-3 w-3 shrink-0" /> {ref}
              </span>
            </div>
          </div>
          <div className="hidden shrink-0 text-right sm:block">
            <div className="text-[11px] uppercase leading-snug tracking-wider text-primary-foreground/70">No. Referensi</div>
            <div className="font-mono text-[11px] leading-snug text-primary-foreground/95">{ref}</div>
          </div>
        </div>
      </div>

      {/* Detail rows */}
      <div className="divide-y bg-card px-4 sm:px-5">
        <DetailRow icon={<Package className="h-3.5 w-3.5" />} label="Produk gudang"
          value={<span className="font-semibold">{item.name}</span>}
          sub={`Stok: ${fmtItemQty(item.stock_base, { ...item, base_unit: item.base_unit as "g" | "pcs" })}`}
        />
        <DetailRow icon={<Scale className="h-3.5 w-3.5" />} label="Target per kotak"
          value={<span className="font-semibold">{title.target_grams} {unit}</span>}
          sub={preps.length > 0 ? `Total target ${targetTotal} ${unit} · aktual ${totalActual} ${unit}` : undefined}
        />
        {/* `preps` di header ini sudah difilter aktif (lihat pemanggilan
            `<Header preps={active} />` di komponen induk). Label
            "kotak siap" wajib konsisten dengan badge di ReadyEcerSection
            (juga bersumber `countActiveByTitle`) supaya angka 0 tidak
            bermakna berbeda di list vs detail. */}
        <DetailRow icon={<Boxes className="h-3.5 w-3.5" />} label="Jumlah penyiapan"
          value={<span className="font-semibold">{preps.length} kotak siap</span>}
          sub={preps.length > 0 ? `${progress}% dari target` : "Belum ada kotak siap"}
        />
        {lastDate && (
          <>
            <DetailRow icon={<Calendar className="h-3.5 w-3.5" />} label="Tanggal terakhir"
              value={<span className="font-semibold">{fmtDate(lastDate)}</span>} />
            <DetailRow icon={<Clock className="h-3.5 w-3.5" />} label="Jam terakhir"
              value={<span className="font-semibold">{fmtTime(lastDate)}</span>} />
          </>
        )}
        <DetailRow icon={<Hash className="h-3.5 w-3.5" />} label="ID judul"
          value={<span className="font-mono text-xs">{ref}</span>} />
        {title.note && (
          <div className="py-2.5">
            <EcerLabel as="div">Catatan</EcerLabel>
            <EcerBody as="div" className="mt-1.5 whitespace-pre-wrap">{title.note}</EcerBody>
          </div>
        )}
      </div>

      {/* Action footer — bar 4 tombol ramah jempol (pill aktif lega) */}
      <div
        className="sticky bottom-0 z-10 -mx-px border-t bg-card/95 px-2 pt-2 shadow-[0_-10px_25px_-5px_rgba(0,0,0,0.05)] backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:static sm:bg-muted/40 sm:px-5 sm:py-3 sm:shadow-none sm:backdrop-blur-0"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)" }}
      >
        <div className="hidden text-[11px] uppercase tracking-wider text-muted-foreground sm:mb-2 sm:block">
          Simpan halaman ini sebagai referensi penyiapan.
        </div>
        {/* Mobile: bar bawah dengan kolom auto-fit — tetap rapi walau jumlah
            tombol bervariasi (Judul & Produk kondisional). Desktop: flex wrap. */}
        <div className="grid auto-cols-fr grid-flow-col gap-1 sm:flex sm:flex-wrap sm:items-center sm:justify-end sm:gap-1.5">
          {onCreateTitle && (
            <button
              type="button"
              onClick={onCreateTitle}
              title="Judul ecer baru untuk produk yang sama"
              className="group flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-1 rounded-2xl p-2 text-muted-foreground transition-all active:scale-95 hover:bg-muted/60 sm:hidden"
            >
              <Plus className="h-5 w-5" aria-hidden />
              <span className="max-w-full truncate text-[11px] font-semibold leading-none tracking-tight">Judul</span>
            </button>
          )}
          {onCreateProduct && (
            <button
              type="button"
              onClick={onCreateProduct}
              title="Buat produk gudang baru lalu langsung dibuatkan judulnya"
              className="group flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-1 rounded-2xl p-2 text-muted-foreground transition-all active:scale-95 hover:bg-muted/60 sm:hidden"
            >
              <Package className="h-5 w-5" aria-hidden />
              <span className="max-w-full truncate text-[11px] font-semibold leading-none tracking-tight">Produk</span>
            </button>
          )}
          <button
            type="button"
            onClick={onScrollToWorker}
            title="Lihat kiriman pegawai untuk judul ini"
            className="group flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-1 rounded-2xl p-2 text-muted-foreground transition-all active:scale-95 hover:bg-muted/60 sm:hidden"
          >
            <Users className="h-5 w-5" aria-hidden />
            <span className="max-w-full truncate text-[11px] font-semibold leading-none tracking-tight">Pegawai</span>
          </button>
          {isAdmin && (
            <Link
              to="/tugas-baru"
              search={{ title_id: title.id }}
              title="Buat perintah penyiapan untuk pegawai (Shift+P)"
              aria-label="Buat perintah penyiapan untuk pegawai"
              className="group flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-1 rounded-2xl bg-primary/10 p-2 text-primary transition-all active:scale-95 hover:bg-primary/15 sm:hidden"
            >
              <UserPlus className="h-5 w-5" aria-hidden />
              <span className="max-w-full truncate text-[11px] font-semibold leading-none tracking-tight">Perintah</span>
            </Link>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={onCopyPrepLink}
              title={copyLinkTooltip}
              aria-label={copyLinkAriaLabel}
              aria-keyshortcuts="Shift+L"
              className="group flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-1 rounded-2xl p-2 text-muted-foreground transition-all active:scale-95 hover:bg-muted/60 sm:hidden"
            >
              <Link2 className="h-5 w-5" aria-hidden />
              <span className="max-w-full truncate text-[11px] font-semibold leading-none tracking-tight">Salin link</span>
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setQrOpen(true)}
              title="Tampilkan QR permalink Penyiapan pegawai (Shift+Q)"
              aria-label="Tampilkan QR permalink Penyiapan pegawai"
              className="group flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-1 rounded-2xl p-2 text-muted-foreground transition-all active:scale-95 hover:bg-muted/60 sm:hidden"
            >
              <QrCode className="h-5 w-5" aria-hidden />
              <span className="max-w-full truncate text-[11px] font-semibold leading-none tracking-tight">QR</span>
            </button>
          )}
          <button
            type="button"
            onClick={onAdd}
            title="Tambah penyiapan untuk judul ini"
            className="group flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-1 rounded-2xl bg-emerald-50 p-2 text-emerald-700 transition-all active:scale-95 dark:bg-emerald-500/15 dark:text-emerald-300 sm:hidden"
          >
            <Plus className="h-5 w-5" aria-hidden />
            <span className="max-w-full truncate text-[11px] font-semibold leading-none tracking-tight">Penyiapan</span>
          </button>

          {/* Desktop / tablet — keep richer labels */}
          {onCreateTitle && (
            <Button size="sm" variant="outline" onClick={onCreateTitle} title="Judul ecer baru untuk produk yang sama" className="hidden sm:inline-flex">
              <Plus className="h-4 w-4" /> Judul lain
            </Button>
          )}
          {onCreateProduct && (
            <Button size="sm" variant="outline" onClick={onCreateProduct} title="Buat produk gudang baru lalu langsung dibuatkan judulnya" className="hidden sm:inline-flex">
              <Package className="h-4 w-4" /> Produk baru
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onScrollToWorker} title="Lihat kiriman pegawai untuk judul ini" className="hidden sm:inline-flex">
            <Users className="h-4 w-4" /> Pegawai
          </Button>
          {isAdmin && (
            <Button
              asChild
              size="sm"
              variant="outline"
              className="hidden border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary sm:inline-flex"
              title="Buat perintah penyiapan untuk pegawai (Shift+P)"
            >
              <Link to="/tugas-baru" search={{ title_id: title.id }}>
                <UserPlus className="h-4 w-4" /> Penyiapan pegawai
              </Link>
            </Button>
          )}
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              onClick={onCopyPrepLink}
              title={copyLinkTooltip}
              aria-label={copyLinkAriaLabel}
              aria-keyshortcuts="Shift+L"
              className="hidden sm:inline-flex"
            >
              <Link2 className="h-4 w-4" /> Salin link
            </Button>
          )}
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setQrOpen(true)}
              title="Tampilkan QR permalink Penyiapan pegawai (Shift+Q)"
              className="hidden sm:inline-flex"
            >
              <QrCode className="h-4 w-4" /> QR
            </Button>
          )}
          <Button size="sm" onClick={onAdd} className="hidden bg-emerald-600 hover:bg-emerald-700 sm:inline-flex">
            <Plus className="h-4 w-4" /> Penyiapan
          </Button>
        </div>
      </div>
      {isAdmin && (
        <Dialog open={qrOpen} onOpenChange={setQrOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="truncate">QR portal pegawai — {title.name}</DialogTitle>
              <DialogDescription>
                Pegawai memindai QR ini untuk membuka portal penyiapan (bukan aplikasi admin).
                PIN baru dibuat setiap kali dialog dibuka atau tombol <b>Buat ulang</b> ditekan.
              </DialogDescription>
            </DialogHeader>
            {workerBusy && !workerSession ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Membuat sesi pegawai…
              </div>
            ) : workerErr ? (
              <div className="space-y-2">
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                  <div className="flex items-center gap-1 font-semibold">
                    <AlertTriangle className="h-3.5 w-3.5" /> Gagal membuat sesi
                  </div>
                  <div className="mt-1 break-words">{workerErr}</div>
                </div>
                <Button variant="outline" size="sm" className="w-full" onClick={() => void mintWorkerSession()}>
                  <RotateCw className="mr-1 h-3.5 w-3.5" /> Coba lagi
                </Button>
              </div>
            ) : workerSession ? (
              <div className="space-y-3">
                <TaskQrCode url={workerSession.url} pin={workerSession.pin} title={`Penyiapan ${title.name}`} />
                <div>
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Link pegawai</Label>
                  <div className="break-all rounded-md border bg-muted/30 px-2 py-1.5 text-[11px] font-mono">
                    {workerSession.url}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    disabled={workerBusy}
                    onClick={async () => {
                      await copyUrlWithToast(workerSession.url, "Link pegawai disalin");
                    }}
                  >
                    <Link2 className="mr-1 h-3.5 w-3.5" /> Salin link
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={workerBusy}
                    onClick={() => void mintWorkerSession()}
                  >
                    <RefreshCw className={`mr-1 h-3.5 w-3.5 ${workerBusy ? "animate-spin" : ""}`} /> Buat ulang (PIN baru)
                  </Button>
                </div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function DetailRow({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="grid min-h-[40px] grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-center gap-2 py-2 leading-snug sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
      <EcerLabel className="flex min-w-0 items-center gap-1.5 leading-snug" title={label}>
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground/70 [&_svg]:h-3.5 [&_svg]:w-3.5">
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </EcerLabel>
      <div
        className="flex min-w-0 items-center justify-end gap-x-1.5 text-right text-sm font-semibold leading-snug text-foreground [overflow-wrap:anywhere]"
        title={[typeof value === "string" ? value : undefined, sub].filter(Boolean).join(" · ") || undefined}
      >
        <span className="min-w-0 truncate [overflow-wrap:anywhere]">{value}</span>
        {sub && (
          <EcerMeta as="span" className="min-w-0 shrink-0 truncate whitespace-nowrap font-normal leading-snug">
            · {sub}
          </EcerMeta>
        )}
      </div>
    </div>
  );
}

// ---- Detail view: preparations grid ----
function TitleDetailView({ item, title, onBack, onTitleUpdated, onCreateTitle, onCreateProduct, autoSend, onAutoSendConsumed }: {
  item: WarehouseItem; title: EcerTitle; onBack: () => void; onTitleUpdated: () => void;
  onCreateTitle?: () => void; onCreateProduct?: () => void;
  autoSend?: boolean; onAutoSendConsumed?: () => void;
}) {
  void onBack;
  const [preps, setPreps] = useState<EcerPreparation[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [loadError, setLoadError] = useState<{ message: string; code?: string; hint?: string } | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendOpen, setSendOpen] = useState(false);
  const [quickSendPrep, setQuickSendPrep] = useState<EcerPreparation | null>(null);
  const [customers, setCustomers] = useState<Array<{ id: string; name: string; contact: string | null }>>([]);

  useEffect(() => {
    void supabase.from("customers").select("id,name,contact").order("name").then(({ data }) => {
      setCustomers((data ?? []) as Array<{ id: string; name: string; contact: string | null }>);
    });
  }, []);

  async function load() {
    setLoading(true);
    setLoadError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from as any)("ecer_preparations")
      .select("*").eq("title_id", title.id).order("created_at", { ascending: false });
    if (error) {
      setLoadError({
        message: error.message ?? "Gagal memuat daftar penyiapan.",
        code: error.code,
        hint: error.hint,
      });
      setPreps([]);
      setLoading(false);
      return;
    }
    setPreps((data ?? []) as EcerPreparation[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [title.id]);

  // Auto-open dialog "Kirim ke pembeli" saat datang dari dashboard dengan
  // flag `send=1`. Pilih semua kotak aktif untuk judul ini agar owner cukup
  // konfirmasi metode bayar. Sekali dijalankan, konsumsi flag.
  const autoSendFiredRef = useRef(false);
  useEffect(() => {
    if (!autoSend || autoSendFiredRef.current || loading) return;
    // Sabuk pengaman berlapis: walau query `preps` sudah difilter
    // `title_id=eq.title.id` server-side dan `filterActivePreps` mengunci
    // semantik "aktif", tetap saring ulang di klien agar `send=1` MUSTAHIL
    // memilih kotak dari judul lain, produk lain, atau kotak yang sudah
    // ter-sold_at. Kalau ada anomali (data lintas judul / produk), gugurkan
    // flag dan beri toast — jangan buka dialog dengan pilihan salah.
    const rawActive = filterActivePreps(preps);
    const mismatched = rawActive.filter(
      (p) =>
        p.title_id !== title.id ||
        (p.warehouse_item_id != null && p.warehouse_item_id !== item.id),
    );
    const activeNow = rawActive.filter(
      (p) =>
        p.title_id === title.id &&
        (p.warehouse_item_id == null || p.warehouse_item_id === item.id),
    );
    if (mismatched.length > 0) {
      // Terlihat data lintas judul / produk pada state — batal auto-send
      // supaya owner memeriksa manual. Ini seharusnya tidak pernah terjadi
      // (query sudah di-scope), tapi kita gagal aman.
      autoSendFiredRef.current = true;
      // Sebutkan kotak mana yang tidak valid: tampilkan alasan
      // (judul lain / produk lain) + ID pendek supaya owner bisa
      // menelusuri langsung. Batasi 5 kotak agar toast tetap terbaca.
      const details = mismatched.slice(0, 5).map((p) => {
        const shortId = String(p.id).slice(0, 8);
        const reasons: string[] = [];
        if (p.title_id !== title.id) reasons.push("judul lain");
        if (p.warehouse_item_id != null && p.warehouse_item_id !== item.id)
          reasons.push("produk lain");
        return `#${shortId} (${reasons.join(" & ") || "tidak cocok"})`;
      });
      const extra =
        mismatched.length > 5 ? ` +${mismatched.length - 5} lainnya` : "";
      toast.error(
        `Batal auto-Kirim: ${mismatched.length} kotak tidak valid. Pilih manual.`,
        { description: `Kotak: ${details.join(", ")}${extra}` },
      );
      onAutoSendConsumed?.();
      return;
    }
    if (activeNow.length === 0) {
      // Tidak ada kotak aktif; batalkan flag agar user tidak "terjebak".
      autoSendFiredRef.current = true;
      toast.info("Tidak ada kotak aktif untuk dikirim pada judul ini.");
      onAutoSendConsumed?.();
      return;
    }
    autoSendFiredRef.current = true;
    setSelectionMode(true);
    setSelected(new Set(activeNow.map((p) => p.id)));
    // Ringkasan pra-dialog: perlihatkan item + judul + jumlah kotak + total
    // gram yang akan dikirim, supaya owner tahu persis apa yang tercakup
    // sebelum dialog verifikasi pembayaran terbuka.
    const totalGrams = activeNow.reduce(
      (acc, p) => acc + (Number(p.actual_grams) || 0),
      0,
    );
    // Modal konfirmasi eksplisit sebelum dialog pembayaran terbuka.
    // Owner harus memvalidasi item + judul + jumlah kotak + total gram.
    // Batal ⇒ tetap konsumsi flag (jangan trigger dua kali), keluar dari
    // selection mode, dan jangan buka dialog pembayaran.
    const unit = title.unit_label || "g";
    void confirm({
      title: "Konfirmasi kirim ke pembeli",
      description: `Produk: ${item.name}\nJudul: ${title.name}\nJumlah: ${activeNow.length} kotak\nTotal: ${totalGrams} ${unit}`,
      confirmText: "Lanjut ke pembayaran",
      cancelText: "Batal",
    }).then((ok) => {
      if (!ok) {
        setSelectionMode(false);
        setSelected(new Set());
        onAutoSendConsumed?.();
        return;
      }
      setSendOpen(true);
      onAutoSendConsumed?.();
    });
  }, [autoSend, loading, preps, title.id, item.id, onAutoSendConsumed]);

  // realtime
  useEffect(() => {
    const ch = supabase.channel(`ecer_prep_${title.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ecer_preparations", filter: `title_id=eq.${title.id}` },
        () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [title.id]);

  const active = useMemo(() => filterActivePreps(preps), [preps]);
  const sent = useMemo(() => filterSentPreps(preps), [preps]);
  const selectedPreps = useMemo(() => active.filter((p) => selected.has(p.id)), [active, selected]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function exitSelection() {
    setSelectionMode(false);
    setSelected(new Set());
  }

  return (
    <div className="ecer-detail mx-auto max-w-4xl space-y-4 p-3 sm:p-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft className="h-4 w-4" /> Kembali</Button>
      </div>
      <DetailHero
        item={item}
        title={title}
        preps={active}
        onAdd={() => setAdding(true)}
        onCreateTitle={onCreateTitle}
        onCreateProduct={onCreateProduct}
        onScrollToWorker={() => {
          const el = document.getElementById(`worker-shots-${title.id}`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "start" });
            el.classList.add("ring-2", "ring-primary");
            setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 1500);
          }
        }}
      />
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-1.5 text-sm leading-snug">
              <Boxes className="h-4 w-4 text-primary" /> Daftar penyiapan
              <span
                className="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full bg-muted px-2 text-[11px] font-medium leading-none text-muted-foreground tabular-nums"
                title={`${active.length} penyiapan aktif`}
              >
                {active.length}
              </span>
            </CardTitle>
            {active.length > 0 && (
              selectionMode ? (
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" onClick={exitSelection}>Batal</Button>
                  <Button size="sm" onClick={() => setSendOpen(true)} disabled={selectedPreps.length === 0}>
                    <Send className="mr-1 h-3.5 w-3.5" /> Kirim ke pembeli ({selectedPreps.length})
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setSelectionMode(true)}>
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Pilih
                </Button>
              )
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Memuat daftar penyiapan…
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="aspect-square animate-pulse rounded-md border bg-muted/40" />
                ))}
              </div>
            </div>
          ) : loadError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="text-sm font-semibold text-destructive">Gagal memuat daftar penyiapan</div>
                  <div className="space-y-1 rounded-md border bg-background/60 p-2 text-[11px] leading-snug">
                    <div><span className="text-muted-foreground">Pesan:</span> <span className="break-words font-mono">{loadError.message}</span></div>
                    {loadError.code && <div><span className="text-muted-foreground">Kode:</span> <span className="font-mono">{loadError.code}</span></div>}
                    {loadError.hint && <div><span className="text-muted-foreground">Hint:</span> <span className="font-mono">{loadError.hint}</span></div>}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" onClick={() => void load()}>
                      <RotateCw className="mr-1 h-4 w-4" /> Coba lagi
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => {
                      const txt = JSON.stringify(loadError, null, 2);
                      if (navigator.clipboard) {
                        void navigator.clipboard.writeText(txt).then(() => toast.success("Detail error disalin"));
                      } else toast.message(txt);
                    }}>Salin detail</Button>
                  </div>
                </div>
              </div>
            </div>
          ) : active.length === 0 && sent.length === 0 ? (
            <div className="rounded-md border border-dashed bg-muted/20 px-4 py-8 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Boxes className="h-6 w-6 text-primary" />
              </div>
              <div className="text-sm font-semibold">Belum ada penyiapan</div>
              <p className="mx-auto mt-1 max-w-xs text-xs leading-snug text-muted-foreground">
                Tambahkan kotak penyiapan pertama untuk judul <b className="break-words">{title.name}</b>.
                Setiap kotak berisi foto, lokasi, dan berat aktual yang ditimbang.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => setAdding(true)}>
                  <Plus className="mr-1 h-4 w-4" /> Tambah penyiapan
                </Button>
              </div>
            </div>
          ) : (
            <>
              {active.length > 0 ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {active.map((p, idx) => (
                    <PrepBox
                      key={p.id}
                      prep={p}
                      index={active.length - idx}
                      title={title}
                      itemName={item.name}
                      onChanged={load}
                      onTitleUpdated={onTitleUpdated}
                      selectionMode={selectionMode}
                      selected={selected.has(p.id)}
                      onToggleSelect={() => toggleSelect(p.id)}
                      onQuickSend={() => setQuickSendPrep(p)}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed bg-muted/20 px-4 py-4 text-center text-xs text-muted-foreground">
                  Semua penyiapan sudah dikirim ke pembeli. Tambah yang baru untuk mengisi lagi.
                </div>
              )}
              {sent.length > 0 && (
                <div className="mt-5 border-t pt-3">
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Riwayat Terkirim
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium normal-case text-muted-foreground">
                      {sent.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {sent.map((p, idx) => (
                      <PrepBox
                        key={p.id}
                        prep={p}
                        index={sent.length - idx}
                        title={title}
                        itemName={item.name}
                        onChanged={load}
                        onTitleUpdated={onTitleUpdated}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {adding && (
        <PrepFormDialog
          item={item}
          title={title}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); void load(); onTitleUpdated(); }}
        />
      )}

      {sendOpen && (
        <SendEcerPrepsDialog
          open={sendOpen}
          preps={selectedPreps}
          title={title}
          itemName={item.name}
          customers={customers}
          onClose={() => setSendOpen(false)}
          onSent={() => {
            setSendOpen(false);
            exitSelection();
            void load();
            onTitleUpdated();
          }}
        />
      )}

      {quickSendPrep && (
        <SendEcerPrepsDialog
          open={!!quickSendPrep}
          preps={[quickSendPrep]}
          title={title}
          itemName={item.name}
          customers={customers}
          onClose={() => setQuickSendPrep(null)}
          onSent={() => {
            setQuickSendPrep(null);
            void load();
            onTitleUpdated();
          }}
        />
      )}

      <WorkerSubmissionsCard title={title} itemName={item.name} />
    </div>
  );
}

// ---- Worker submissions card (kiriman pegawai untuk judul ini) ----
type WorkerShot = {
  id: string;
  photo_path: string | null;
  photo_paths?: string[] | null;
  location_url: string | null;
  submitted_at: string;
  thumb_url?: string | null;
  match: "strict" | "fallback_grams" | "fallback_wid";
};

async function resolvePrepUrl(path: string, expires = 60 * 60): Promise<string | null> {
  const a = await prepSignedUrl(path, expires);
  if (a) return a;
  return await ecerSignedUrl(path, expires);
}

function normUnitStr(u: string | null | undefined) {
  return (u ?? "").trim().toLowerCase();
}

/**
 * Parse a location URL (usually Google Maps) into a human-readable label
 * plus a short kind badge, so the confirm-dialog preview can show what the
 * `📍` line will look like before sending.
 *
 * Handles:
 *  - google.com/maps?q=lat,lng           → "Koordinat: -6.20, 106.80"
 *  - google.com/maps?q=Nama+Tempat        → "Nama Tempat"
 *  - google.com/maps/place/Nama/…         → "Nama"
 *  - google.com/maps/@lat,lng,zoom        → "Koordinat: -6.20, 106.80"
 *  - maps.app.goo.gl / short links        → null label (URL only)
 */
function describeLocationUrl(raw: string): { label: string | null; kind: string | null } {
  const url = (raw ?? "").trim();
  if (!url) return { label: null, kind: null };
  let u: URL;
  try { u = new URL(url); } catch { return { label: null, kind: null }; }
  const host = u.hostname.toLowerCase();
  const decode = (s: string) => {
    try { return decodeURIComponent(s.replace(/\+/g, " ")).trim(); } catch { return s.trim(); }
  };
  const coordRe = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;
  const fmtCoord = (lat: string, lng: string) => {
    const la = Number(lat), ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
    return `Koordinat: ${la.toFixed(5)}, ${ln.toFixed(5)}`;
  };
  // ?q= parameter
  const q = u.searchParams.get("q") ?? u.searchParams.get("query");
  if (q) {
    const m = q.match(coordRe);
    if (m) {
      const c = fmtCoord(m[1], m[2]);
      if (c) return { label: c, kind: "GPS" };
    }
    const name = decode(q);
    if (name) return { label: name, kind: "Nama tempat" };
  }
  // /maps/place/Nama/…
  const placeMatch = u.pathname.match(/\/maps\/place\/([^/]+)/i);
  if (placeMatch?.[1]) {
    return { label: decode(placeMatch[1]), kind: "Nama tempat" };
  }
  // /maps/@lat,lng,zoom
  const atMatch = u.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (atMatch) {
    const c = fmtCoord(atMatch[1], atMatch[2]);
    if (c) return { label: c, kind: "GPS" };
  }
  // Short-link hosts — can't resolve without network
  if (/(^|\.)maps\.app\.goo\.gl$/.test(host) || /(^|\.)goo\.gl$/.test(host)) {
    return { label: null, kind: "Short link" };
  }
  return { label: null, kind: null };
}

function WorkerSubmissionsCard({ title, itemName }: { title: EcerTitle; itemName: string }) {
  const [shots, setShots] = useState<WorkerShot[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Tugas pegawai yang terhubung ke judul ecer ini (lewat
   * prep_task_items.ecer_title_id). Dipakai agar tombol "Kirim perintah"
   * membawa link tugas UNIK per judul — bukan pesan generik yang sama
   * untuk semua judul.
   */
  const [linkedTask, setLinkedTask] = useState<{
    task_id: string;
    share_token: string;
    task_title: string | null;
    item_id: string;
    qty_requested: number | null;
    unit_label: string | null;
    note: string | null;
    ref_photo_path: string | null;
  } | null>(null);
  // Per-folder (per-kiriman) send state
  const [waSendingId, setWaSendingId] = useState<string | null>(null);
  const [chatSendingId, setChatSendingId] = useState<string | null>(null);
  const [chatPickShot, setChatPickShot] = useState<WorkerShot | null>(null);
  type PreviewReq = {
    title: string;
    description: string;
    confirmText: string;
    paths: string[];
    locationUrl?: string | null;
    /** Mapping foto→lokasi per kiriman. Bila diberikan, pratinjau lokasi
     *  dihitung live: hanya kiriman yang masih punya minimal 1 foto tersisa
     *  (tidak dikecualikan) yang lokasinya dianggap ikut terkirim. */
    shotLocations?: Array<{ paths: string[]; locationUrl: string | null }>;
    persistKey?: string;
    /** Membangun caption/pesan persis seperti yang akan dikirim
     *  berdasar jumlah foto yang tersisa (paths.length - excluded).
     *  `effectiveLocationUrl` sudah dihitung dari exclusion agar caption
     *  konsisten dengan preview lokasi.
     *  Dipakai untuk menampilkan preview live di dialog konfirmasi. */
    buildCaption?: (remaining: number, effectiveLocationUrl: string | null) => string;
    /** Label pendek untuk header preview caption ("WhatsApp" / "MCM Chat"). */
    captionLabel?: string;
    resolve: (v: { ok: boolean; excluded: Set<string> }) => void;
  };
  const [previewReq, setPreviewReq] = useState<PreviewReq | null>(null);
  const [previewUrls, setPreviewUrls] = useState<string[] | null>(null);
  const [excludedPaths, setExcludedPaths] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!previewReq) { setPreviewUrls(null); setExcludedPaths(new Set()); return; }
    let cancelled = false;
    setPreviewUrls(null);
    // Hydrate excluded selection from localStorage per persistKey; prune stale
    // entries that are no longer part of the current paths list.
    let hydrated = new Set<string>();
    if (previewReq.persistKey) {
      try {
        const raw = localStorage.getItem(`ecer:excluded:${previewReq.persistKey}`);
        if (raw) {
          const arr = JSON.parse(raw) as string[];
          const valid = new Set(previewReq.paths);
          hydrated = new Set(arr.filter((p) => valid.has(p)));
        }
      } catch { /* ignore */ }
    }
    setExcludedPaths(hydrated);
    (async () => {
      const capped = previewReq.paths.slice(0, 12);
      const urls = await Promise.all(capped.map((p) => resolvePrepUrl(p, 600).catch(() => null)));
      if (!cancelled) setPreviewUrls(urls.map((u) => u ?? ""));
    })();
    return () => { cancelled = true; };
  }, [previewReq]);
  function confirmWithPreview(
    opts: Omit<PreviewReq, "resolve">,
  ): Promise<{ ok: boolean; excluded: Set<string> }> {
    return new Promise((resolve) => setPreviewReq({ ...opts, resolve }));
  }
  function finishPreview(ok: boolean) {
    const r = previewReq;
    const excluded = ok ? new Set(excludedPaths) : new Set<string>();
    // Persist the latest selection so reopening the same folder restores it.
    if (r?.persistKey) {
      try {
        const key = `ecer:excluded:${r.persistKey}`;
        if (excludedPaths.size === 0) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(Array.from(excludedPaths)));
      } catch { /* ignore */ }
    }
    setPreviewReq(null);
    r?.resolve({ ok, excluded });
  }
  function togglePathExcluded(p: string) {
    setExcludedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      if (previewReq?.persistKey) {
        try {
          const key = `ecer:excluded:${previewReq.persistKey}`;
          if (next.size === 0) localStorage.removeItem(key);
          else localStorage.setItem(key, JSON.stringify(Array.from(next)));
        } catch { /* ignore */ }
      }
      return next;
    });
  }

  // Turunan live: jumlah foto yang tersisa & caption preview — dihitung ulang
  // setiap kali `previewReq` atau `excludedPaths` berubah, sehingga UI dialog
  // konfirmasi langsung memperbarui saat user meng-toggle pengecualian foto
  // tanpa harus menutup/membuka dialog lagi.
  const previewRemaining = useMemo(() => {
    if (!previewReq) return 0;
    if (previewReq.paths.length === 0) return 0;
    const excludedInPaths = Array.from(excludedPaths).filter((p) => previewReq.paths.includes(p)).length;
    return previewReq.paths.length - excludedInPaths;
  }, [previewReq, excludedPaths]);
  // Lokasi yang benar-benar akan terkirim, dihitung live dari
  // shotLocations + excludedPaths. Bila salah satu kiriman masih memiliki
  // paling sedikit satu foto tidak dikecualikan, lokasi kiriman pertama
  // seperti itu dipakai sebagai `📍` di caption. Fallback ke locationUrl
  // statis bila shotLocations tidak diberikan.
  const effectiveLocationUrl = useMemo<string | null>(() => {
    if (!previewReq) return null;
    if (previewReq.shotLocations && previewReq.shotLocations.length > 0) {
      for (const sl of previewReq.shotLocations) {
        if (!sl.locationUrl) continue;
        const anyLeft = sl.paths.some((p) => !excludedPaths.has(p));
        if (anyLeft) return sl.locationUrl;
      }
      return null;
    }
    return previewReq.locationUrl ?? null;
  }, [previewReq, excludedPaths]);
  const previewCaption = useMemo(() => {
    if (!previewReq?.buildCaption) return null;
    if (previewReq.paths.length > 0 && previewRemaining === 0) return null;
    try {
      return previewReq.buildCaption(previewRemaining, effectiveLocationUrl);
    } catch {
      return null;
    }
  }, [previewReq, previewRemaining, effectiveLocationUrl]);

  const targetUnit = normUnitStr(title.unit_label);
  const targetGrams = Number(title.target_grams) || 0;
  const displayUnitStr = itemName.trim().toLowerCase() === "gs" ? "botol" : (title.unit_label ?? "");

  async function load() {
    setError(null);
    // Routing STRICT: kiriman pegawai hanya tampil di folder ecer yang
    // sama persis dengan `prep_task_items.ecer_title_id`. Ini menghindari
    // "campur" antar folder untuk produk multi-judul (mis. PASIR punya
    // KRISTAL 1G/ST/SPR + PASIR). Auto-resolve ecer_title_id dijalankan
    // di DB (trigger prep_task_items_resolve_ecer_title). Task item yang
    // ecer_title_id-nya NULL — mis. produk tanpa judul ecer sama sekali —
    // muncul di halaman /request pada section "Kiriman tanpa folder".
    if (!title.id) {
      setShots([]);
      setLoading(false);
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: tItems, error: e1 } = await (supabase.from as any)("prep_task_items")
        .select("id,qty_requested,unit_label,warehouse_item_id,ecer_title_id")
        .eq("ecer_title_id", title.id);
      if (e1) throw new Error(e1.message);
      const items = (tItems ?? []) as Array<{
        id: string;
        qty_requested: number | null;
        unit_label: string | null;
        warehouse_item_id: string | null;
        ecer_title_id: string | null;
      }>;
      if (items.length === 0) { setShots([]); return; }

      // Semua task_item di sini sudah pasti terikat ke title.id via
      // ecer_title_id. Tandai "strict" bila qty+unit persis, else
      // "fallback_grams" (produk sama, qty berbeda — misal admin membuat
      // task dgn qty tak persis tapi tetap link ke judul ini secara manual).
      const matchKindByItem = new Map<string, "strict" | "fallback_grams">();
      for (const it of items) {
        const u = normUnitStr(it.unit_label);
        const g = Number(it.qty_requested) || 0;
        matchKindByItem.set(
          it.id,
          u === targetUnit && g === targetGrams ? "strict" : "fallback_grams",
        );
      }
      const ids = Array.from(matchKindByItem.keys());
      if (ids.length === 0) { setShots([]); return; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: subs, error: e2 } = await (supabase.from as any)("prep_submissions")
        .select("id,photo_path,photo_paths,location_url,submitted_at,task_item_id")
        .in("task_item_id", ids)
        .order("submitted_at", { ascending: false })
        .limit(60);
      if (e2) throw new Error(e2.message);
      const rows = ((subs ?? []) as Array<{ id: string; photo_path: string | null; photo_paths: string[] | null; location_url: string | null; submitted_at: string; task_item_id: string }>)
        .map((s) => ({
          id: s.id,
          photo_path: s.photo_path,
          photo_paths: s.photo_paths,
          location_url: s.location_url,
          submitted_at: s.submitted_at,
          match: matchKindByItem.get(s.task_item_id) ?? "fallback_grams",
        }) as WorkerShot);
      // Resolve thumb URLs in parallel
      await Promise.all(rows.map(async (r) => {
        if (r.photo_path) r.thumb_url = await resolvePrepUrl(r.photo_path);
      }));
      setShots(rows);
    } catch (err) {
      setError((err as Error).message);
      setShots([]);
    }
  }

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
    const ch = supabase.channel(`worker_subs_${title.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "prep_submissions" }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title.id, title.warehouse_item_id, targetGrams, targetUnit]);

  // Cari tugas pegawai yang terhubung ke judul ini via
  // prep_task_items.ecer_title_id. Bila ada beberapa, ambil yang terbaru
  // (task.created_at desc) supaya link yang dibagikan adalah yang paling
  // aktual. Tanpa keterikatan ini, "Kirim perintah" jatuh ke pesan generik.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from as any)("prep_task_items")
        .select("id,task_id,qty_requested,unit_label,note,ref_photo_path,warehouse_item_id,prep_tasks:task_id(id,share_token,title,created_at,expires_at)")
        .eq("ecer_title_id", title.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (cancelled) return;
      const row = (data ?? [])[0] as (
        | {
            task_id: string;
            qty_requested: number | null;
            unit_label: string | null;
            note: string | null;
            ref_photo_path: string | null;
            warehouse_item_id: string | null;
            prep_tasks: { id: string; share_token: string; title: string | null; created_at: string; expires_at: string | null } | null;
          }
        | undefined
      );
      if (!row || !row.prep_tasks?.share_token) { setLinkedTask(null); return; }
      setLinkedTask({
        task_id: row.task_id,
        share_token: row.prep_tasks.share_token,
        task_title: row.prep_tasks.title,
        item_id: row.warehouse_item_id ?? "",
        qty_requested: row.qty_requested,
        unit_label: row.unit_label,
        note: row.note,
        ref_photo_path: row.ref_photo_path,
      });
    })();
    return () => { cancelled = true; };
  }, [title.id]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function sendWA() {
    if (sending) return;
    const take = Math.min(shots.length, 6);
    let ok: boolean;
    let excludedSet: Set<string> = new Set();
    let previewTotal = 0;
    if (shots.length === 0) {
      ok = await confirm({
        title: "Kirim perintah penyiapan?",
        description: linkedTask
          ? `Akan dikirim perintah untuk *${title.name}* (${title.target_grams} ${displayUnitStr}) beserta *link tugas unik* ke halaman pegawai.`
          : `Belum ada tugas pegawai untuk judul *${title.name}*. Buat dulu di halaman Tugas Baru agar link penyiapan bisa dilampirkan. Kirim tetap sebagai perintah teks?`,
        confirmText: "Kirim WA",
      });
    } else {
      const previewShots = shots.slice(0, take);
      const allPaths = previewShots.flatMap((s) => shotPaths(s)).slice(0, 12);
      previewTotal = allPaths.length;
      const shotLocations = previewShots.map((s) => ({
        paths: shotPaths(s),
        locationUrl: s.location_url ?? null,
      }));
      // Builder caption bulk WA — persis mirror teks yang dibangun setelah
      // konfirmasi di bawah. `files.length` disimulasikan dengan
      // min(remaining, 10) karena WA share dibatasi 10 lampiran.
      const bulkLines = previewShots.map((s) => `• ${title.name} — ${new Date(s.submitted_at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`);
      const buildBulkCaption = (remaining: number, effLoc: string | null) => {
        const simulatedFiles = Math.min(remaining, 10);
        const excludedCount = previewTotal - remaining;
        return [
          `*${title.name}* (${itemName} · ${title.target_grams} ${displayUnitStr})`,
          `${shots.length} kiriman pegawai${shots.length > take ? ` (mengirim ${take})` : ""} · ${simulatedFiles} foto terkirim${excludedCount > 0 ? ` · ${excludedCount} dari ${previewTotal} dikecualikan` : ""}:`,
          ...bulkLines,
          ...(effLoc ? [`📍 ${effLoc}`] : []),
        ].join("\n");
      };
      const res = await confirmWithPreview({
        title: `Kirim ${take} kiriman via WhatsApp?`,
        description: `Judul: *${title.name}* (${itemName} · ${title.target_grams} ${displayUnitStr})\n${take} folder · ${allPaths.length} foto (maks 10 terlampir)\n\nPastikan semua foto dan link lokasi sudah benar sebelum dikirim.`,
        confirmText: "Kirim WA",
        paths: allPaths,
        shotLocations,
        persistKey: `title:${title.id}`,
        buildCaption: buildBulkCaption,
        captionLabel: "WhatsApp",
      });
      ok = res.ok;
      excludedSet = res.excluded;
      if (previewTotal > 0 && excludedSet.size >= previewTotal) {
        toast.warning("Semua foto dikecualikan. Batal kirim.");
        return;
      }
    }
    if (!ok) return;
    setSending(true);
    try {
      // Belum ada kiriman pegawai → kirim *perintah* teks-only ke pegawai
      // supaya owner tetap bisa memicu tugas langsung dari halaman detail
      // penyiapan, tanpa harus pindah ke halaman Tugas terlebih dahulu.
      if (shots.length === 0) {
        // Bangun pesan perintah UNIK per judul: menyertakan link publik
        // tugas pegawai (`/t/<token>`) beserta catatan/target khusus judul
        // ini. Bila tidak ada tugas yang terhubung, fallback ke teks
        // generik lama supaya alur tetap berjalan.
        const noteLine = linkedTask?.note?.trim() ? `Catatan: ${linkedTask.note.trim()}` : null;
        const taskUrl = linkedTask ? publicTaskUrl(linkedTask.share_token) : null;
        const qtyLine = linkedTask?.qty_requested
          ? `Jumlah diminta: *${linkedTask.qty_requested} ${linkedTask.unit_label ?? displayUnitStr}*`
          : null;
        const text = [
          `📦 *Perintah penyiapan* — ${title.name}`,
          `Produk: ${itemName}`,
          `Target per kotak: *${title.target_grams} ${displayUnitStr}*`,
          ...(qtyLine ? [qtyLine] : []),
          ...(noteLine ? [noteLine] : []),
          `ID judul: ${title.id}`,
          ...(taskUrl
            ? [
                "",
                "🔗 Link tugas (khusus judul ini):",
                taskUrl,
                "Buka link, masukkan PIN yang diberikan, lalu unggah foto + lokasi untuk *judul ini saja*.",
              ]
            : [
                "",
                "Belum ada link tugas untuk judul ini. Buat lewat menu *Tugas Baru* di aplikasi MCM lalu bagikan ulang.",
              ]),
        ].join("\n");
        const res = await shareToWhatsApp({ text, title: title.name });
        notifyShareResult(res);
        return;
      }
      const sendShots = shots.slice(0, take);
      const files: File[] = [];
      for (const s of sendShots) {
        const paths = Array.from(new Set([
          ...((s.photo_paths ?? []) as string[]),
          ...(s.photo_path ? [s.photo_path] : []),
        ])).filter(Boolean).filter((p) => !excludedSet.has(p));
        for (let pi = 0; pi < paths.length; pi++) {
          const url = await resolvePrepUrl(paths[pi], 600);
          if (!url) continue;
          const f = await urlToFile(url, `${title.name}-${s.id.slice(0, 6)}-${pi + 1}.jpg`);
          if (f) files.push(f);
          if (files.length >= 10) break;
        }
        if (files.length >= 10) break;
      }
      if (files.length === 0) toast.warning("Foto pegawai tidak bisa diunduh.");
      const lines = sendShots.map((s) => `• ${title.name} — ${new Date(s.submitted_at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`);
      // Lokasi efektif: kiriman pertama yang punya lokasi DAN masih memiliki
      // paling sedikit satu foto tidak dikecualikan. Konsisten dengan
      // pratinjau live di dialog konfirmasi.
      const firstLocShot = sendShots.find((s) => {
        if (!s.location_url) return false;
        const ps = shotPaths(s);
        return ps.some((p) => !excludedSet.has(p));
      });
      const excludedCount = excludedSet.size;
      const totalPaths = previewTotal;
      const text = [
        `*${title.name}* (${itemName} · ${title.target_grams} ${displayUnitStr})`,
        `${shots.length} kiriman pegawai${shots.length > take ? ` (mengirim ${take})` : ""} · ${files.length} foto terkirim${excludedCount > 0 ? ` · ${excludedCount} dari ${totalPaths} dikecualikan` : ""}:`,
        ...lines,
        ...(firstLocShot ? [`📍 ${firstLocShot.location_url}`] : []),
      ].join("\n");
      const res = await shareToWhatsApp({ text, title: title.name, files });
      notifyShareResult(res);
    } catch (err) {
      toast.error(`Gagal kirim WA: ${(err as Error).message}`);
    } finally {
      setSending(false);
    }
  }

  function shotPaths(s: WorkerShot): string[] {
    return Array.from(new Set([
      ...((s.photo_paths ?? []) as string[]),
      ...(s.photo_path ? [s.photo_path] : []),
    ])).filter(Boolean);
  }

  function shotCaption(s: WorkerShot, opts?: { sentCount?: number; excludedCount?: number }): string {
    const stamp = new Date(s.submitted_at).toLocaleString("id-ID", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
    const totalPaths = shotPaths(s).length;
    const excludedCount = opts?.excludedCount ?? 0;
    const sentCount = opts?.sentCount ?? totalPaths;
    const lines = [
      `*${title.name}* (${itemName} · ${title.target_grams} ${displayUnitStr})`,
      `Kiriman pegawai — ${stamp} · ${sentCount} foto terkirim${excludedCount > 0 ? ` · ${excludedCount} dikecualikan` : ""}`,
    ];
    if (s.location_url) lines.push(`📍 ${s.location_url}`);
    return lines.join("\n");
  }

  async function sendShotWA(s: WorkerShot) {
    if (waSendingId) return;
    const allPaths = shotPaths(s);
    const res = await confirmWithPreview({
      title: "Kirim folder via WhatsApp?",
      description: `Judul: *${title.name}* (${itemName} · ${title.target_grams} ${displayUnitStr})\n${allPaths.length} foto${s.location_url ? "" : "\nTanpa link lokasi"}\n\nPastikan semua foto dan link lokasi sudah benar sebelum dikirim.`,
      confirmText: "Kirim WA",
      paths: allPaths,
      locationUrl: s.location_url,
      persistKey: `shot:${s.id}`,
      buildCaption: (remaining) =>
        shotCaption(s, { sentCount: remaining, excludedCount: allPaths.length - remaining }),
      captionLabel: "WhatsApp",
    });
    if (!res.ok) return;
    const paths = allPaths.filter((p) => !res.excluded.has(p));
    const excludedCount = allPaths.length - paths.length;
    if (paths.length === 0) { toast.warning("Semua foto dikecualikan. Batal kirim."); return; }
    setWaSendingId(s.id);
    try {
      const files: File[] = [];
      for (let pi = 0; pi < paths.length; pi++) {
        const url = await resolvePrepUrl(paths[pi], 600);
        if (!url) continue;
        const f = await urlToFile(url, `${title.name}-${s.id.slice(0, 6)}-${pi + 1}.jpg`);
        if (f) files.push(f);
      }
      if (files.length === 0) {
        toast.warning("Foto tidak bisa diunduh untuk dilampirkan.");
      }
      const waRes = await shareToWhatsApp({ text: shotCaption(s, { sentCount: files.length, excludedCount }), title: title.name, files });
      notifyShareResult(waRes);
    } catch (err) {
      toast.error(`Gagal kirim WA: ${(err as Error).message}`);
    } finally {
      setWaSendingId(null);
    }
  }

  async function sendShotChat(
    s: WorkerShot,
    conversationId: string,
    convTitle: string,
    orderedPaths?: string[],
  ) {
    if (chatSendingId) return;
    setChatSendingId(s.id);
    const tid = toast.loading(`Mengirim ke ${convTitle}…`);
    try {
      // Prefer the exact ordered list from the preview modal so attachments
      // follow the thumbnails the user saw (after exclusions). Fallback to
      // shotPaths(s) if caller didn't pass one.
      const paths = orderedPaths ?? shotPaths(s);
      const chatShots: { id: string; file: File }[] = [];
      for (let i = 0; i < paths.length; i++) {
        const url = await resolvePrepUrl(paths[i], 600);
        if (!url) continue;
        const f = await urlToFile(url, `${title.name}-${s.id.slice(0, 6)}-${i + 1}.jpg`);
        if (f) chatShots.push({ id: `${s.id}:${i}`, file: f });
      }
      // Hitung foto yang benar-benar dikonfirmasi backend via onProgress.
      // Ini yang dipakai untuk validasi ringkasan vs status backend setelah
      // proses kirim selesai.
      let confirmedPhotos = 0;
      const claimedPhotos = chatShots.length;
      const excludedCount = shotPaths(s).length - paths.length;
      const result = await shareToChat({
        conversationId,
        caption: shotCaption(s, { sentCount: claimedPhotos, excludedCount }),
        locationUrl: s.location_url,
        shots: chatShots,
        onProgress: (p) => {
          if (p.type === "photo" && p.status === "ok") confirmedPhotos++;
        },
      });
      toast.dismiss(tid);
      if (result.status === "shared") {
        if (confirmedPhotos < claimedPhotos) {
          // Ringkasan di caption mengklaim `claimedPhotos`, tapi backend hanya
          // mengonfirmasi `confirmedPhotos`. Beri tahu pengguna agar bisa
          // menindaklanjuti foto yang tidak terkirim.
          toast.warning(
            `Ringkasan tidak cocok: caption menyebut ${claimedPhotos} foto, tapi ${confirmedPhotos} yang terkonfirmasi terkirim.`,
            {
              description: `${claimedPhotos - confirmedPhotos} foto gagal diunggah ke ${convTitle}. Ulangi kirim untuk foto yang tersisa.`,
              duration: 10000,
            },
          );
        } else {
          toast.success(
            `Terkirim ke ${convTitle} — ${confirmedPhotos} foto terkonfirmasi (${result.messageCount} pesan).`,
          );
        }
      } else {
        toast.error(`Gagal mengirim: ${result.error}`);
      }
    } catch (e) {
      toast.dismiss(tid);
      toast.error((e as Error)?.message || "Gagal mengirim ke MCM Chat.");
    } finally {
      setChatSendingId(null);
    }
  }

  return (
    <Card id={`worker-shots-${title.id}`} className="scroll-mt-20 transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-1.5 text-sm leading-snug">
              <Users className="h-4 w-4 text-primary" /> Kiriman pegawai
              {!loading && (
                <span
                  className="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full bg-muted px-2 text-[11px] font-medium leading-none text-muted-foreground tabular-nums"
                  title={`${shots.length} kiriman`}
                >
                  {shots.length}
                </span>
              )}
            </CardTitle>
            <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              Cocok via warehouse_item_id + {title.target_grams}{displayUnitStr} (fallback ukuran/unit).
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing || loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Segarkan
            </Button>
            <Button
              size="sm"
              onClick={sendWA}
              disabled={sending}
              aria-label={
                shots.length === 0
                  ? "Kirim perintah penyiapan ke pegawai via WhatsApp"
                  : `Kirim ${shots.length} kiriman pegawai via WhatsApp`
              }
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              {shots.length === 0 ? "Kirim perintah" : "Kirim WA"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!title.warehouse_item_id ? (
          <div className="rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 p-4 text-center text-xs text-amber-700 dark:text-amber-300">
            Judul ini belum terhubung ke produk gudang (<code>warehouse_item_id</code> kosong), jadi tidak bisa mencocokkan kiriman pegawai. Set produk gudang pada judul ini terlebih dahulu.
          </div>
        ) : loading ? (
          <div className="py-6 text-center text-xs text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin" /> Memuat kiriman pegawai…</div>
        ) : error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            Gagal memuat: {error}
          </div>
        ) : shots.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
            Belum ada kiriman pegawai untuk judul ini. Bagikan link tugas ke pegawai dari halaman Tugas.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {shots.map((s) => {
              const paths = shotPaths(s);
              const isWa = waSendingId === s.id;
              const isChat = chatSendingId === s.id;
              return (
              <div key={s.id} className="group relative flex flex-col overflow-hidden rounded-md border bg-muted">
                <div className="relative aspect-square">
                  {s.thumb_url ? (
                    <img src={s.thumb_url} alt="" className="h-full w-full object-cover transition group-hover:scale-105" loading="lazy" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[11px] text-muted-foreground">no img</div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/80 to-transparent p-1.5 text-[11px] leading-snug text-white">
                  <span className="truncate">{new Date(s.submitted_at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  {s.location_url && (
                    <a href={s.location_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 rounded bg-black/50 px-1 py-0.5 backdrop-blur-sm">
                      <MapPin className="h-2.5 w-2.5" /> GPS
                    </a>
                  )}
                  </div>
                {s.match !== "strict" && (
                  <span
                    className="absolute left-1 top-1 inline-flex h-5 max-w-[80%] items-center whitespace-nowrap rounded-full bg-amber-500/90 px-1.5 text-[11px] font-semibold leading-none text-white"
                    title={s.match === "fallback_grams" ? "Ukuran cocok, unit berbeda" : "Hanya produk yang cocok"}
                  >
                    {s.match === "fallback_grams" ? "unit≠" : "ukuran≠"}
                  </span>
                )}
                  <span
                    className="absolute right-1 top-1 inline-flex h-5 items-center gap-0.5 whitespace-nowrap rounded-full bg-black/60 px-1.5 text-[11px] font-semibold leading-none text-white backdrop-blur-sm"
                    title={`${paths.length} foto dalam folder ini`}
                  >
                    <ImageIcon className="h-2.5 w-2.5" /> {paths.length}
                  </span>
                </div>
                <div className="flex items-center gap-1 border-t bg-card p-1">
                  <button
                    type="button"
                    onClick={() => void sendShotWA(s)}
                    disabled={isWa || isChat}
                    aria-label={`Kirim folder (${paths.length} foto) via WhatsApp`}
                    title={`Kirim ${paths.length} foto + lokasi via WhatsApp`}
                    className="inline-flex h-7 flex-1 shrink-0 items-center justify-center gap-1 rounded bg-[#25D366] px-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-[#1ebe57] disabled:opacity-50"
                  >
                    {isWa ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageCircle className="h-3 w-3" />}
                    WA
                  </button>
                  <button
                    type="button"
                    onClick={() => setChatPickShot(s)}
                    disabled={isWa || isChat}
                    aria-label={`Kirim folder (${paths.length} foto) via MCM Chat`}
                    title={`Kirim ${paths.length} foto + lokasi via MCM Chat`}
                    className="inline-flex h-7 flex-1 shrink-0 items-center justify-center gap-1 rounded bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-50"
                  >
                    {isChat ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                    Chat
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </CardContent>
      <PickChatConversationDialog
        open={!!chatPickShot}
        onOpenChange={(v) => { if (!v) setChatPickShot(null); }}
        title={`Kirim folder "${title.name}" ke MCM Chat`}
        onPick={(conversationId, displayTitle) => {
          const target = chatPickShot;
          setChatPickShot(null);
          if (!target) return;
          const paths = shotPaths(target);
          void confirmWithPreview({
            title: `Kirim folder ke ${displayTitle}?`,
            description: `Percakapan: *${displayTitle}*\nJudul: *${title.name}* (${itemName} · ${title.target_grams} ${displayUnitStr})\n${paths.length} foto${target.location_url ? "" : "\nTanpa link lokasi"}\n\nPastikan semua foto dan link lokasi sudah benar sebelum dikirim.`,
            confirmText: "Kirim Chat",
            paths,
            locationUrl: target.location_url,
            persistKey: `shot:${target.id}`,
            buildCaption: (remaining) =>
              shotCaption(target, { sentCount: remaining, excludedCount: paths.length - remaining }),
            captionLabel: "MCM Chat",
          }).then((res) => {
            if (!res.ok) return;
            const remaining = paths.filter((p) => !res.excluded.has(p));
            if (remaining.length === 0) {
              toast.warning("Semua foto dikecualikan. Batal kirim.");
              return;
            }
            void sendShotChat(target, conversationId, displayTitle, remaining);
          });
        }}
      />
      <Dialog open={!!previewReq} onOpenChange={(o) => { if (!o) finishPreview(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{previewReq?.title}</DialogTitle>
            {previewReq?.description ? (
              <DialogDescription className="whitespace-pre-line">
                {previewReq.description}
              </DialogDescription>
            ) : null}
            {previewReq && previewReq.paths.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {(() => {
                  const total = previewReq.paths.length;
                  const excluded = Array.from(excludedPaths).filter((p) => previewReq.paths.includes(p)).length;
                  const willSend = total - excluded;
                  return (
                    <>
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                        <span className="tabular-nums">{willSend} / {total}</span>
                        <span className="ml-1 text-[10px] text-muted-foreground">foto akan dikirim</span>
                      </span>
                      {excluded > 0 ? (
                        <span className="inline-flex items-center rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
                          <span className="tabular-nums">{excluded}</span>
                          <span className="ml-1 text-[10px]">dikecualikan</span>
                        </span>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            ) : null}
          </DialogHeader>
          {previewReq && previewReq.paths.length > 0 ? (
            <div className="max-h-[50vh] overflow-y-auto rounded-md border bg-muted/30 p-2">
              <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  Ketuk foto untuk mengecualikan · {Math.min(previewReq.paths.length, 12) - Array.from(excludedPaths).filter((p) => previewReq.paths.slice(0, 12).includes(p)).length}
                  /{Math.min(previewReq.paths.length, 12)} dipilih
                </span>
                {excludedPaths.size > 0 ? (
                  <button
                    type="button"
                    className="text-primary underline"
                    onClick={() => {
                      setExcludedPaths(new Set());
                      if (previewReq?.persistKey) {
                        try { localStorage.removeItem(`ecer:excluded:${previewReq.persistKey}`); } catch { /* ignore */ }
                      }
                    }}
                  >
                    Reset
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(previewUrls ?? new Array(Math.min(previewReq.paths.length, 12)).fill(null)).map((u, i) => (
                  (() => {
                    const p = previewReq.paths[i];
                    const excluded = excludedPaths.has(p);
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => togglePathExcluded(p)}
                        aria-pressed={!excluded}
                        aria-label={excluded ? `Sertakan foto ${i + 1}` : `Kecualikan foto ${i + 1}`}
                        className={`group relative aspect-square overflow-hidden rounded bg-muted ring-1 transition ${excluded ? "ring-destructive" : "ring-transparent hover:ring-primary/40"}`}
                      >
                        {u ? (
                          <img
                            src={u}
                            alt={`Foto ${i + 1}`}
                            loading="lazy"
                            className={`h-full w-full object-cover transition ${excluded ? "opacity-30 grayscale" : ""}`}
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                            {previewUrls ? "×" : "…"}
                          </div>
                        )}
                        <span
                          className={`absolute right-1 top-1 grid h-5 w-5 place-content-center rounded-full text-[10px] font-bold shadow ${excluded ? "bg-destructive text-destructive-foreground" : "bg-background/90 text-foreground"}`}
                          aria-hidden
                        >
                          {excluded ? "×" : "✓"}
                        </span>
                      </button>
                    );
                  })()
                ))}
              </div>
              {previewReq.paths.length > 12 ? (
                <div className="mt-1.5 text-center text-[11px] text-muted-foreground">
                  +{previewReq.paths.length - 12} foto lain tidak ditampilkan
                </div>
              ) : null}
            </div>
          ) : null}
          {effectiveLocationUrl ? (
            (() => {
              const url = effectiveLocationUrl;
              const desc = describeLocationUrl(url);
              return (
                <div className="rounded-md border bg-muted/30 p-2">
                  <div className="mb-1 flex items-center justify-between gap-2 text-[11px] font-medium text-muted-foreground">
                    <span>
                      <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden />
                      Lokasi — akan dilampirkan sebagai baris terakhir caption
                    </span>
                    {desc.kind ? (
                      <span className="rounded bg-background/70 px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
                        {desc.kind}
                      </span>
                    ) : null}
                  </div>
                  {desc.label ? (
                    <div className="mb-1 text-xs font-semibold text-foreground">
                      📍 {desc.label}
                    </div>
                  ) : null}
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-[11px] text-primary underline"
                    title={url}
                  >
                    {url}
                  </a>
                  <div className="mt-1 rounded bg-background/70 p-1.5 text-[11px] leading-relaxed text-foreground">
                    <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Format kirim:</span>
                    <span className="break-all">📍 {url}</span>
                  </div>
                </div>
              );
            })()
          ) : previewReq?.shotLocations && previewReq.shotLocations.some((s) => s.locationUrl) ? (
            <div className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/20 p-2 text-[11px] text-muted-foreground">
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/50" aria-hidden />
              Lokasi tidak akan dilampirkan — semua foto dari kiriman yang punya lokasi telah dikecualikan.
            </div>
          ) : null}
          {(() => {
            if (!previewReq || previewReq.paths.length === 0) return null;
            const remaining = previewReq.paths.length - Array.from(excludedPaths).filter((p) => previewReq.paths.includes(p)).length;
            if (remaining > 0) return null;
            return (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5">
                <div className="flex items-start gap-2 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">Tidak ada foto yang tersisa untuk dikirim</div>
                    <div className="mt-0.5 leading-snug text-muted-foreground">
                      Semua foto telah dikecualikan. Sertakan setidaknya satu foto atau ketuk Reset untuk mengirim semua.
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
          {(() => {
            if (!previewReq?.buildCaption) return null;
            if (previewCaption == null) return null;
            const caption = previewCaption;
            const totalShown = Math.min(previewReq.paths.length, 12);
            const excludedInShown = Array.from(excludedPaths).filter((p) => previewReq.paths.slice(0, 12).includes(p)).length;
            return (
              <div className="rounded-md border bg-muted/30 p-2.5">
                <div className="mb-1 flex items-center justify-between gap-2 text-[11px] font-medium text-muted-foreground">
                  <span>
                    <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden />
                    Preview caption{previewReq.captionLabel ? ` ${previewReq.captionLabel}` : ""} — live · {totalShown - excludedInShown}/{totalShown} foto
                  </span>
                  <span className="tabular-nums">{caption.length} karakter</span>
                </div>
                <pre
                  key={caption}
                  className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded bg-background/70 p-2 text-[11px] leading-relaxed text-foreground"
                >
                  {caption}
                </pre>
              </div>
            );
          })()}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => finishPreview(false)}>Batal</Button>
            <Button
              onClick={() => finishPreview(true)}
              disabled={
                !!previewReq &&
                previewReq.paths.length > 0 &&
                previewReq.paths.length - Array.from(excludedPaths).filter((p) => previewReq.paths.includes(p)).length === 0
              }
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {previewReq?.confirmText ?? "Kirim"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function PrepBox({ prep, index, title, itemName, onChanged, onTitleUpdated, selectionMode, selected, onToggleSelect, onQuickSend }: {
  prep: EcerPreparation; index: number; title: EcerTitle; itemName?: string;
  onChanged: () => void; onTitleUpdated: () => void;
  selectionMode?: boolean; selected?: boolean; onToggleSelect?: () => void;
  onQuickSend?: () => void;
}) {
  const sold = isSentPrep(prep);
  const readOnly = sold;
  const [url, setUrl] = useState<string | null>(null);
  type ShareDiag = {
    when: string;
    online: boolean;
    hasWebShare: boolean;
    canShareFiles: boolean | null;
    photoFetch?: { url: string; ok: boolean; status: number; statusText: string; bytes?: number; error?: string };
    waUrl: string;
    result: unknown;
    error?: string;
  };
  const [shareDiag, setShareDiag] = useState<ShareDiag | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const resolvePhotoUrl = async (path: string | null | undefined, expiresIn?: number) => {
    if (!path) return null;
    // Worker submissions menyimpan foto di bucket `prep-photos`; siapkan-sendiri di `ecer-photos`.
    // Coba bucket sesuai created_by, lalu fallback ke bucket lain agar lampiran WA tetap berhasil.
    const primary = prep.created_by === "worker" ? prepSignedUrl : ecerSignedUrl;
    const secondary = prep.created_by === "worker" ? ecerSignedUrl : prepSignedUrl;
    const a = await primary(path, expiresIn as number);
    if (a) return a;
    return await secondary(path, expiresIn as number);
  };
  useEffect(() => { void resolvePhotoUrl(prep.photo_path).then(setUrl); }, [prep.photo_path, prep.created_by]);

  async function onShare() {
    const text =
      `*${title.name}* #${index}\n` +
      `Berat aktual: ${prep.actual_grams} ${displayUnit(itemName, title.unit_label)}\n` +
      (prep.location_url ? `Lokasi: ${prep.location_url}\n` : "") +
      (prep.note ? `Catatan: ${prep.note}\n` : "");
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    const diag: ShareDiag = {
      when: new Date().toISOString(),
      online: typeof navigator !== "undefined" ? navigator.onLine : true,
      hasWebShare: !!(nav && typeof nav.share === "function"),
      canShareFiles: null,
      waUrl: buildWhatsAppUrl(text),
      result: null,
    };
    let files: File[] | undefined;
    if (prep.photo_path) {
      try {
        const signed = await resolvePhotoUrl(prep.photo_path, 600);
        if (signed) {
          const r = await fetch(signed);
          const blob = r.ok ? await r.blob() : undefined;
          diag.photoFetch = {
            url: signed.split("?")[0] + "?…",
            ok: r.ok, status: r.status, statusText: r.statusText,
            bytes: blob?.size,
          };
          if (blob) {
            files = [new File([blob], `ecer-${prep.id}.jpg`, { type: blob.type || "image/jpeg" })];
          }
        } else {
          diag.photoFetch = { url: "(signed url null)", ok: false, status: 0, statusText: "no signed url" };
        }
      } catch (e) {
        diag.photoFetch = { url: "(exception)", ok: false, status: 0, statusText: "exception", error: (e as Error)?.message ?? String(e) };
      }
    }
    if (files && nav && typeof nav.canShare === "function") {
      try { diag.canShareFiles = nav.canShare({ files }); } catch { diag.canShareFiles = false; }
    }
    try {
      const result = await shareToWhatsApp({ text, files });
      diag.result = result;
      notifyShareResult(result);
      if (result.status !== "shared" && result.status !== "cancelled") {
        setShareDiag(diag);
      }
    } catch (e) {
      diag.error = (e as Error)?.message ?? String(e);
      toast.error("Gagal kirim WA: " + diag.error);
      setShareDiag(diag);
    }
  }

  async function copyDiag() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(shareDiag, null, 2));
      toast.success("Detail disalin");
    } catch (e) {
      toast.error("Gagal menyalin: " + ((e as Error)?.message ?? String(e)));
    }
  }

  async function onDelete() {
    if (readOnly) {
      const t = buildReadOnlyToast("delete", prep);
      toast.error(t.title, { description: t.description });
      return;
    }
    const ok = typeof window !== "undefined" && window.confirm(
      `Hapus penyiapan ini? Stok produk akan dikembalikan sebanyak ${prep.actual_grams} ${displayUnit(itemName, title.unit_label)}.`
    );
    if (!ok) return;
    if (prep.photo_path) await deleteEcerPhoto(prep.photo_path);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from as any)("ecer_preparations").delete().eq("id", prep.id);
    if (error) { toast.error("Gagal: " + error.message); return; }
    toast.success("Dihapus, stok dikembalikan");
    onChanged(); onTitleUpdated();
  }

  return (
    <div
      aria-readonly={readOnly || undefined}
      onClick={selectionMode && !readOnly ? (e) => { e.stopPropagation(); onToggleSelect?.(); } : undefined}
      className={`overflow-hidden rounded-lg border bg-card ${selectionMode && !readOnly ? "cursor-pointer" : ""} ${selected ? "ring-2 ring-primary" : ""} ${readOnly ? "opacity-90" : ""}`}
    >
      <div className="relative aspect-square w-full bg-muted">
        {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : (
          <div className="flex h-full w-full items-center justify-center text-[11px] leading-snug text-muted-foreground">No foto</div>
        )}
        <div className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] leading-snug font-medium text-white">#{index}</div>
        {prep.created_by === "worker" && (
          <div className="absolute right-1 top-1 rounded bg-blue-500/90 px-1.5 py-0.5 text-[11px] leading-snug font-medium text-white">Pegawai</div>
        )}
        {sold && (
          <div className="absolute inset-x-1 bottom-1 rounded bg-emerald-600/90 px-1.5 py-0.5 text-[10px] leading-snug font-semibold text-white">
            Terkirim{prep.sold_party_name ? ` · ${prep.sold_party_name}` : ""}
          </div>
        )}
        {selectionMode && !readOnly && (
          <div className={`absolute right-1 bottom-1 flex h-6 w-6 items-center justify-center rounded-full border-2 ${selected ? "border-primary bg-primary text-primary-foreground" : "border-white/80 bg-black/40 text-white"}`}>
            {selected ? <CheckCircle2 className="h-4 w-4" /> : null}
          </div>
        )}
      </div>
      <div className="space-y-1 p-2">
        <div className="text-xs font-semibold">{prep.actual_grams} {displayUnit(itemName, title.unit_label)}</div>
        {prep.note && <div className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{prep.note}</div>}
        {sold && (
          <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-1 text-[10px] leading-snug text-emerald-800 dark:text-emerald-200">
            {formatSoldPaymentSummary(
              prep.sold_payment_method,
              Number(prep.sold_total ?? 0),
              Number(prep.sold_paid_amount ?? 0),
            )}
            {prep.sold_at && <> · {new Date(prep.sold_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}</>}
          </div>
        )}
        <div className="flex items-center justify-between gap-1 pt-1">
          {prep.location_url ? (
            <a href={prep.location_url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-[11px] leading-snug text-primary hover:underline">
              <MapPin className="h-3 w-3" /> Lokasi <ExternalLink className="h-2.5 w-2.5" />
            </a>
          ) : <span />}
          <div className="flex gap-0.5">
            {!readOnly && (
              <>
                <Button size="icon" variant="ghost" className="h-7 w-7" title="Kirim ke pembeli via WA" onClick={(e) => { e.stopPropagation(); if (onQuickSend) onQuickSend(); else void onShare(); }}><Share2 className="h-3 w-3" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setEditOpen(true); }} title="Edit penyiapan"><Edit3 className="h-3 w-3" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); void onDelete(); }}><Trash2 className="h-3 w-3 text-destructive" /></Button>
              </>
            )}
          </div>
        </div>
        <div className="text-[11px] leading-snug text-muted-foreground">
          {new Date(prep.created_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
        </div>
        {shareDiag && (
          <div className="mt-1 space-y-1 rounded border border-destructive/40 bg-destructive/5 p-2 text-[11px] leading-snug">
            <div className="flex items-center justify-between gap-1">
              <span className="font-semibold text-destructive">Diagnostik kirim WA</span>
              <button type="button" onClick={() => setShareDiag(null)} className="text-muted-foreground hover:underline">Tutup</button>
            </div>
            <div>Jaringan: <span className={shareDiag.online ? "text-emerald-600" : "text-destructive"}>{shareDiag.online ? "online" : "offline"}</span></div>
            <div>Web Share API: {shareDiag.hasWebShare ? "ya" : "tidak"}{shareDiag.canShareFiles !== null && ` · file: ${shareDiag.canShareFiles ? "didukung" : "tidak"}`}</div>
            {shareDiag.photoFetch && (
              <div>
                Foto: {shareDiag.photoFetch.ok ? "ok" : "gagal"} ({shareDiag.photoFetch.status} {shareDiag.photoFetch.statusText})
                {typeof shareDiag.photoFetch.bytes === "number" && ` · ${shareDiag.photoFetch.bytes} B`}
                {shareDiag.photoFetch.error && ` · ${shareDiag.photoFetch.error}`}
              </div>
            )}
            <div className="break-all">wa.me: {shareDiag.waUrl}</div>
            <div className="break-all">Hasil: {JSON.stringify(shareDiag.result)}</div>
            {shareDiag.error && <div className="text-destructive">Error: {shareDiag.error}</div>}
            <div className="flex gap-1 pt-1">
              <button type="button" onClick={copyDiag} className="rounded border px-2 py-0.5 hover:bg-accent">Salin detail</button>
              <a href={shareDiag.waUrl} target="_blank" rel="noreferrer" className="rounded border px-2 py-0.5 hover:bg-accent">Buka wa.me</a>
              <button type="button" onClick={onShare} className="rounded border px-2 py-0.5 hover:bg-accent">Coba lagi</button>
            </div>
          </div>
        )}
      </div>
      {editOpen && (
        <PrepEditDialog
          prep={prep}
          title={title}
          itemName={itemName}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            onChanged();
            onTitleUpdated();
          }}
        />
      )}
    </div>
  );
}

function PrepEditDialog({
  prep, title, itemName, onClose, onSaved,
}: {
  prep: EcerPreparation;
  title: EcerTitle;
  itemName?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [actual, setActual] = useState(String(prep.actual_grams));
  const [locUrl, setLocUrl] = useState(prep.location_url ?? "");
  const [note, setNote] = useState(prep.note ?? "");
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(
    prep.gps_lat != null && prep.gps_lng != null ? { lat: Number(prep.gps_lat), lng: Number(prep.gps_lng) } : null,
  );
  const [locBusy, setLocBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  async function takeLocation() {
    setLocBusy(true);
    const id = toast.loading("Mengambil lokasi…");
    try {
      const { getCurrentLocation } = await import("@/lib/get-location");
      const { lat, lng } = await getCurrentLocation();
      setGps({ lat, lng });
      setLocUrl(`https://www.google.com/maps?q=${lat},${lng}`);
      toast.success("Lokasi terisi", { id });
    } catch (e) {
      const { toGeoError } = await import("@/lib/get-location");
      const err = toGeoError(e);
      toast.error(err.message, { id, description: err.hint });
    } finally {
      setLocBusy(false);
    }
  }

  async function save() {
    const grams = Number(String(actual).replace(",", "."));
    if (!Number.isFinite(grams) || grams <= 0) {
      toast.error("Berat aktual tidak valid");
      return;
    }
    if (locUrl.trim() && !/^https:\/\//i.test(locUrl.trim())) {
      toast.error("Link lokasi harus diawali https://");
      return;
    }
    if (locUrl.length > 2048) {
      toast.error("Link lokasi terlalu panjang (maks 2048 karakter)");
      return;
    }
    setBusy(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from as any)("ecer_preparations")
        .update({
          actual_grams: grams,
          location_url: locUrl.trim() || null,
          gps_lat: gps?.lat ?? null,
          gps_lng: gps?.lng ?? null,
          note: note.trim() || null,
        })
        .eq("id", prep.id);
      if (error) throw error;
      toast.success("Penyiapan diperbarui");
      onSaved();
    } catch (e) {
      toast.error("Gagal: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit penyiapan</DialogTitle>
          <DialogDescription>{title.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">
              Berat aktual ({displayUnit(itemName, title.unit_label)})
            </Label>
            <Input inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value)} />
            <div className="mt-1 text-[11px] text-muted-foreground">
              Selisih dengan nilai sebelumnya akan menyesuaikan stok gudang otomatis.
            </div>
          </div>
          <div>
            <Label className="text-xs">Link lokasi (GPS)</Label>
            <div className="flex gap-2">
              <Input
                value={locUrl}
                onChange={(e) => setLocUrl(e.target.value)}
                placeholder="Tempel link Google Maps atau tekan GPS"
              />
              <Button variant="outline" onClick={() => void takeLocation()} disabled={locBusy || busy}>
                {locBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />} GPS
              </Button>
            </div>
            {gps && (
              <div className="mt-1 text-[11px] text-muted-foreground">
                ✓ Koordinat: {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
              </div>
            )}
          </div>
          <div>
            <Label className="text-xs">Keterangan</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <div className="flex w-full justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Simpan
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PrepFormDialog({ item, title, onClose, onSaved }: {
  item: WarehouseItem; title: EcerTitle; onClose: () => void; onSaved: () => void;
}) {
  const [photo, setPhoto] = useState<{ dataUrl: string; blob: Blob } | null>(null);
  const [editorSrc, setEditorSrc] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [locUrl, setLocUrl] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [actual, setActual] = useState(String(title.target_grams));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [locBusy, setLocBusy] = useState(false);
  const [locProblem, setLocProblem] = useState<{
    message: string;
    hint?: string;
    code?: string;
    diagnostics?: unknown;
  } | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [addressBusy, setAddressBusy] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const addressEditedRef = useRef(false);
  // Field-pair grid ikut mode `readyEcer` — sama dengan TitleFormDialog.
  const [layout] = useLayoutMode("readyEcer", "grid");
  const pairClass = layoutFieldPairClass(layout);
  const addressReqIdRef = useRef(0);
  const [progress, setProgress] = useState<{ step: "upload" | "save" | "done" | "error"; message: string } | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);

  // Coba ekstrak lat/lng dari berbagai format URL Google Maps yang umum:
  //   - https://www.google.com/maps?q=-6.2,106.8
  //   - https://www.google.com/maps/@-6.2,106.8,17z
  //   - https://maps.google.com/?ll=-6.2,106.8
  //   - …!3d-6.2!4d106.8
  // Link pendek (maps.app.goo.gl) tidak bisa diparse di klien (CORS); biarkan
  // null dan simpan URL apa adanya.
  function parseLatLngFromUrl(raw: string): { lat: number; lng: number } | null {
    if (!raw) return null;
    const patterns = [
      /[?&](?:q|ll|destination)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i,
      /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
      /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
      /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/,
    ];
    for (const re of patterns) {
      const m = raw.match(re);
      if (m) {
        const lat = Number(m[1]);
        const lng = Number(m[2]);
        if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
          return { lat, lng };
        }
      }
    }
    return null;
  }

  function onLocUrlChange(value: string) {
    setLocUrl(value);
    setLocProblem(null);
    const parsed = parseLatLngFromUrl(value);
    if (parsed) {
      setGps(parsed);
    } else if (value.trim() === "") {
      setGps(null);
    }
  }

  async function autoFillLocationIfAllowed() {
    if (gps || locUrl) return;
    try {
      const { getCurrentLocationIfAllowed } = await import("@/lib/get-location");
      const pos = await getCurrentLocationIfAllowed();
      if (!pos) return;
      setGps({ lat: pos.lat, lng: pos.lng });
      setLocUrl(`https://www.google.com/maps?q=${pos.lat},${pos.lng}`);
    } catch {
      // Jangan ganggu alur foto; pengguna masih bisa tekan tombol GPS manual.
    }
  }

  async function loadFromBlob(blob: Blob) {
    const dataUrl = await new Promise<string>((res) => {
      const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(blob);
    });
    setEditorSrc(dataUrl); setEditorOpen(true);
    void autoFillLocationIfAllowed();
  }

  async function pasteFromClipboard() {
    try {
      if (!navigator.clipboard?.read) {
        toast.error("Browser tidak mendukung tempel dari clipboard", {
          description: "Gunakan tombol Galeri atau Kamera, atau Ctrl+V langsung di dialog.",
        });
        return;
      }
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const imgType = it.types.find((t) => t.startsWith("image/"));
        if (imgType) {
          const blob = await it.getType(imgType);
          await loadFromBlob(blob);
          toast.success("Foto ditempel dari clipboard");
          return;
        }
        const txtType = it.types.find((t) => t === "text/plain");
        if (txtType && !locUrl) {
          const txt = (await (await it.getType(txtType)).text()).trim();
          if (/^https?:\/\//i.test(txt)) {
            onLocUrlChange(txt);
            toast.success("Link lokasi ditempel");
            return;
          }
        }
      }
      toast.error("Tidak ada foto / link di clipboard");
    } catch (err) {
      toast.error("Gagal tempel: " + (err as Error).message);
    }
  }

  async function onDialogPaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) {
          e.preventDefault();
          await loadFromBlob(f);
          toast.success("Foto ditempel dari clipboard");
          return;
        }
      }
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    await loadFromBlob(f);
  }

  async function takeLocation() {
    setLocBusy(true);
    setLocProblem(null);
    const id = toast.loading("Mengambil lokasi…");
    try {
      const { getCurrentLocation } = await import("@/lib/get-location");
      const { lat, lng } = await getCurrentLocation();
      setGps({ lat, lng });
      setLocUrl(`https://www.google.com/maps?q=${lat},${lng}`);
      setLocProblem(null);
      toast.success("Lokasi terisi", { id });
    } catch (e) {
      const { getLocationDiagnostics, toGeoError } = await import("@/lib/get-location");
      const err = toGeoError(e);
      const diagnostics = await getLocationDiagnostics();
      setLocProblem({ message: err.message, hint: err.hint, code: err.code, diagnostics });
      toast.error(err.message, {
        id,
        description: err.hint,
        duration: 10000,
      });
    } finally {
      setLocBusy(false);
    }
  }

  async function copyLocationProblem() {
    if (!locProblem) return;
    const text = JSON.stringify({ at: new Date().toISOString(), ...locProblem }, null, 2);
    try {
      await navigator.clipboard?.writeText(text);
      toast.success("Detail GPS disalin");
    } catch {
      toast.message(text, { duration: 10000 });
    }
  }

  // Fallback manual: pengguna ketik lat/lng/nama sendiri saat GPS gagal atau
  // tidak tersedia (mis. di dalam gudang, izin diblokir permanen, dsb).
  function applyManualLocation() {
    setManualError(null);
    const lat = Number(String(manualLat).replace(",", "."));
    const lng = Number(String(manualLng).replace(",", "."));
    if (!Number.isFinite(lat) || Math.abs(lat) > 90) {
      setManualError("Latitude harus angka antara -90 dan 90 (contoh: -6.20088).");
      return;
    }
    if (!Number.isFinite(lng) || Math.abs(lng) > 180) {
      setManualError("Longitude harus angka antara -180 dan 180 (contoh: 106.81653).");
      return;
    }
    const name = manualName.trim().slice(0, 120);
    setGps({ lat, lng });
    if (name) {
      addressEditedRef.current = true;
      setAddress(name);
    }
    const url = name
      ? `https://www.google.com/maps?q=${lat},${lng}(${encodeURIComponent(name)})`
      : `https://www.google.com/maps?q=${lat},${lng}`;
    setLocUrl(url);
    setLocProblem(null);
    if (name) {
      setNote((prev) => {
        const tag = `📍 ${name}`;
        if (!prev) return tag;
        return prev.includes(tag) ? prev : `${tag}\n${prev}`;
      });
    }
    setManualOpen(false);
    toast.success("Lokasi manual diterapkan", {
      description: `${lat.toFixed(5)}, ${lng.toFixed(5)}${name ? ` · ${name}` : ""}`,
    });
  }

  // Reverse-geocode setiap kali koordinat berubah, kecuali pengguna sudah
  // mengedit alamat manual. Pakai Nominatim (OpenStreetMap) — tanpa API key.
  useEffect(() => {
    if (!gps) {
      setAddress("");
      setAddressError(null);
      addressEditedRef.current = false;
      return;
    }
    if (addressEditedRef.current) return;
    const reqId = ++addressReqIdRef.current;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setAddressBusy(true);
      setAddressError(null);
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${gps.lat}&lon=${gps.lng}&accept-language=id&zoom=18`;
        const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (reqId !== addressReqIdRef.current) return;
        const name = (data?.display_name as string | undefined)?.trim() || "";
        if (name && !addressEditedRef.current) setAddress(name);
        else if (!name) setAddressError("Alamat tidak ditemukan untuk koordinat ini.");
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        if (reqId === addressReqIdRef.current) {
          setAddressError("Gagal mengambil alamat (cek koneksi). Anda tetap bisa ketik manual.");
        }
      } finally {
        if (reqId === addressReqIdRef.current) setAddressBusy(false);
      }
    }, 600);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [gps]);

  async function save() {
    // Kumpulkan semua masalah agar pengguna tahu semua yang harus diperbaiki sekaligus.
    const issues: string[] = [];
    const grams = Number(String(actual).replace(",", "."));

    // Foto
    if (!photo) {
      toast.error("Foto wajib diisi", {
        description: "Ambil atau pilih foto produk dulu sebelum menyimpan.",
      });
      issues.push("photo");
    }

    // Berat aktual
    if (!String(actual).trim()) {
      toast.error("Berat aktual wajib diisi", {
        description: `Masukkan berat aktual dalam ${displayUnit(item.name, title.unit_label)}.`,
      });
      issues.push("grams");
    } else if (!Number.isFinite(grams) || grams <= 0) {
      toast.error("Berat aktual tidak valid", {
        description: "Gunakan angka lebih besar dari 0 (contoh: 1 atau 1.5).",
      });
      issues.push("grams");
    } else if (grams > Number(item.stock_base)) {
      toast.error("Stok produk tidak cukup", {
        description: `Berat ${grams} ${item.base_unit} melebihi stok tersedia ${item.stock_base} ${item.base_unit}.`,
      });
      issues.push("grams");
    }

    // GPS / lokasi
    const hasGps = gps && Number.isFinite(gps.lat) && Number.isFinite(gps.lng);
    if (!locUrl.trim() && !hasGps) {
      toast.error("Lokasi GPS wajib diisi", {
        description: "Tekan tombol GPS untuk mengambil lokasi otomatis, atau tempel link Google Maps.",
      });
      issues.push("gps");
    } else if (locUrl.trim()) {
      if (locUrl.length > 2048) {
        toast.error("Link lokasi terlalu panjang", {
          description: "Maksimal 2048 karakter. Persingkat URL atau ambil ulang dengan tombol GPS.",
        });
        issues.push("gps");
      } else if (!/^https:\/\//i.test(locUrl)) {
        toast.error("Format link lokasi salah", {
          description: "Link harus diawali https:// (contoh: https://maps.google.com/…).",
        });
        issues.push("gps");
      }
    }

    // Catatan: jika hanya link (mis. maps.app.goo.gl) tanpa koordinat, tetap
    // boleh disimpan — koordinat akan null. Tampilkan info agar pengguna tahu.
    if (!hasGps && locUrl.trim()) {
      toast.message("Disimpan tanpa koordinat", {
        description: "Link lokasi disimpan apa adanya. Tekan tombol GPS jika ingin koordinat presisi.",
      });
    }

    if (issues.length) return;
    setBusy(true);
    setProgress({ step: "upload", message: photo ? "Mengunggah foto…" : "Menyiapkan data…" });
    try {
      const { data: u } = await supabase.auth.getUser();
      const userId = u.user?.id;
      if (!userId) throw new Error("Sesi tidak valid");
      let photoPath: string | null = null;
      if (photo) {
        photoPath = await uploadEcerPhoto(userId, title.id, photo.blob, "jpg");
        if (!photoPath) throw new Error("Upload foto gagal");
      }
      setProgress({ step: "save", message: "Menyimpan penyiapan…" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from as any)("ecer_preparations").insert({
        user_id: userId,
        title_id: title.id,
        warehouse_item_id: title.warehouse_item_id,
        actual_grams: grams,
        photo_path: photoPath,
        location_url: locUrl || null,
        gps_lat: gps?.lat ?? null,
        gps_lng: gps?.lng ?? null,
        note: note.trim() || null,
        created_by: "admin",
      });
      if (error) { if (photoPath) await deleteEcerPhoto(photoPath); throw error; }
      setProgress({ step: "done", message: "Selesai" });
      toast.success(`Tersimpan. Stok dikurangi ${grams} ${displayUnit(item.name, title.unit_label)}`);
      onSaved();
    } catch (e) {
      setProgress({ step: "error", message: (e as Error).message });
      toast.error("Gagal: " + (e as Error).message);
    } finally {
      setBusy(false);
      // Sembunyikan progress sukses setelah singkat agar pengguna sempat membacanya.
      setTimeout(() => setProgress((p) => (p?.step === "done" ? null : p)), 1200);
    }
  }

  return (
    <>
    <Dialog open onOpenChange={(o) => { if (!o && !editorOpen) onClose(); }}>
      <DialogContent
        className="max-w-md"
        onPaste={onDialogPaste}
        onInteractOutside={(event) => {
          if (editorOpen) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Penyiapan baru</DialogTitle>
          <DialogDescription>{title.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {photo ? (
            <div>
              <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
                <span className="inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-emerald-500/10 px-2 font-medium leading-none text-emerald-700 dark:text-emerald-400">
                  ✓ Pratinjau foto
                </span>
                <span className="min-w-0 truncate text-right leading-none text-muted-foreground tabular-nums">
                  {Math.round(photo.blob.size / 1024)} KB · ketuk untuk perbesar
                </span>
              </div>
              <button
                type="button"
                onClick={() => setZoomOpen(true)}
                className="block w-full overflow-hidden rounded-lg border bg-muted"
                aria-label="Perbesar pratinjau foto"
              >
                <img src={photo.dataUrl} alt="Pratinjau foto penyiapan" className="max-h-72 w-full object-contain" />
              </button>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => { setEditorSrc(photo.dataUrl); setEditorOpen(true); }}>
                  <Edit3 className="h-3 w-3" /> Edit lagi
                </Button>
                <Button size="sm" variant="outline" type="button" onClick={() => galleryRef.current?.click()}>
                  <ImageIcon className="h-3 w-3" /> Ganti dari galeri
                </Button>
                <Button size="sm" variant="outline" type="button" onClick={() => cameraRef.current?.click()}>
                  <Camera className="h-3 w-3" /> Foto ulang
                </Button>
                <Button size="sm" variant="outline" type="button" onClick={() => void pasteFromClipboard()}>
                  📋 Tempel
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPhoto(null)}>Hapus foto</Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <Button type="button" variant="outline" onClick={() => cameraRef.current?.click()}><Camera className="h-4 w-4" /> Kamera</Button>
              <Button type="button" variant="outline" onClick={() => galleryRef.current?.click()}><ImageIcon className="h-4 w-4" /> Galeri</Button>
              <Button type="button" variant="outline" onClick={() => void pasteFromClipboard()}>📋 Tempel</Button>
            </div>
          )}
          {/* Use sr-only positioning instead of display:none — some mobile browsers
              (notably iOS Safari & in-app webviews) ignore programmatic .click() on
              hidden inputs, leaving the Kamera/Galeri buttons unresponsive. */}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment"
            className="sr-only absolute -z-10 h-0 w-0 opacity-0" onChange={onFile} />
          <input ref={galleryRef} type="file" accept="image/*"
            className="sr-only absolute -z-10 h-0 w-0 opacity-0" onChange={onFile} />

          <div>
            <Label className="text-xs">Berat aktual ({displayUnit(item.name, title.unit_label)}) <span className="text-destructive">*</span></Label>
            <Input inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value)} />
            <div className="mt-1 text-[11px] leading-snug text-muted-foreground">Stok produk akan berkurang sebanyak angka ini.</div>
          </div>

          <div>
            <Label className="text-xs">Link lokasi (GPS) <span className="text-destructive">*</span></Label>
            <div className="flex gap-2">
              <Input
                value={locUrl}
                onChange={(e) => onLocUrlChange(e.target.value)}
                onPaste={(e) => {
                  const txt = e.clipboardData?.getData("text");
                  if (txt) {
                    e.preventDefault();
                    onLocUrlChange(txt.trim());
                  }
                }}
                placeholder="Tempel link Google Maps atau tekan GPS"
              />
              <Button variant="outline" onClick={() => void takeLocation()} disabled={locBusy || busy}>
                {locBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />} GPS
              </Button>
            </div>
            <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
              {gps
                ? `✓ Koordinat: ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`
                : locUrl
                ? "Link tersimpan tanpa koordinat presisi (boleh disimpan)."
                : "Tempel link Maps — koordinat akan otomatis terbaca jika tersedia."}
            </div>
            {gps && (() => {
              const d = 0.003;
              const bbox = `${gps.lng - d},${gps.lat - d},${gps.lng + d},${gps.lat + d}`;
              const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${gps.lat},${gps.lng}`;
              const link = `https://www.openstreetmap.org/?mlat=${gps.lat}&mlon=${gps.lng}#map=17/${gps.lat}/${gps.lng}`;
              return (
                <div className="mt-2 overflow-hidden rounded-md border">
                  <iframe
                    title="Pratinjau peta lokasi"
                    src={src}
                    className="block h-40 w-full"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                  <div className="flex items-center justify-between gap-2 border-t bg-muted/40 px-2 py-1 text-[11px] leading-snug text-muted-foreground">
                    <span>Penanda: {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}</span>
                    <a href={link} target="_blank" rel="noreferrer" className="font-medium text-primary underline-offset-2 hover:underline">
                      Buka peta besar
                    </a>
                  </div>
                </div>
              );
            })()}
            {gps && (
              <div className="mt-2 rounded-md border bg-muted/30 p-2.5">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <Label className="text-[11px]">Alamat (bisa diedit)</Label>
                  {addressBusy && (
                    <span className="flex items-center gap-1 text-[11px] leading-snug text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Mencari alamat…
                    </span>
                  )}
                </div>
                <Textarea
                  rows={2}
                  value={address}
                  onChange={(e) => {
                    addressEditedRef.current = true;
                    setAddress(e.target.value);
                  }}
                  placeholder={addressBusy ? "Mencari alamat dari koordinat…" : "Ketik atau perbaiki alamat di sini"}
                />
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!address.trim()}
                    onClick={() => {
                      const tag = `📍 ${address.trim()}`;
                      setNote((prev) => (!prev ? tag : prev.includes(tag) ? prev : `${tag}\n${prev}`));
                      toast.success("Alamat ditambahkan ke catatan");
                    }}
                  >
                    Tambah ke catatan
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!address.trim()}
                    onClick={async () => {
                      const res = await copyText(address.trim());
                      if (res.ok) toast.success("Alamat disalin ke clipboard");
                      else toast.error("Gagal menyalin alamat");
                    }}
                  >
                    Salin
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={addressBusy}
                    onClick={() => {
                      addressEditedRef.current = false;
                      // trigger refetch by bumping reqId via state nudge
                      setAddress("");
                      setGps((g) => (g ? { ...g } : g));
                    }}
                  >
                    <RotateCw className="mr-1 h-3 w-3" /> Ambil ulang
                  </Button>
                  {addressError && (
                    <span className="text-[11px] leading-snug text-destructive">{addressError}</span>
                  )}
                </div>
              </div>
            )}
            {locProblem && (
              <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-[11px] leading-snug text-destructive">
                <div className="font-semibold">GPS gagal: {locProblem.message}</div>
                {locProblem.hint && <div className="mt-1 text-destructive/90">{locProblem.hint}</div>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => void takeLocation()} disabled={locBusy}>
                    {locBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />} Coba lagi
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => void copyLocationProblem()}>
                    Salin detail GPS
                  </Button>
                </div>
                <details className="mt-2 text-[11px] leading-snug text-muted-foreground">
                  <summary className="cursor-pointer">Detail teknis</summary>
                  <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-background/70 p-2">
                    {JSON.stringify(locProblem, null, 2)}
                  </pre>
                </details>
              </div>
            )}

            <div className="mt-2">
              <button
                type="button"
                onClick={() => setManualOpen((v) => !v)}
                className="text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                aria-expanded={manualOpen}
              >
                {manualOpen ? "Tutup input manual" : "Isi lokasi manual (lat/lng/nama)"}
              </button>
              {manualOpen && (
                <div className="mt-2 space-y-2 rounded-md border bg-muted/40 p-2.5">
                  <div className="text-[11px] text-muted-foreground">
                    Gunakan ini jika GPS gagal. Anda bisa salin koordinat dari Google Maps:
                    tahan titik di peta → muncul lat,lng di kotak pencarian.
                  </div>
                  <div>
                    <Label className="text-[11px]">Nama lokasi (opsional)</Label>
                    <Input
                      value={manualName}
                      onChange={(e) => setManualName(e.target.value)}
                      placeholder="mis. Gudang Utama, Toko Pasar Baru"
                      maxLength={120}
                    />
                  </div>
                  <div className={pairClass}>
                    <div>
                      <Label className="text-[11px]">Latitude *</Label>
                      <Input
                        inputMode="decimal"
                        value={manualLat}
                        onChange={(e) => setManualLat(e.target.value)}
                        placeholder="-6.20088"
                      />
                    </div>
                    <div>
                      <Label className="text-[11px]">Longitude *</Label>
                      <Input
                        inputMode="decimal"
                        value={manualLng}
                        onChange={(e) => setManualLng(e.target.value)}
                        placeholder="106.81653"
                      />
                    </div>
                  </div>
                  {manualError && (
                    <div className="text-[11px] font-medium text-destructive">{manualError}</div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={applyManualLocation}>
                      Terapkan
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setManualName("");
                        setManualLat("");
                        setManualLng("");
                        setManualError(null);
                      }}
                    >
                      Bersihkan
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div>
            <Label className="text-xs">Keterangan</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan tentang produk / penyiapan…" rows={2} />
          </div>
        </div>
        <DialogFooter>
          <div className="flex w-full flex-col gap-2">
            {progress && (
              <div
                role="status"
                aria-live="polite"
                className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-[11px] ${
                  progress.step === "error"
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : progress.step === "done"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "border-border bg-muted text-foreground"
                }`}
              >
                {progress.step === "upload" || progress.step === "save" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : progress.step === "done" ? (
                  <span aria-hidden>✓</span>
                ) : (
                  <span aria-hidden>⚠</span>
                )}
                <span className="flex-1 truncate">{progress.message}</span>
                <span className="text-muted-foreground">
                  {progress.step === "upload" ? "1/2" : progress.step === "save" ? "2/2" : ""}
                </span>
              </div>
            )}
            {busy && (
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button>
              <Button onClick={save} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {busy ? (progress?.step === "save" ? " Menyimpan…" : " Mengunggah…") : " Simpan"}
              </Button>
            </div>
          </div>
        </DialogFooter>

        {zoomOpen && photo && (
          <Dialog open onOpenChange={(o) => { if (!o) setZoomOpen(false); }}>
            <DialogContent className="max-w-3xl p-2">
              <DialogHeader className="px-2 pt-1">
                <DialogTitle className="text-sm">Pratinjau foto</DialogTitle>
                <DialogDescription className="text-[11px]">Periksa hasil foto sebelum menyimpan.</DialogDescription>
              </DialogHeader>
              <img src={photo.dataUrl} alt="Pratinjau foto besar" className="max-h-[75vh] w-full rounded-md object-contain" />
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
    {/* PhotoEditor di-hoist ke luar DialogContent agar `fixed inset-0`-nya
        mengacu ke viewport (bukan ke DialogContent yang memakai transform +
        focus trap Radix), sehingga toolbar & kanvas selalu bisa disentuh
        di Android. */}
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

// keep ECER_BUCKET reachable so unused import is not flagged
void ECER_BUCKET;

// ---- Dialog: buat produk gudang baru langsung dari halaman ecer ----
function NewProductDialog({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (item: WarehouseItem) => void | Promise<void>;
}) {
  type PkgType = "gram" | "botol" | "sachet" | "pcs";
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [packageType, setPackageType] = useState<PkgType>("gram");
  const [packageSize, setPackageSize] = useState("1000");
  const [busy, setBusy] = useState(false);

  // SSOT: botol dihitung per-botol (base='pcs', size=1) — sama seperti
  // konvensi GS di seluruh app. gram/sachet tetap base='g'.
  const baseUnit: "g" | "pcs" =
    packageType === "pcs" || packageType === "botol" ? "pcs" : "g";
  // Label satuan untuk field "Isi/kemasan": ikut Jenis kemasan supaya
  // sinkron (mis. botol → "botol", gram → "g", sachet → "g").
  const sizeUnitLabel = packageType === "botol" ? "botol" : baseUnit;
  // Field Isi/kemasan hanya relevan saat isi kemasan bisa berbeda-beda
  // (curah gram / sachet). Untuk botol & pcs, 1 kemasan = 1 unit.
  const showSizeField = packageType === "gram" || packageType === "sachet";
  const [layout] = useLayoutMode("readyEcer", "grid");
  const pairClass = layoutFieldPairClass(layout);

  async function save() {
    if (!name.trim()) { toast.error("Nama produk wajib diisi"); return; }
    const size = showSizeField
      ? Number(String(packageSize).replace(",", "."))
      : 1;
    if (showSizeField && (!Number.isFinite(size) || size <= 0)) {
      toast.error("Isi/kemasan harus > 0"); return;
    }
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const userId = u.user?.id;
    if (!userId) { toast.error("Sesi tidak valid"); setBusy(false); return; }
    const { data, error } = await supabase.from("warehouse_items").insert({
      user_id: userId,
      name: name.trim(),
      category: category.trim() || null,
      package_type: packageType,
      package_size: size,
      base_unit: baseUnit,
    }).select("id,name,category,base_unit,stock_base,image_path,package_type,package_size").single();
    setBusy(false);
    if (error || !data) { toast.error("Gagal: " + (error?.message ?? "tidak ada data")); return; }
    toast.success("Produk gudang dibuat");
    await onCreated(data as WarehouseItem);
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Produk gudang baru</DialogTitle>
          <DialogDescription>Setelah dibuat, akan langsung dibuatkan judul ecer untuk produk ini.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Nama produk</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. KRISTAL" autoCapitalize="characters" />
          </div>
          <div>
            <Label className="text-xs">Kategori (opsional)</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="mis. Bahan baku" />
          </div>
          <div className={pairClass}>
            <div>
              <Label className="text-xs">Jenis kemasan</Label>
              <select
                value={packageType}
                onChange={(e) => setPackageType(e.target.value as PkgType)}
                className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="gram">gram (curah)</option>
                <option value="botol">botol</option>
                <option value="sachet">sachet</option>
                <option value="pcs">pcs</option>
              </select>
            </div>
            {showSizeField && (
              <div>
                <Label className="text-xs">Isi/kemasan ({sizeUnitLabel})</Label>
                <Input inputMode="decimal" value={packageSize} onChange={(e) => setPackageSize(e.target.value)} />
              </div>
            )}
          </div>
          <div className="rounded-md border border-dashed bg-muted/30 p-2 text-[11px] text-muted-foreground">
            Stok awal = 0. Tambah stok dari halaman Gudang (catat pembelian) setelah produk dibuat.
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button onClick={save} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Simpan & buat judul
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Send ecer preps batch to customer ----
function SendEcerPrepsDialog({
  open, onClose, preps, title, itemName, customers, onSent,
}: {
  open: boolean;
  onClose: () => void;
  preps: EcerPreparation[];
  title: EcerTitle;
  itemName?: string;
  customers: Array<{ id: string; name: string; contact: string | null }>;
  onSent: () => void;
}) {
  const [mode, setMode] = useState<"link" | "manual">(customers.length > 0 ? "link" : "manual");
  const [customerId, setCustomerId] = useState<string>(customers[0]?.id ?? "");
  const [manualName, setManualName] = useState("");
  const [totalStr, setTotalStr] = useState("");
  const [payMethod, setPayMethod] = useState<"kas" | "hutang" | "partial">("kas");
  const [paidStr, setPaidStr] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const prepIdsKey = useMemo(() => preps.map((p) => p.id).sort().join("|"), [preps]);

  useEffect(() => {
    if (!open) return;
    setMode(customers.length > 0 ? "link" : "manual");
    setCustomerId(customers[0]?.id ?? "");
    setManualName("");
    setTotalStr("");
    setPayMethod("kas");
    setPaidStr("");
    setNote("");
  }, [open, customers, title.id, prepIdsKey]);

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

  const party = useMemo(() => {
    if (mode === "link") {
      const c = customers.find((x) => x.id === customerId);
      return { id: c?.id ?? null, name: c?.name ?? "", contact: c?.contact ?? null };
    }
    return { id: null as string | null, name: manualName.trim(), contact: null as string | null };
  }, [mode, customerId, manualName, customers]);

  const canSend = !!party.name && totalAmount > 0 && preps.length > 0 && !busy && partialValid;

  async function resolvePhotoUrl(prep: EcerPreparation) {
    if (!prep.photo_path) return null;
    const primary = prep.created_by === "worker" ? prepSignedUrl : ecerSignedUrl;
    const secondary = prep.created_by === "worker" ? ecerSignedUrl : prepSignedUrl;
    const a = await primary(prep.photo_path, 600);
    if (a) return a;
    return await secondary(prep.photo_path, 600);
  }

  function buildCaption(): string {
    const lines: string[] = [];
    lines.push(`*${title.name}*`);
    lines.push("");
    lines.push(`Isi paket (${preps.length} kotak):`);
    preps.forEach((p, i) => {
      lines.push(`• #${i + 1} — ${p.actual_grams} ${displayUnit(itemName, title.unit_label)}`);
    });
    lines.push("");
    lines.push(`Total: *${formatPaymentRupiah(totalAmount)}*`);
    lines.push(...buildPaymentMessageLines(payment));
    if (party.name) lines.push(`Untuk: ${party.name}`);
    if (note.trim()) { lines.push(""); lines.push(`Catatan: ${note.trim()}`); }
    lines.push("");
    lines.push("Terima kasih 🙏");
    return lines.join("\n");
  }

  async function handleSend() {
    if (!canSend) return;
    if (!party.name) { toast.error("Pilih atau isi nama pelanggan"); return; }
    if (payMethod === "partial" && !partialValid) { toast.error("Jumlah dibayar harus > 0 dan < total"); return; }

    const methodLabel =
      payment.method === "hutang" ? `Hutang — sisa ${formatPaymentRupiah(payment.remaining)} piutang`
      : payment.method === "partial" ? `Bayar sebagian — dibayar ${formatPaymentRupiah(payment.paid)}, sisa ${formatPaymentRupiah(payment.remaining)} piutang`
      : "Lunas";
    const summary = [
      `Pelanggan: ${party.name}${party.contact ? ` (${party.contact})` : ""}`,
      `Kotak: ${preps.length} × dari ${title.name}`,
      `Total: ${rupiah(totalAmount)}`,
      `Metode: ${methodLabel}`,
      note.trim() ? `Catatan: ${note.trim()}` : null,
      "",
      "Setelah dikirim, stok, penjualan, dan piutang otomatis tercatat. Foto & caption akan dibagikan ke WhatsApp.",
    ].filter(Boolean).join("\n");
    const ok = await confirm({
      title: "Konfirmasi pembayaran",
      description: summary,
      confirmText: "Kirim WA",
      cancelText: "Periksa lagi",
    });
    if (!ok) return;

    setBusy(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rpcErr } = await (supabase as any).rpc("send_ecer_preps_to_customer", {
        _prep_ids: preps.map((p) => p.id),
        _customer_id: party.id,
        _party_name: party.name,
        _total_amount: payment.total,
        _paid_amount: payment.method === "partial" ? payment.paid : null,
        _payment_method: payment.method,
        _note: note.trim() || null,
      });
      if (rpcErr) throw rpcErr;

      // Broadcast agar semua panel (ReadyEcerSection di /index, badge produk,
      // panel Piutang) refetch — realtime tidak dipasang di semua permukaan,
      // jadi event ini adalah sabuk pengaman supaya UI konsisten setelah kirim
      // batch (baik Lunas, Hutang, maupun Bayar sebagian).
      emitDebtTx({
        kind: "piutang",
        wasCash: payment.method === "kas",
        amount: payment.remaining,
        partyId: party.id ?? null,
        at: Date.now(),
      });

      toast.success(
        payment.method === "hutang"
          ? "Terkirim — penjualan & piutang tercatat"
          : payment.method === "partial"
            ? `Terkirim — dibayar ${rupiah(payment.paid)}, sisa ${rupiah(payment.remaining)} jadi piutang`
            : "Terkirim — penjualan tercatat",
      );
      // Segarkan UI (badge + pindah ke Riwayat Terkirim) segera setelah RPC sukses,
      // tanpa menunggu proses share WA yang bisa lama pada Web Share API.
      onSent();

      // Kirim WA di latar; hasil dilaporkan lewat toast dari notifyShareResult.
      void (async () => {
        try {
          const files: File[] = [];
          for (const p of preps) {
            const signed = await resolvePhotoUrl(p);
            if (!signed) continue;
            const f = await urlToFile(signed, `${(title.name || "ecer").replace(/\W+/g, "-")}-${p.id.slice(0, 6)}.jpg`);
            if (f) files.push(f);
          }
          const res = await shareToWhatsApp({ text: buildCaption(), title: title.name, files });
          notifyShareResult(res);
        } catch (e) {
          toast.error("Gagal kirim WA: " + ((e as { message?: string })?.message ?? String(e)));
        }
      })();
    } catch (e) {
      toast.error("Gagal kirim: " + ((e as { message?: string })?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  }

  const totalQty = preps.reduce((s, p) => s + Number(p.actual_grams || 0), 0);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Send className="h-4 w-4 text-primary" /> Kirim ke pembeli
          </DialogTitle>
          <DialogDescription>
            {preps.length} kotak dari <b>{title.name}</b> · total {totalQty} {displayUnit(itemName, title.unit_label)}. Stok & piutang otomatis diperbarui.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-xs">
          <div className="rounded-md border bg-muted/30 p-2">
            <div className="mb-1 font-semibold">{preps.length} kotak dipilih</div>
            <div className="flex flex-wrap gap-1">
              {preps.map((p, i) => (
                <span key={p.id} className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  #{i + 1} · {p.actual_grams}{displayUnit(itemName, title.unit_label)}
                </span>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium">Pelanggan</label>
            <div className="mb-1 flex gap-1 text-[10px]">
              <button
                type="button"
                onClick={() => setMode("link")}
                className={`flex-1 rounded-md border px-2 py-1 ${mode === "link" ? "border-primary bg-primary/10 text-primary font-semibold" : "hover:bg-accent"}`}
              >Dari kontak</button>
              <button
                type="button"
                onClick={() => setMode("manual")}
                className={`flex-1 rounded-md border px-2 py-1 ${mode === "manual" ? "border-primary bg-primary/10 text-primary font-semibold" : "hover:bg-accent"}`}
              >Manual</button>
            </div>
            {mode === "link" ? (
              customers.length === 0 ? (
                <div className="rounded-md border border-dashed p-2 text-[11px] text-muted-foreground">
                  Belum ada pelanggan. Gunakan mode Manual atau tambahkan pelanggan dulu.
                </div>
              ) : (
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="h-9 w-full rounded-md border bg-card px-2 text-xs"
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
                className="h-9 text-xs"
              />
            )}
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium">Total harga (Rp)</label>
            <Input
              value={totalStr}
              onChange={(e) => setTotalStr(e.target.value)}
              placeholder="Contoh: 25000"
              inputMode="numeric"
              className="h-9 tabular-nums text-xs"
            />
            {totalAmount > 0 && <div className="mt-1 text-[10px] text-muted-foreground">= {rupiah(totalAmount)}</div>}
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium">Metode bayar</label>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setPayMethod("kas")}
                className={`flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs ${payMethod === "kas" ? "border-primary bg-primary/10 text-primary font-semibold" : "hover:bg-accent"}`}
              >
                <Wallet className="h-3.5 w-3.5" /> Lunas
              </button>
              <button
                type="button"
                onClick={() => setPayMethod("hutang")}
                className={`flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs ${payMethod === "hutang" ? "border-primary bg-primary/10 text-primary font-semibold" : "hover:bg-accent"}`}
              >
                <HandCoins className="h-3.5 w-3.5" /> Hutang
              </button>
              <button
                type="button"
                onClick={() => setPayMethod("partial")}
                className={`flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs ${payMethod === "partial" ? "border-primary bg-primary/10 text-primary font-semibold" : "hover:bg-accent"}`}
              >
                <HandCoins className="h-3.5 w-3.5" /> Sebagian
              </button>
            </div>
            {payMethod === "partial" && (
              <div className="mt-2 space-y-1">
                <label className="text-[11px] text-muted-foreground">Dibayar sekarang (Rp)</label>
                <Input
                  value={paidStr}
                  onChange={(e) => setPaidStr(e.target.value)}
                  placeholder="Contoh: 10000"
                  inputMode="numeric"
                  className="h-9 tabular-nums text-xs"
                />
                <div className="text-[10px] text-muted-foreground">
                  {paidAmount > 0 && totalAmount > 0
                    ? paidAmount >= totalAmount
                      ? <span className="text-destructive">Dibayar tidak boleh ≥ total. Pilih Lunas.</span>
                      : <>Sisa {rupiah(remaining)} akan dicatat sebagai piutang atas <b>{party.name || "-"}</b>.</>
                    : "Isi jumlah yang dibayar sekarang; sisanya masuk piutang."}
                </div>
              </div>
            )}
            {payMethod === "hutang" && (
              <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-1.5 text-[10px] text-amber-800 dark:text-amber-200">
                Seluruh total dicatat sebagai piutang atas <b>{party.name || "-"}</b>.
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium">Catatan (opsional)</label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="text-xs"
              placeholder="Mis. antar sore, titip di warung, dsb."
            />
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Batal</Button>
            <Button size="sm" onClick={handleSend} disabled={!canSend}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}
              {payMethod === "hutang"
                ? "Kirim & catat piutang"
                : payMethod === "partial"
                  ? "Kirim & catat sebagian piutang"
                  : "Kirim & catat penjualan"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}