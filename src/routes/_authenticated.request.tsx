import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PhotoEditor } from "@/components/PhotoEditor";
import { displayUnit } from "@/lib/unit-label";
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
  AlertTriangle, RotateCw, Send, MessageCircle,
} from "lucide-react";
import {
  requestSignedUrl, uploadRequestPhoto, deleteRequestPhoto,
  type RequestTitle, type RequestTitleItem, type RequestPreparation,
} from "@/lib/request";
import { shareToWhatsApp, notifyShareResult } from "@/lib/share-wa";
import { publicTaskUrl } from "@/lib/prep";

export const Route = createFileRoute("/_authenticated/request")({
  head: () => ({ meta: [{ title: "Penyiapan Request · MCM Storage" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    title: typeof s.title === "string" ? s.title : undefined,
    highlight: typeof s.highlight === "string" ? s.highlight : undefined,
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
  const [loading, setLoading] = useState(true);
  type LoadErr = {
    source: string; message: string; code?: string; status?: number;
    hint?: string; details?: string; diagnosis: string;
  };
  const [loadError, setLoadError] = useState<LoadErr | null>(null);
  const [selectedTitleId, setSelectedTitleId] = useState<string | undefined>(search.title);
  const [highlightTitleId, setHighlightTitleId] = useState<string | undefined>(search.highlight);
  const [creatingTitle, setCreatingTitle] = useState(false);
  const [editingTitle, setEditingTitle] = useState<RequestTitle | null>(null);
  const [testOpen, setTestOpen] = useState(false);

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
  }, [selectedTitleId, router]);

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
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Memuat…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 p-4">
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm">
          <div className="mb-2 flex items-center gap-2 font-semibold text-destructive">
            <AlertTriangle className="h-4 w-4" /> Gagal memuat Penyiapan Request
          </div>
          <div className="space-y-1 text-xs">
            <div><b>Sumber:</b> {loadError.source}</div>
            <div className="rounded bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300"><b>Diagnosa:</b> {loadError.diagnosis}</div>
            <div><b>Pesan:</b> {loadError.message}</div>
            {loadError.code && <div><b>Kode:</b> {loadError.code}</div>}
            {loadError.status !== undefined && <div><b>HTTP:</b> {loadError.status}</div>}
            {loadError.hint && <div><b>Hint:</b> {loadError.hint}</div>}
            {loadError.details && <div><b>Detail:</b> {loadError.details}</div>}
            <div><b>Jaringan:</b> {typeof navigator !== "undefined" && navigator.onLine ? "online" : "offline"}</div>
          </div>
          <div className="mt-3 flex gap-2">
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
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-3 sm:p-5">
      <div className="flex items-center gap-2">
        <PackagePlus className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold">Penyiapan Request</h1>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Buat <b>Judul Request</b> berisi beberapa produk sekaligus (mis. <i>Paket Bu Ani</i>: Kristal 1g + Madu 250g).
        Tiap kotak penyiapan = 1 paket dengan satu foto + lokasi. Stok semua produk otomatis berkurang.
      </p>

      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => setTestOpen(true)}>
          <FlaskConical className="mr-1 h-4 w-4" /> Uji Coba Alur Pegawai
        </Button>
        <Button size="sm" onClick={() => setCreatingTitle(true)}>
          <Plus className="mr-1 h-4 w-4" /> Judul Request Baru
        </Button>
      </div>

      {titles.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
          Belum ada judul request. Klik tombol di atas untuk membuat yang pertama.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                  lines.push(`• ${w?.name ?? "?"} ${i.target_grams}${displayUnit(w?.name, i.unit_label)}`);
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
            return (
              <button
                key={t.id}
                onClick={() => setSelectedTitleId(t.id)}
                data-request-title-id={t.id}
                className={`flex flex-col gap-1 rounded-xl border bg-card p-3 text-left hover:border-primary/40 hover:bg-accent ${highlightTitleId === t.id ? "ring-2 ring-primary border-primary animate-pulse" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <div className="truncate font-semibold">{t.name}</div>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    {tItems.length} produk
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground line-clamp-2">
                  {tItems.length > 0
                    ? tItems
                        .map((i) => {
                          const w = items.find((wi) => wi.id === i.warehouse_item_id);
                          return `${w?.name ?? "?"} ${i.target_grams}${displayUnit(w?.name, i.unit_label)}`;
                        })
                        .join(" · ")
                    : "Belum ada produk"}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); setEditingTitle(t); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setEditingTitle(t); } }}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
                  >
                    <Edit3 className="h-3 w-3" /> Edit
                  </div>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); sendTitleWA(); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); sendTitleWA(); } }}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[#25D366]/40 bg-[#25D366]/15 px-2 py-0.5 text-[10px] text-[#0b6b3a] hover:bg-[#25D366]/25 dark:text-[#7ee2a8]"
                    aria-label="Kirim WA"
                  >
                    <MessageCircle className="h-3 w-3" /> Kirim WA
                  </div>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); void deleteTitle(); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); void deleteTitle(); } }}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] text-destructive hover:bg-destructive/20"
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
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Array<{ warehouse_item_id: string; target_grams: string; unit_label: string; note: string }>>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? "");
    setNote(existing?.note ?? "");
    setRows(
      existingItems.length > 0
        ? existingItems.map((i) => ({
            warehouse_item_id: i.warehouse_item_id,
            target_grams: String(i.target_grams),
            unit_label: i.unit_label,
            note: i.note ?? "",
          }))
        : [{ warehouse_item_id: "", target_grams: "1", unit_label: "gram", note: "" }],
    );
  }, [open, existing, existingItems]);

  function addRow() {
    setRows((r) => [...r, { warehouse_item_id: "", target_grams: "1", unit_label: "gram", note: "" }]);
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
    const validRows = rows.filter((r) => r.warehouse_item_id && Number(r.target_grams) > 0);
    if (validRows.length === 0) { toast.error("Tambahkan minimal 1 produk"); return; }
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
        unit_label: r.unit_label || "gram",
        note: r.note.trim() || null,
        position: idx,
      }));
      const { error: e2 } = await sb.from("request_title_items").insert(payload);
      if (e2) throw e2;
      toast.success("Judul tersimpan");
      onSaved(); onClose();
    } catch (e) {
      toast.error("Gagal: " + (e as Error).message);
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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Judul Request" : "Judul Request Baru"}</DialogTitle>
          <DialogDescription>Tambahkan beberapa produk dalam 1 paket. Saat penyiapan, stok semua produk akan otomatis berkurang.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nama judul</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="cth. Paket Bu Ani" />
          </div>
          <div>
            <Label>Catatan (opsional)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label>Produk dalam paket</Label>
              <Button type="button" size="sm" variant="outline" onClick={addRow}>
                <Plus className="mr-1 h-3 w-3" /> Tambah
              </Button>
            </div>
            <div className="space-y-2">
              {rows.map((r, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-1.5 rounded-md border bg-muted/30 p-2">
                  <select
                    value={r.warehouse_item_id}
                    onChange={(e) => updateRow(idx, { warehouse_item_id: e.target.value })}
                    className="col-span-7 h-9 rounded-md border bg-background px-2 text-xs"
                  >
                    <option value="">— pilih produk —</option>
                    {warehouseItems.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                  <Input
                    type="number" inputMode="decimal" step="any" min="0"
                    value={r.target_grams}
                    onChange={(e) => updateRow(idx, { target_grams: e.target.value })}
                    className="col-span-3 h-9 text-xs"
                    placeholder="0"
                  />
                  <Input
                    value={r.unit_label}
                    onChange={(e) => updateRow(idx, { unit_label: e.target.value })}
                    className="col-span-2 h-9 text-xs"
                    placeholder="gram"
                  />
                  <Input
                    value={r.note}
                    onChange={(e) => updateRow(idx, { note: e.target.value })}
                    className="col-span-11 h-8 text-[11px]"
                    placeholder="catatan item (opsional)"
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    className="col-span-1 flex items-center justify-center rounded-md border text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter className="flex-row justify-between sm:justify-between">
          {existing ? (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={deleteTitle} disabled={busy}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Hapus
            </Button>
          ) : <span />}
          <div className="flex gap-2">
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

function TitleDetailView({
  title, warehouseItems, titleItems, onBack, onChanged,
}: {
  title: RequestTitle;
  warehouseItems: WarehouseItem[];
  titleItems: RequestTitleItem[];
  onBack: () => void;
  onChanged: () => void;
}) {
  const [preps, setPreps] = useState<RequestPreparation[]>([]);
  const [prepItems, setPrepItems] = useState<Array<{ id: string; preparation_id: string; warehouse_item_id: string; actual_grams: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await sb.from("request_preparations").select("*").eq("title_id", title.id).order("created_at", { ascending: false });
    const list = (data ?? []) as RequestPreparation[];
    setPreps(list);
    if (list.length > 0) {
      const ids = list.map((p) => p.id);
      const { data: pi } = await sb.from("request_preparation_items").select("id,preparation_id,warehouse_item_id,actual_grams").in("preparation_id", ids);
      setPrepItems((pi ?? []) as typeof prepItems);
    } else {
      setPrepItems([]);
    }
    setLoading(false);
  }
  useEffect(() => { void load(); }, [title.id]);

  async function handleDelete(p: RequestPreparation) {
    if (!confirm("Hapus penyiapan ini? Stok akan dikembalikan.")) return;
    try {
      await deleteRequestPhoto(p.photo_path);
      const { error } = await sb.from("request_preparations").delete().eq("id", p.id);
      if (error) throw error;
      toast.success("Penyiapan dihapus, stok dikembalikan");
      onChanged(); void load();
    } catch (e) { toast.error("Gagal: " + (e as Error).message); }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-3 sm:p-5">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-3 w-3" /> Kembali
      </button>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4 text-primary" /> {title.name}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          {title.note && <p className="text-muted-foreground whitespace-pre-wrap">{title.note}</p>}
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Isi paket</div>
            <div className="flex flex-wrap gap-1.5">
              {titleItems.map((i) => {
                const w = warehouseItems.find((x) => x.id === i.warehouse_item_id);
                return (
                  <span key={i.id} className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    {w?.name ?? "?"} {i.target_grams}{displayUnit(w?.name, i.unit_label)}
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
        <div className="p-6 text-center text-xs text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></div>
      ) : preps.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-6 text-center text-xs text-muted-foreground">
          Belum ada penyiapan untuk judul ini.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {preps.map((p, idx) => (
            <PrepCard
              key={p.id}
              index={preps.length - idx}
              prep={p}
              items={prepItems.filter((pi) => pi.preparation_id === p.id)}
              warehouseItems={warehouseItems}
              titleItems={titleItems}
              onDelete={() => handleDelete(p)}
            />
          ))}
        </div>
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

function PrepCard({
  index, prep, items, warehouseItems, titleItems, onDelete,
}: {
  index: number;
  prep: RequestPreparation;
  items: Array<{ id: string; warehouse_item_id: string; actual_grams: number }>;
  warehouseItems: WarehouseItem[];
  titleItems: RequestTitleItem[];
  onDelete: () => void;
}) {
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => { requestSignedUrl(prep.photo_path, 60 * 60).then(setPhoto); }, [prep.photo_path]);
  const unitFor = (wid: string) => {
    const w = warehouseItems.find((x) => x.id === wid);
    const ti = titleItems.find((t) => t.warehouse_item_id === wid);
    return displayUnit(w?.name, ti?.unit_label ?? w?.base_unit ?? "g");
  };
  const sendWA = () => {
    const lines: string[] = [];
    lines.push(`*Paket #${index}*`);
    if (items.length > 0) {
      lines.push("Isi:");
      items.forEach((it) => {
        const w = warehouseItems.find((x) => x.id === it.warehouse_item_id);
        lines.push(`• ${w?.name ?? "?"} ${it.actual_grams} ${unitFor(it.warehouse_item_id)}`);
      });
    }
    if (prep.note) { lines.push(""); lines.push(`Catatan: ${prep.note}`); }
    if (prep.location_url) { lines.push(""); lines.push(`Lokasi: ${prep.location_url}`); }
    lines.push("");
    lines.push(`Disiapkan: ${new Date(prep.created_at).toLocaleString("id-ID")}`);
    void shareToWhatsApp({ text: lines.join("\n"), title: `Paket #${index}` }).then(notifyShareResult);
  };
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Paket #{index} · {prep.created_by}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={sendWA}
            className="rounded-md border border-[#25D366]/40 bg-[#25D366]/15 p-1 text-[#0b6b3a] hover:bg-[#25D366]/25 dark:text-[#7ee2a8]"
            aria-label="Kirim WA"
            title="Kirim ringkasan via WhatsApp"
          >
            <MessageCircle className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="rounded-md border border-destructive/40 bg-destructive/10 p-1 text-destructive hover:bg-destructive/20"
            aria-label="Hapus penyiapan"
            title="Hapus penyiapan"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {photo ? (
        <img src={photo} alt="" className="aspect-square w-full object-cover" />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center bg-muted text-xs text-muted-foreground">No photo</div>
      )}
      <div className="space-y-1.5 p-3 text-[11px]">
        <div className="flex flex-wrap gap-1">
          {items.map((it) => {
            const w = warehouseItems.find((x) => x.id === it.warehouse_item_id);
            return (
              <span key={it.id} className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {w?.name ?? "?"} {it.actual_grams}{unitFor(it.warehouse_item_id)}
              </span>
            );
          })}
        </div>
        {prep.location_url && (
          <a href={prep.location_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            <MapPin className="h-3 w-3" /> Lokasi
          </a>
        )}
        {prep.note && <div className="text-muted-foreground">{prep.note}</div>}
        <div className="text-muted-foreground">{new Date(prep.created_at).toLocaleString("id-ID")}</div>
      </div>
    </div>
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
  const [rows, setRows] = useState<Array<{ warehouse_item_id: string; actual_grams: string }>>([]);
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

  /**
   * Normalisasi nomor WA ke format E.164 digit-only (tanpa "+").
   * - Hapus semua karakter non-digit (spasi, "-", "()", "+", dst).
   * - Awalan "00" (mis. 0062…) → buang prefix internasional 00.
   * - Awalan "0" lokal Indonesia (mis. 0812…) → ganti jadi "62".
   * Mengembalikan { digits, error }. digits = "" bila tidak valid.
   */
  function normalizeWaPhone(raw: string): { digits: string; error: string | null } {
    let d = (raw || "").replace(/\D/g, "");
    if (!d) return { digits: "", error: "Nomor WA wajib diisi" };
    if (d.startsWith("00")) d = d.slice(2);
    else if (d.startsWith("0")) d = "62" + d.slice(1);
    if (d.length < 8 || d.length > 15) {
      return { digits: "", error: "Nomor WA harus 8–15 digit (format internasional)" };
    }
    if (/^0+$/.test(d)) return { digits: "", error: "Nomor WA tidak valid" };
    return { digits: d, error: null };
  }

  const waNorm = normalizeWaPhone(waPhone);

  useEffect(() => {
    if (!open) return;
    setRows(titleItems.map((i) => ({ warehouse_item_id: i.warehouse_item_id, actual_grams: String(i.target_grams) })));
    setPhoto(null); setLocUrl(""); setGps(null); setNote(""); setWaPhone("");
  }, [open, titleItems]);

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

  async function save(opts?: { sendWa?: boolean }) {
    if (!photo) { toast.error("Wajib lampirkan foto"); return; }
    const validRows = rows.filter((r) => r.warehouse_item_id && Number(r.actual_grams) > 0);
    if (validRows.length === 0) { toast.error("Minimal 1 produk dengan gram > 0"); return; }
    let normalizedPhone = "";
    if (opts?.sendWa) {
      const n = normalizeWaPhone(waPhone);
      if (n.error) { toast.error(n.error); return; }
      normalizedPhone = n.digits;
    }
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
          toast.error("Gagal kirim WA: " + (err as Error).message);
        }
      }
      onSaved(); onClose();
    } catch (e) {
      toast.error("Gagal: " + (e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !editorOpen) onClose(); }}>
      <DialogContent
        className="max-h-[90vh] max-w-md overflow-y-auto"
        onInteractOutside={(event) => {
          if (editorOpen) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Penyiapan Baru — {title.name}</DialogTitle>
          <DialogDescription>Atur jumlah aktual tiap produk, lampirkan 1 foto bukti + lokasi.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Produk &amp; jumlah aktual</Label>
            <div className="space-y-1.5">
              {rows.map((r, idx) => {
                const w = warehouseItems.find((x) => x.id === r.warehouse_item_id);
                const ti = titleItems.find((t) => t.warehouse_item_id === r.warehouse_item_id);
                const unit = displayUnit(w?.name, ti?.unit_label ?? w?.base_unit ?? "g");
                return (
                  <div key={idx} className="grid grid-cols-12 gap-1.5">
                    <div className="col-span-7 flex items-center rounded-md border bg-muted/30 px-2 text-xs">
                      {w?.name ?? "?"}
                    </div>
                    <Input
                      type="number" inputMode="decimal" step="any" min="0"
                      value={r.actual_grams}
                      onChange={(e) => setRows((rs) => rs.map((x, i) => i === idx ? { ...x, actual_grams: e.target.value } : x))}
                      className="col-span-3 h-9 text-xs"
                    />
                    <div className="col-span-2 flex items-center justify-center rounded-md border bg-muted/30 px-1 text-[11px] font-medium text-muted-foreground">
                      {unit}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {photo ? (
            <div>
              <img src={photo.dataUrl} alt="" className="w-full rounded-lg border object-cover" />
              <div className="mt-1 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { setEditorSrc(photo.dataUrl); setEditorOpen(true); }}>
                  <Edit3 className="mr-1 h-3 w-3" /> Edit
                </Button>
                <Button size="sm" variant="outline" className="text-destructive" onClick={() => setPhoto(null)}>Hapus</Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
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

          <div className="flex gap-2">
            <Input value={locUrl} onChange={(e) => setLocUrl(e.target.value)} placeholder="Link Google Maps (opsional)" className="flex-1" />
            <Button variant="outline" onClick={takeLocation}>
              <MapPin className="mr-1 h-4 w-4" /> GPS
            </Button>
          </div>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan (opsional)" />

          <div>
            <Label className="text-xs">Nomor WhatsApp tujuan</Label>
            <Input
              type="tel"
              inputMode="tel"
              value={waPhone}
              onChange={(e) => setWaPhone(e.target.value)}
              placeholder="cth: 628123456789"
            />
            {waPhone.trim() === "" ? (
              <p className="mt-1 text-[10px] text-muted-foreground">Format internasional tanpa tanda +. Awalan 0 otomatis diganti jadi 62.</p>
            ) : waNorm.error ? (
              <p className="mt-1 text-[10px] text-destructive">{waNorm.error}</p>
            ) : (
              <p className="mt-1 text-[10px] text-muted-foreground">Akan dikirim ke: <span className="font-mono">+{waNorm.digits}</span></p>
            )}
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button size="sm" onClick={() => save({ sendWa: true })} disabled={busy || !!waNorm.error} className="w-full">
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Send className="mr-1 h-3 w-3" />}
            Simpan &amp; Kirim WA
          </Button>
          <div className="flex w-full gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy} className="flex-1">Batal</Button>
            <Button size="sm" onClick={() => save()} disabled={busy} className="flex-1">
              {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null} Simpan
            </Button>
          </div>
        </DialogFooter>

        {editorOpen && editorSrc && (
          <PhotoEditor
            src={editorSrc}
            onCancel={() => setEditorOpen(false)}
            onSave={(blob, dataUrl) => { setPhoto({ blob, dataUrl }); setEditorOpen(false); }}
          />
        )}
      </DialogContent>
    </Dialog>
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

  function copyAll() {
    if (!session) return;
    void navigator.clipboard.writeText(`Link: ${session.url}\nPIN: ${session.pin}`);
    toast.success("Disalin");
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
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" /> Uji Coba Alur Pegawai
          </DialogTitle>
          <DialogDescription>
            Buat tugas pegawai sementara untuk menguji: QR/PIN, pilih judul Request, input gram, foto + lokasi, dan kirim.
            Sesi aktif beberapa jam — tidak akan mengganggu data nyata.
          </DialogDescription>
        </DialogHeader>

        {!session ? (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">PIN uji coba (opsional, min 4 digit)</Label>
              <Input
                inputMode="numeric" maxLength={8}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder="Kosongkan untuk acak"
              />
            </div>
            <div className="rounded-md border bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
              Pastikan sudah ada minimal 1 Judul Request dengan beberapa produk. Saat ini: <b>{titles.length} judul</b>.
            </div>
            <Button className="w-full" onClick={createSession} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-1 h-4 w-4" />}
              Mulai Uji Coba
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-center rounded-lg border bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrUrl} alt="QR uji coba" width={200} height={200} />
            </div>
            <div className="space-y-1.5">
              <div>
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Link</Label>
                <div className="break-all rounded-md border bg-muted/30 px-2 py-1.5 text-[11px] font-mono">
                  {session.url}
                </div>
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">PIN</Label>
                <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-center text-lg font-bold tracking-[0.4em] tabular-nums">
                  {session.pin}
                </div>
              </div>
            </div>
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
              <b>Tips uji:</b> Buka link di tab baru / HP, masukkan PIN, scroll ke <b>"Paket Request"</b>,
              pilih satu judul, isi gram tiap produk, ambil foto + lokasi, lalu Kirim.
              Stok produk akan benar-benar berkurang. Tekan <b>"Batalkan sesi uji coba"</b> untuk mengembalikan stok &amp; menghapus paket uji.
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" onClick={copyAll}>
                <Copy className="mr-1 h-3.5 w-3.5" /> Salin Link+PIN
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
