import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PhotoEditor } from "@/components/PhotoEditor";
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
  Share2, ExternalLink, Loader2, ChevronLeft, Package, AlertTriangle, RotateCw, Users, MessageCircle, RefreshCw,
  Calendar, Clock, Hash, CheckCircle2, Boxes,
} from "lucide-react";
import {
  ECER_BUCKET, ecerSignedUrl, uploadEcerPhoto, deleteEcerPhoto,
  type EcerTitle, type EcerPreparation,
} from "@/lib/ecer";
import { shareToWhatsApp, buildWhatsAppUrl, notifyShareResult, copyText, urlToFile } from "@/lib/share-wa";
import { signedUrl as prepSignedUrl } from "@/lib/prep";
import { fmtItemQty } from "@/lib/stock-format";
import { displayUnit } from "@/lib/unit-label";

export const Route = createFileRoute("/_authenticated/ecer")({
  head: () => ({ meta: [{ title: "Penyiapan Ecer · MCM Storage" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    item: typeof s.item === "string" ? s.item : undefined,
    title: typeof s.title === "string" ? s.title : undefined,
    highlight: typeof s.highlight === "string" ? s.highlight : undefined,
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
            <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
              <b>Kemungkinan penyebab:</b> {loadError.diagnosis}
            </div>
          )}

          <div className="space-y-1.5 rounded-md border bg-background/60 p-2.5 text-[11px] leading-relaxed">
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
      <p className="text-xs leading-relaxed text-muted-foreground">
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
      <div className="font-medium leading-tight">{title.name}</div>
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
          <div className="grid grid-cols-2 gap-2">
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
  const unit = displayUnit(item.name, title.unit_label);
  const totalActual = preps.reduce((s, p) => s + (Number(p.actual_grams) || 0), 0);
  const targetTotal = (Number(title.target_grams) || 0) * preps.length;
  const progress = targetTotal > 0 ? Math.min(100, Math.round((totalActual / targetTotal) * 100)) : 0;
  const last = preps[0];
  const lastDate = last ? new Date(last.created_at) : null;
  const fmtDate = (d: Date) => d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  const fmtTime = (d: Date) => d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) + " WIB";
  const ref = title.id.replace(/-/g, "").slice(0, 16).toUpperCase();

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      {/* Brand strip */}
      <div className="relative bg-gradient-to-br from-primary/95 via-primary to-primary/80 px-4 pb-4 pt-4 text-primary-foreground sm:px-5 sm:pb-6 sm:pt-5">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400 via-primary-foreground/40 to-emerald-400" />
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-foreground/80">
              <Scale className="h-3 w-3 shrink-0" />
              <span className="truncate">Detail penyiapan ecer</span>
            </div>
            <h2 className="mt-2 break-words text-base font-bold leading-tight sm:text-xl">{title.name}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1.5 text-[11px] leading-none text-primary-foreground/85">
              <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-white/15 px-2 py-1 backdrop-blur-sm">
                <Package className="h-3 w-3 shrink-0" />
                <span className="truncate">{item.name}</span>
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-1 backdrop-blur-sm">
                Target <b className="ml-0.5">{title.target_grams} {unit}</b>
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/25 px-2 py-1 font-semibold text-emerald-50 ring-1 ring-emerald-300/50 backdrop-blur-sm">
                <CheckCircle2 className="h-3 w-3 shrink-0" /> Aktif
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 font-mono text-[11px] text-primary-foreground/90 backdrop-blur-sm sm:hidden">
                <Hash className="h-3 w-3 shrink-0" /> {ref}
              </span>
            </div>
          </div>
          <div className="hidden shrink-0 text-right sm:block">
            <div className="text-[11px] uppercase tracking-wider text-primary-foreground/70">No. Referensi</div>
            <div className="font-mono text-[11px] text-primary-foreground/95">{ref}</div>
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
        <DetailRow icon={<Boxes className="h-3.5 w-3.5" />} label="Jumlah penyiapan"
          value={<span className="font-semibold">{preps.length} kotak</span>}
          sub={preps.length > 0 ? `${progress}% dari target` : "Belum ada kotak"}
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
        <div className="grid grid-cols-4 gap-1 sm:flex sm:flex-wrap sm:items-center sm:justify-end sm:gap-1.5">
          {onCreateTitle && (
            <button
              type="button"
              onClick={onCreateTitle}
              title="Judul ecer baru untuk produk yang sama"
              className="group flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-2xl p-2 text-muted-foreground transition-all active:scale-95 hover:bg-muted/60 sm:hidden"
            >
              <Plus className="h-5 w-5" aria-hidden />
              <span className="text-[11px] font-semibold leading-none tracking-tight">Judul</span>
            </button>
          )}
          {onCreateProduct && (
            <button
              type="button"
              onClick={onCreateProduct}
              title="Buat produk gudang baru lalu langsung dibuatkan judulnya"
              className="group flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-2xl p-2 text-muted-foreground transition-all active:scale-95 hover:bg-muted/60 sm:hidden"
            >
              <Package className="h-5 w-5" aria-hidden />
              <span className="text-[11px] font-semibold leading-none tracking-tight">Produk</span>
            </button>
          )}
          <button
            type="button"
            onClick={onScrollToWorker}
            title="Lihat kiriman pegawai untuk judul ini"
            className="group flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-2xl p-2 text-muted-foreground transition-all active:scale-95 hover:bg-muted/60 sm:hidden"
          >
            <Users className="h-5 w-5" aria-hidden />
            <span className="text-[11px] font-semibold leading-none tracking-tight">Pegawai</span>
          </button>
          <button
            type="button"
            onClick={onAdd}
            title="Tambah penyiapan untuk judul ini"
            className="group flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-2xl bg-emerald-50 p-2 text-emerald-700 transition-all active:scale-95 dark:bg-emerald-500/15 dark:text-emerald-300 sm:hidden"
          >
            <Plus className="h-5 w-5" aria-hidden />
            <span className="text-[11px] font-semibold leading-none tracking-tight">Penyiapan</span>
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
          <Button size="sm" onClick={onAdd} className="hidden bg-emerald-600 hover:bg-emerald-700 sm:inline-flex">
            <Plus className="h-4 w-4" /> Penyiapan
          </Button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string }) {
  return (
      <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-start gap-3 py-2.5 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
      <EcerLabel className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-muted-foreground/70">{icon}</span>
        <span className="truncate">{label}</span>
      </EcerLabel>
      <div className="min-w-0 text-right text-sm font-semibold leading-snug text-foreground">
        <div className="break-words">{value}</div>
        {sub && <EcerMeta as="div" className="mt-0.5 break-words font-normal">{sub}</EcerMeta>}
      </div>
    </div>
  );
}

// ---- Detail view: preparations grid ----
function TitleDetailView({ item, title, onBack, onTitleUpdated, onCreateTitle, onCreateProduct }: {
  item: WarehouseItem; title: EcerTitle; onBack: () => void; onTitleUpdated: () => void;
  onCreateTitle?: () => void; onCreateProduct?: () => void;
}) {
  void onBack;
  const [preps, setPreps] = useState<EcerPreparation[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [loadError, setLoadError] = useState<{ message: string; code?: string; hint?: string } | null>(null);

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

  // realtime
  useEffect(() => {
    const ch = supabase.channel(`ecer_prep_${title.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ecer_preparations", filter: `title_id=eq.${title.id}` },
        () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [title.id]);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-3 sm:p-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft className="h-4 w-4" /> Kembali</Button>
      </div>
      <DetailHero
        item={item}
        title={title}
        preps={preps}
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
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <Boxes className="h-4 w-4 text-primary" /> Daftar penyiapan
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {preps.length}
            </span>
          </CardTitle>
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
                  <div className="space-y-1 rounded-md border bg-background/60 p-2 text-[11px] leading-relaxed">
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
          ) : preps.length === 0 ? (
            <div className="rounded-md border border-dashed bg-muted/20 px-4 py-8 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Boxes className="h-6 w-6 text-primary" />
              </div>
              <div className="text-sm font-semibold">Belum ada penyiapan</div>
              <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {preps.map((p, idx) => (
                <PrepBox key={p.id} prep={p} index={preps.length - idx} title={title} itemName={item.name} onChanged={load} onTitleUpdated={onTitleUpdated} />
              ))}
            </div>
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

function WorkerSubmissionsCard({ title, itemName }: { title: EcerTitle; itemName: string }) {
  const [shots, setShots] = useState<WorkerShot[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetUnit = normUnitStr(title.unit_label);
  const targetGrams = Number(title.target_grams) || 0;
  const displayUnitStr = itemName.trim().toLowerCase() === "gs" ? "botol" : (title.unit_label ?? "");

  async function load() {
    setError(null);
    if (!title.warehouse_item_id) {
      setShots([]);
      setLoading(false);
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: tItems, error: e1 } = await (supabase.from as any)("prep_task_items")
        .select("id,qty_requested,unit_label")
        .eq("warehouse_item_id", title.warehouse_item_id);
      if (e1) throw new Error(e1.message);
      const items = (tItems ?? []) as Array<{ id: string; qty_requested: number | null; unit_label: string | null }>;
      if (items.length === 0) { setShots([]); return; }

      const matchKindByItem = new Map<string, "strict" | "fallback_grams" | "fallback_wid">();
      for (const it of items) {
        const g = Number(it.qty_requested) || 0;
        const u = normUnitStr(it.unit_label);
        let kind: "strict" | "fallback_grams" | "fallback_wid" = "fallback_wid";
        if (g === targetGrams && u === targetUnit) kind = "strict";
        else if (g === targetGrams) kind = "fallback_grams";
        matchKindByItem.set(it.id, kind);
      }
      const ids = Array.from(matchKindByItem.keys());
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
          match: matchKindByItem.get(s.task_item_id) ?? "fallback_wid",
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

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function sendWA() {
    if (sending || shots.length === 0) return;
    setSending(true);
    try {
      const take = shots.slice(0, 6);
      const files: File[] = [];
      for (const s of take) {
        const paths = Array.from(new Set([
          ...((s.photo_paths ?? []) as string[]),
          ...(s.photo_path ? [s.photo_path] : []),
        ])).filter(Boolean);
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
      const lines = take.map((s) => `• ${title.name} — ${new Date(s.submitted_at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`);
      const firstLoc = take.find((s) => s.location_url);
      const text = [
        `*${title.name}* (${itemName} · ${title.target_grams} ${displayUnitStr})`,
        `${shots.length} kiriman pegawai${shots.length > take.length ? ` (mengirim ${take.length})` : ""} · ${files.length} foto terlampir:`,
        ...lines,
        ...(firstLoc ? [`📍 ${firstLoc.location_url}`] : []),
      ].join("\n");
      const res = await shareToWhatsApp({ text, title: title.name, files });
      notifyShareResult(res);
    } catch (err) {
      toast.error(`Gagal kirim WA: ${(err as Error).message}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <Card id={`worker-shots-${title.id}`} className="scroll-mt-20 transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <Users className="h-4 w-4 text-primary" /> Kiriman pegawai
              {!loading && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {shots.length}
                </span>
              )}
            </CardTitle>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              Cocok via warehouse_item_id + {title.target_grams}{displayUnitStr} (fallback ukuran/unit).
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing || loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Segarkan
            </Button>
            <Button size="sm" onClick={sendWA} disabled={sending || shots.length === 0} className="bg-emerald-600 hover:bg-emerald-700">
              <MessageCircle className="h-3.5 w-3.5" /> Kirim WA
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
            {shots.map((s) => (
              <div key={s.id} className="group relative overflow-hidden rounded-md border bg-muted">
                <div className="aspect-square">
                  {s.thumb_url ? (
                    <img src={s.thumb_url} alt="" className="h-full w-full object-cover transition group-hover:scale-105" loading="lazy" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[11px] text-muted-foreground">no img</div>
                  )}
                </div>
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/80 to-transparent p-1.5 text-[11px] leading-snug text-white">
                  <span className="truncate">{new Date(s.submitted_at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  {s.location_url && (
                    <a href={s.location_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 rounded bg-black/50 px-1 py-0.5 backdrop-blur-sm">
                      <MapPin className="h-2.5 w-2.5" /> GPS
                    </a>
                  )}
                </div>
                {s.match !== "strict" && (
                  <span className="absolute left-1 top-1 rounded-full bg-amber-500/90 px-1.5 py-0.5 text-[11px] leading-snug font-semibold text-white" title={s.match === "fallback_grams" ? "Ukuran cocok, unit berbeda" : "Hanya produk yang cocok"}>
                    {s.match === "fallback_grams" ? "unit≠" : "ukuran≠"}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PrepBox({ prep, index, title, itemName, onChanged, onTitleUpdated }: {
  prep: EcerPreparation; index: number; title: EcerTitle; itemName?: string; onChanged: () => void; onTitleUpdated: () => void;
}) {
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
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="relative aspect-square w-full bg-muted">
        {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : (
          <div className="flex h-full w-full items-center justify-center text-[11px] leading-snug text-muted-foreground">No foto</div>
        )}
        <div className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] leading-snug font-medium text-white">#{index}</div>
        {prep.created_by === "worker" && (
          <div className="absolute right-1 top-1 rounded bg-blue-500/90 px-1.5 py-0.5 text-[11px] leading-snug font-medium text-white">Pegawai</div>
        )}
      </div>
      <div className="space-y-1 p-2">
        <div className="text-xs font-semibold">{prep.actual_grams} {displayUnit(itemName, title.unit_label)}</div>
        {prep.note && <div className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{prep.note}</div>}
        <div className="flex items-center justify-between gap-1 pt-1">
          {prep.location_url ? (
            <a href={prep.location_url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-[11px] leading-snug text-primary hover:underline">
              <MapPin className="h-3 w-3" /> Lokasi <ExternalLink className="h-2.5 w-2.5" />
            </a>
          ) : <span />}
          <div className="flex gap-0.5">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onShare}><Share2 className="h-3 w-3" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onDelete}><Trash2 className="h-3 w-3 text-destructive" /></Button>
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
    </div>
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
              <div className="mb-1 flex items-center justify-between text-[11px]">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-400">
                  ✓ Pratinjau foto
                </span>
                <span className="text-muted-foreground">{Math.round(photo.blob.size / 1024)} KB · ketuk untuk perbesar</span>
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
              <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-[11px] leading-relaxed text-destructive">
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
                  <div className="grid grid-cols-2 gap-2">
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

        {editorOpen && editorSrc && (
          <PhotoEditor src={editorSrc} onCancel={() => setEditorOpen(false)}
            onSave={(blob, dataUrl) => { setPhoto({ blob, dataUrl }); setEditorOpen(false); }} />
        )}

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

  const baseUnit: "g" | "pcs" = packageType === "pcs" || packageType === "botol" || packageType === "sachet"
    ? (packageType === "pcs" ? "pcs" : "g")
    : "g";

  async function save() {
    if (!name.trim()) { toast.error("Nama produk wajib diisi"); return; }
    const size = packageType === "pcs" ? 1 : Number(String(packageSize).replace(",", "."));
    if (packageType !== "pcs" && (!Number.isFinite(size) || size <= 0)) {
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
          <div className="grid grid-cols-2 gap-2">
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
            {packageType !== "pcs" && (
              <div>
                <Label className="text-xs">Isi/kemasan ({baseUnit})</Label>
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