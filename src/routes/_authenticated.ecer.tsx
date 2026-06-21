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
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Camera, Image as ImageIcon, Edit3, MapPin, Plus, Scale, Trash2,
  Share2, ExternalLink, Loader2, ChevronLeft, Package, AlertTriangle, RotateCw,
} from "lucide-react";
import {
  ECER_BUCKET, ecerSignedUrl, uploadEcerPhoto, deleteEcerPhoto,
  type EcerTitle, type EcerPreparation,
} from "@/lib/ecer";
import { shareToWhatsApp, buildWhatsAppUrl, notifyShareResult } from "@/lib/share-wa";

export const Route = createFileRoute("/_authenticated/ecer")({
  head: () => ({ meta: [{ title: "Penyiapan Ecer · MCM Storage" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    item: typeof s.item === "string" ? s.item : undefined,
    title: typeof s.title === "string" ? s.title : undefined,
  }),
  component: EcerPage,
});

type WarehouseItem = {
  id: string; name: string; category: string | null; base_unit: string;
  stock_base: number; image_path: string | null;
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
  const [editingTitle, setEditingTitle] = useState<EcerTitle | null>(null);
  const [creatingTitle, setCreatingTitle] = useState(false);

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
        supabase.from("warehouse_items").select("id,name,category,base_unit,stock_base,image_path").order("name"),
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
      search: { item: selectedItemId, title: selectedTitleId },
      replace: true,
    });
  }, [selectedItemId, selectedTitleId, router]);

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

  async function refetchTitles() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.from as any)("ecer_titles").select("*").order("position").order("created_at");
    if (data) setTitles(data as EcerTitle[]);
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
      <TitleDetailView
        item={selectedItem}
        title={selectedTitle}
        onBack={() => setSelectedTitleId(undefined)}
        onTitleUpdated={refetchTitles}
      />
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
              {it.category ? `[${it.category}] ` : ""}{it.name} · stok {it.stock_base} {it.base_unit}
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
                {selectedItem.category ?? "—"} · stok {selectedItem.stock_base} {selectedItem.base_unit}
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
                    onOpen={() => setSelectedTitleId(t.id)}
                    onEdit={() => setEditingTitle(t)}
                    onDeleted={refetchTitles}
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
          onSaved={() => { setCreatingTitle(false); setEditingTitle(null); void refetchTitles(); }}
        />
      )}
    </div>
  );
}

function TitleCard({ title, onOpen, onEdit, onDeleted }: {
  title: EcerTitle; onOpen: () => void; onEdit: () => void; onDeleted: () => void;
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
    <div className="rounded-lg border bg-card p-3 transition hover:border-primary/40">
      <button onClick={onOpen} className="block w-full text-left">
        <div className="font-medium leading-tight">{title.name}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Target: <b>{title.target_grams} {title.unit_label}</b> · {count ?? "…"} penyiapan
        </div>
        {title.note && <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{title.note}</div>}
      </button>
      <div className="mt-2 flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={onEdit}><Edit3 className="h-3.5 w-3.5" /></Button>
        <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
      </div>
    </div>
  );
}

function TitleFormDialog({ item, existing, onClose, onSaved }: {
  item: WarehouseItem; existing: EcerTitle | null;
  onClose: () => void; onSaved: () => void;
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
    const { error } = existing
      ? await tbl.update(payload).eq("id", existing.id)
      : await tbl.insert({ ...payload, user_id: userId, warehouse_item_id: item.id });
    setBusy(false);
    if (error) { toast.error("Gagal: " + error.message); return; }
    toast.success(existing ? "Tersimpan" : "Judul dibuat");
    onSaved();
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
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. KRISTAL 1 gram" />
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

// ---- Detail view: preparations grid ----
function TitleDetailView({ item, title, onBack, onTitleUpdated }: {
  item: WarehouseItem; title: EcerTitle; onBack: () => void; onTitleUpdated: () => void;
}) {
  const [preps, setPreps] = useState<EcerPreparation[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.from as any)("ecer_preparations")
      .select("*").eq("title_id", title.id).order("created_at", { ascending: false });
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
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="truncate text-base">{title.name}</CardTitle>
              <div className="mt-0.5 text-xs text-muted-foreground">
                <Package className="mr-1 inline h-3 w-3" />
                {item.name} · target <b>{title.target_grams} {title.unit_label}</b> · stok produk {item.stock_base} {item.base_unit}
              </div>
              {title.note && <div className="mt-1 text-[11px] text-muted-foreground whitespace-pre-wrap">{title.note}</div>}
            </div>
            <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Penyiapan</Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-6 text-center text-xs text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin" /> Memuat…</div>
          ) : preps.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
              Belum ada penyiapan. Tekan <b>+ Penyiapan</b> untuk menambah kotak baru.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {preps.map((p, idx) => (
                <PrepBox key={p.id} prep={p} index={preps.length - idx} title={title} onChanged={load} onTitleUpdated={onTitleUpdated} />
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
    </div>
  );
}

function PrepBox({ prep, index, title, onChanged, onTitleUpdated }: {
  prep: EcerPreparation; index: number; title: EcerTitle; onChanged: () => void; onTitleUpdated: () => void;
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
  useEffect(() => { void ecerSignedUrl(prep.photo_path).then(setUrl); }, [prep.photo_path]);

  async function onShare() {
    const text =
      `*${title.name}* #${index}\n` +
      `Berat aktual: ${prep.actual_grams} ${title.unit_label}\n` +
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
        const signed = await ecerSignedUrl(prep.photo_path, 600);
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
      `Hapus penyiapan ini? Stok produk akan dikembalikan sebanyak ${prep.actual_grams} ${title.unit_label}.`
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
          <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">No foto</div>
        )}
        <div className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">#{index}</div>
        {prep.created_by === "worker" && (
          <div className="absolute right-1 top-1 rounded bg-blue-500/90 px-1.5 py-0.5 text-[10px] font-medium text-white">Pegawai</div>
        )}
      </div>
      <div className="space-y-1 p-2">
        <div className="text-xs font-semibold">{prep.actual_grams} {title.unit_label}</div>
        {prep.note && <div className="line-clamp-2 text-[10px] text-muted-foreground">{prep.note}</div>}
        <div className="flex items-center justify-between gap-1 pt-1">
          {prep.location_url ? (
            <a href={prep.location_url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline">
              <MapPin className="h-3 w-3" /> Lokasi <ExternalLink className="h-2.5 w-2.5" />
            </a>
          ) : <span />}
          <div className="flex gap-0.5">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onShare}><Share2 className="h-3 w-3" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onDelete}><Trash2 className="h-3 w-3 text-destructive" /></Button>
          </div>
        </div>
        <div className="text-[9px] text-muted-foreground">
          {new Date(prep.created_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
        </div>
        {shareDiag && (
          <div className="mt-1 space-y-1 rounded border border-destructive/40 bg-destructive/5 p-2 text-[10px]">
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
  const [locUrl, setLocUrl] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [actual, setActual] = useState(String(title.target_grams));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    const dataUrl = await new Promise<string>((res) => {
      const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f);
    });
    setEditorSrc(dataUrl); setEditorOpen(true);
    if (!gps && !locUrl && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          setGps({ lat: latitude, lng: longitude });
          setLocUrl(`https://www.google.com/maps?q=${latitude},${longitude}`);
        },
        () => { /* ignore */ },
        { enableHighAccuracy: true, timeout: 10000 },
      );
    }
  }

  function takeLocation() {
    if (!navigator.geolocation) { toast.error("GPS tidak tersedia"); return; }
    const id = toast.loading("Mengambil lokasi…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setGps({ lat: latitude, lng: longitude });
        setLocUrl(`https://www.google.com/maps?q=${latitude},${longitude}`);
        toast.success("Lokasi terisi", { id });
      },
      (err) => toast.error("Gagal: " + err.message, { id }),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function save() {
    const grams = Number(String(actual).replace(",", "."));
    if (!Number.isFinite(grams) || grams <= 0) { toast.error("Berat aktual tidak valid"); return; }
    if (grams > Number(item.stock_base)) {
      toast.error(`Stok tidak cukup (tersedia ${item.stock_base} ${item.base_unit})`); return;
    }
    if (locUrl) {
      if (locUrl.length > 2048) { toast.error("URL lokasi terlalu panjang"); return; }
      if (!/^https:\/\//i.test(locUrl)) { toast.error("URL harus diawali https://"); return; }
    }
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const userId = u.user?.id;
      if (!userId) throw new Error("Sesi tidak valid");
      let photoPath: string | null = null;
      if (photo) {
        photoPath = await uploadEcerPhoto(userId, title.id, photo.blob, "jpg");
        if (!photoPath) throw new Error("Upload foto gagal");
      }
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
      toast.success(`Tersimpan. Stok dikurangi ${grams} ${title.unit_label}`);
      onSaved();
    } catch (e) {
      toast.error("Gagal: " + (e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Penyiapan baru</DialogTitle>
          <DialogDescription>{title.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {photo ? (
            <div>
              <img src={photo.dataUrl} alt="" className="w-full rounded-lg border object-cover" />
              <div className="mt-1 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { setEditorSrc(photo.dataUrl); setEditorOpen(true); }}>
                  <Edit3 className="h-3 w-3" /> Edit lagi
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPhoto(null)}>Hapus foto</Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => cameraRef.current?.click()}><Camera className="h-4 w-4" /> Kamera</Button>
              <Button variant="outline" onClick={() => galleryRef.current?.click()}><ImageIcon className="h-4 w-4" /> Galeri</Button>
            </div>
          )}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
          <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={onFile} />

          <div>
            <Label className="text-xs">Berat aktual ({title.unit_label})</Label>
            <Input inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value)} />
            <div className="mt-1 text-[10px] text-muted-foreground">Stok produk akan berkurang sebanyak angka ini.</div>
          </div>

          <div>
            <Label className="text-xs">Link lokasi</Label>
            <div className="flex gap-2">
              <Input value={locUrl} onChange={(e) => setLocUrl(e.target.value)} placeholder="https://maps.google.com/…" />
              <Button variant="outline" onClick={takeLocation}><MapPin className="h-4 w-4" /> GPS</Button>
            </div>
          </div>

          <div>
            <Label className="text-xs">Keterangan</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan tentang produk / penyiapan…" rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button onClick={save} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Simpan
          </Button>
        </DialogFooter>

        {editorOpen && editorSrc && (
          <PhotoEditor src={editorSrc} onCancel={() => setEditorOpen(false)}
            onSave={(blob, dataUrl) => { setPhoto({ blob, dataUrl }); setEditorOpen(false); }} />
        )}
      </DialogContent>
    </Dialog>
  );
}

// keep ECER_BUCKET reachable so unused import is not flagged
void ECER_BUCKET;