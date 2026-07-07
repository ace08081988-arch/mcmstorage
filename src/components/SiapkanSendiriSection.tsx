import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, Image as ImageIcon, MapPin, Trash2, Send, ExternalLink, Loader2, CheckCircle2, ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut, RotateCcw, Crosshair } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { shareToWhatsApp, notifyShareResult } from "@/lib/share-wa";
import { shareToChat } from "@/lib/share-chat";
import { PickChatConversationDialog } from "@/components/PickChatConversationDialog";
import { MessageCircle } from "lucide-react";
import { confirm as confirmDialog } from "@/lib/confirm";
import { getCurrentLocation, toGeoError } from "@/lib/get-location";
import { SellSelfPrepDialog, type SellSelfPrepCustomer, type SellSelfPrepWarehouseItem } from "@/components/SellSelfPrepDialog";
import { formatSoldPaymentSummary } from "@/lib/payment-summary";
import { rupiah } from "@/lib/stock-format";
import { Wallet, HandCoins } from "lucide-react";

const BUCKET = "self-prep-photos";

function parseLatLngFromUrl(s: string): { lat: number; lng: number } | null {
  if (!s) return null;
  const patterns = [
    /[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /[?&]ll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /^\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*$/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return { lat, lng };
      }
    }
  }
  return null;
}

type Row = {
  id: string;
  user_id: string;
  title: string;
  photo_path: string | null;
  photo_paths?: string[] | null;
  location_url: string | null;
  note: string | null;
  status: "ready" | "sent";
  wa_target: string | null;
  sent_at: string | null;
  sent_channel?: "wa" | "chat" | null;
  sent_to?: string | null;
  sent_summary?: string | null;
  created_at: string;
  // Kolom penjualan (baru — diisi oleh SellSelfPrepDialog)
  sold_at?: string | null;
  sold_customer_id?: string | null;
  sold_total?: number | null;
  sold_paid_amount?: number | null;
  sold_payment_method?: string | null;
  sold_debt_id?: string | null;
  sold_summary?: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = (): any => (supabase.from as any)("self_prep_items");

function isHttpsUrl(s: string): boolean {
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

export function SiapkanSendiriSection({ uid }: { uid: string | null }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  const [title, setTitle] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [locationUrl, setLocationUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [chatPickTarget, setChatPickTarget] = useState<Row | null>(null);
  const [chatSendingId, setChatSendingId] = useState<string | null>(null);
  const [sellTarget, setSellTarget] = useState<Row | null>(null);
  const [customers, setCustomers] = useState<SellSelfPrepCustomer[]>([]);
  const [warehouseItems, setWarehouseItems] = useState<SellSelfPrepWarehouseItem[]>([]);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const lastTapRef = useRef<number>(0);

  const resetView = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);
  useEffect(() => { resetView(); }, [lightboxIdx, resetView]);

  const clampPan = useCallback((z: number, p: { x: number; y: number }) => {
    if (z <= 1) return { x: 0, y: 0 };
    const max = 600 * (z - 1);
    return { x: Math.max(-max, Math.min(max, p.x)), y: Math.max(-max, Math.min(max, p.y)) };
  }, []);

  const zoomBy = useCallback((factor: number) => {
    setZoom((z) => {
      const next = Math.max(1, Math.min(5, z * factor));
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  useEffect(() => {
    if (lightboxIdx === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightboxIdx(null);
      else if (e.key === "ArrowLeft") setLightboxIdx((i) => (i === null ? i : (i - 1 + previewUrls.length) % previewUrls.length));
      else if (e.key === "ArrowRight") setLightboxIdx((i) => (i === null ? i : (i + 1) % previewUrls.length));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIdx, previewUrls.length]);

  useEffect(() => {
    if (lightboxIdx !== null && lightboxIdx >= previewUrls.length) {
      setLightboxIdx(previewUrls.length === 0 ? null : previewUrls.length - 1);
    }
  }, [previewUrls.length, lightboxIdx]);

  const load = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    const { data, error } = await table()
      .select("*")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const list = (data ?? []) as Row[];
    setRows(list);
    // Pre-sign thumbnails (1 jam)
    const paths = Array.from(
      new Set(
        list.flatMap((r) => [
          r.photo_path ?? null,
          ...((r.photo_paths ?? []) as string[]),
        ]).filter((p): p is string => !!p),
      ),
    );
    if (paths.length) {
      const map: Record<string, string> = {};
      await Promise.all(
        paths.map(async (p) => {
          const { data } = await supabase.storage.from(BUCKET).createSignedUrl(p, 3600);
          if (data?.signedUrl) map[p] = data.signedUrl;
        }),
      );
      setThumbs(map);
    } else {
      setThumbs({});
    }
  }, [uid]);

  useEffect(() => { void load(); }, [load]);

  // Ambil daftar pelanggan & produk gudang sekali per uid — dipakai oleh
  // SellSelfPrepDialog. RLS memastikan hanya milik user.
  useEffect(() => {
    if (!uid) { setCustomers([]); setWarehouseItems([]); return; }
    let alive = true;
    void (async () => {
      const [cRes, wRes] = await Promise.all([
        supabase.from("customers").select("id,name,contact").order("name"),
        supabase.from("warehouse_items")
          .select("id,name,package_type,package_size,base_unit,stock_base,avg_cost_per_base")
          .order("name"),
      ]);
      if (!alive) return;
      if (cRes.data) setCustomers(cRes.data as SellSelfPrepCustomer[]);
      if (wRes.data) setWarehouseItems(wRes.data as SellSelfPrepWarehouseItem[]);
    })();
    return () => { alive = false; };
  }, [uid]);

  useEffect(() => {
    if (files.length === 0) { setPreviewUrls([]); return; }
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviewUrls(urls);
    return () => { urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [files]);

  function resetForm() {
    setTitle("");
    setFiles([]);
    setLocationUrl("");
    setNote("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onSave() {
    if (!uid) return toast.error("Belum login.");
    if (!title.trim()) return toast.error("Judul wajib diisi.");
    if (locationUrl.trim() && !isHttpsUrl(locationUrl.trim())) {
      return toast.error("Link lokasi harus diawali https://");
    }
    setBusy(true);
    try {
      const uploadedPaths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const ext = (f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
        const path = `${uid}/${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const up = await supabase.storage.from(BUCKET).upload(path, f, {
          contentType: f.type || "image/jpeg",
          upsert: false,
        });
        if (up.error) {
          // rollback any prior uploads in this batch
          if (uploadedPaths.length) {
            await supabase.storage.from(BUCKET).remove(uploadedPaths);
          }
          toast.error(`Upload gagal (foto ${i + 1}): ${up.error.message}`);
          setBusy(false);
          return;
        }
        uploadedPaths.push(path);
      }
      const photoPath = uploadedPaths[0] ?? null;
      const { error } = await table().insert({
        user_id: uid,
        title: title.trim(),
        photo_path: photoPath,
        photo_paths: uploadedPaths,
        location_url: locationUrl.trim() || null,
        note: note.trim() || null,
        status: "ready",
      });
      if (error) {
        if (uploadedPaths.length) {
          await supabase.storage.from(BUCKET).remove(uploadedPaths);
        }
        toast.error(error.message);
        setBusy(false);
        return;
      }
      toast.success("Tersimpan di Siap Dikirim.");
      resetForm();
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(r: Row) {
    if (!(await confirmDialog({
      title: "Hapus item?",
      description: r.status === "sent" ? "Item riwayat akan dihapus permanen." : "Item siap kirim akan dihapus.",
      confirmText: "Hapus", destructive: true,
    }))) return;
    const all = Array.from(new Set([
      ...(r.photo_path ? [r.photo_path] : []),
      ...((r.photo_paths ?? []) as string[]),
    ]));
    if (all.length) {
      await supabase.storage.from(BUCKET).remove(all);
    }
    const { error } = await table().delete().eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success("Item dihapus.");
    await load();
  }

  async function onSendWA(r: Row) {
    if (!r.sold_at) {
      toast.error("Catat penjualan dulu (tombol Jual) sebelum mengirim ke pembeli.");
      return;
    }
    const lines = [r.title];
    if (r.location_url) lines.push(`📍 ${r.location_url}`);
    if (r.note) lines.push(r.note);
    if (r.sold_summary) { lines.push(""); lines.push("💰 Penjualan"); lines.push(r.sold_summary); }
    const text = lines.join("\n");

    const allPaths = Array.from(new Set([
      ...(r.photo_path ? [r.photo_path] : []),
      ...((r.photo_paths ?? []) as string[]),
    ]));
    const collected: File[] = [];
    for (const p of allPaths) {
      const url = thumbs[p];
      if (!url) continue;
      try {
        const res = await fetch(url);
        if (res.ok) {
          const blob = await res.blob();
          const name = p.split("/").pop() || "foto.jpg";
          collected.push(new File([blob], name, { type: blob.type || "image/jpeg" }));
        }
      } catch { /* ignore — lanjut foto berikutnya */ }
    }
    const files = collected.length ? collected : undefined;

    const result = await shareToWhatsApp({ text, files });
    notifyShareResult(result);
    if (result.status === "shared" || result.status === "fallback") {
      const summary = text.length > 140 ? `${text.slice(0, 140)}…` : text;
      const { error } = await table()
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          sent_channel: "wa",
          sent_to: "WhatsApp",
          sent_summary: summary,
        })
        .eq("id", r.id);
      if (error) toast.error(`Status gagal diperbarui: ${error.message}`);
      else await load();
    }
  }

  async function onUnsend(r: Row) {
    const { error } = await table().update({ status: "ready", sent_at: null }).eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success("Dikembalikan ke Siap Dikirim.");
    await load();
  }

  async function onSendChat(r: Row, conversationId: string, convTitle: string) {
    if (!r.sold_at) {
      toast.error("Catat penjualan dulu (tombol Jual) sebelum mengirim ke pembeli.");
      return;
    }
    setChatSendingId(r.id);
    const tid = toast.loading(`Mengirim ke ${convTitle}…`);
    try {
      const lines = [r.title];
      if (r.note) lines.push(r.note);
      if (r.sold_summary) { lines.push(""); lines.push("💰 Penjualan"); lines.push(r.sold_summary); }
      const caption = lines.join("\n");

      const allPaths = Array.from(new Set([
        ...(r.photo_path ? [r.photo_path] : []),
        ...((r.photo_paths ?? []) as string[]),
      ]));
      const shots: { id: string; file: File }[] = [];
      for (let i = 0; i < allPaths.length; i++) {
        const p = allPaths[i];
        const url = thumbs[p];
        if (!url) continue;
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const blob = await res.blob();
          const name = p.split("/").pop() || `foto-${i + 1}.jpg`;
          shots.push({ id: `${r.id}:${i}`, file: new File([blob], name, { type: blob.type || "image/jpeg" }) });
        } catch { /* skip */ }
      }

      const result = await shareToChat({
        conversationId,
        caption,
        locationUrl: r.location_url,
        shots,
        markIds: [r.id],
      });
      toast.dismiss(tid);
      if (result.status === "shared") {
        toast.success(`Terkirim ke ${convTitle} (${result.messageCount} pesan).`);
        const summary = caption.length > 140 ? `${caption.slice(0, 140)}…` : caption;
        const { error } = await table()
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            sent_channel: "chat",
            sent_to: convTitle,
            sent_summary: summary,
          })
          .eq("id", r.id);
        if (error) toast.error(`Status gagal diperbarui: ${error.message}`);
        else await load();
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

  const ready = rows.filter((r) => r.status === "ready");
  const sent = rows.filter((r) => r.status === "sent");

  return (
    <div className="space-y-4">
      {lightboxIdx !== null && previewUrls[lightboxIdx] && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Pratinjau foto ukuran penuh"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightboxIdx(null)}
          onWheel={(e) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); }}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setLightboxIdx(null); }}
            className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label="Tutup pratinjau"
          >
            <X className="h-5 w-5" />
          </button>
          <div
            className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" onClick={() => zoomBy(1 / 1.25)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10" aria-label="Perkecil"><ZoomOut className="h-4 w-4" /></button>
            <span className="min-w-[3rem] text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => zoomBy(1.25)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10" aria-label="Perbesar"><ZoomIn className="h-4 w-4" /></button>
            <button type="button" onClick={resetView} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10" aria-label="Reset zoom"><RotateCcw className="h-4 w-4" /></button>
          </div>
          {previewUrls.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); resetView(); setLightboxIdx((i) => i === null ? i : (i - 1 + previewUrls.length) % previewUrls.length); }}
                className="absolute left-3 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
                aria-label="Foto sebelumnya"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); resetView(); setLightboxIdx((i) => i === null ? i : (i + 1) % previewUrls.length); }}
                className="absolute right-3 bottom-1/2 grid h-10 w-10 translate-y-1/2 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
                aria-label="Foto berikutnya"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}
          <img
            src={previewUrls[lightboxIdx]}
            alt={`Pratinjau foto ${lightboxIdx + 1}`}
            draggable={false}
            className="max-h-[90vh] max-w-[92vw] touch-none select-none rounded-lg object-contain shadow-2xl"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transition: dragRef.current || pinchRef.current ? "none" : "transform 120ms ease-out",
              cursor: zoom > 1 ? (dragRef.current ? "grabbing" : "grab") : "zoom-in",
            }}
            onClick={(e) => {
              e.stopPropagation();
              const now = Date.now();
              if (now - lastTapRef.current < 300) {
                setZoom((z) => (z > 1 ? 1 : 2));
                setPan({ x: 0, y: 0 });
              }
              lastTapRef.current = now;
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (zoom <= 1) return;
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
            }}
            onPointerMove={(e) => {
              if (!dragRef.current) return;
              const d = dragRef.current;
              setPan(clampPan(zoom, { x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) }));
            }}
            onPointerUp={(e) => {
              if (dragRef.current) {
                try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
                dragRef.current = null;
              }
            }}
            onPointerCancel={() => { dragRef.current = null; }}
            onTouchStart={(e) => {
              if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                pinchRef.current = { dist: Math.hypot(dx, dy), zoom };
              }
            }}
            onTouchMove={(e) => {
              if (e.touches.length === 2 && pinchRef.current) {
                e.preventDefault();
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.hypot(dx, dy);
                const next = Math.max(1, Math.min(5, pinchRef.current.zoom * (dist / pinchRef.current.dist)));
                setZoom(next);
                if (next === 1) setPan({ x: 0, y: 0 });
              }
            }}
            onTouchEnd={(e) => { if (e.touches.length < 2) pinchRef.current = null; }}
          />
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
            {lightboxIdx + 1} / {previewUrls.length}
          </div>
        </div>
      )}
      {/* Form */}
      <div className="rounded-xl border bg-card p-3 shadow-sm space-y-3">
        <div className="text-sm font-semibold">Siapkan produk sendiri</div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground">Judul / nama produk</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Mis. Beras Pandan 5 kg"
            className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground">Foto produk</label>
            <div className="mt-1 flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                if (picked.length) setFiles((prev) => [...prev, ...picked]);
              }}
              className="block w-full text-xs file:mr-2 file:rounded-md file:border file:bg-muted file:px-2 file:py-1.5 file:text-xs"
            />
            </div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
              <Camera className="h-3 w-3" /> kamera HP <span>•</span> <ImageIcon className="h-3 w-3" /> galeri <span>•</span> bisa pilih beberapa foto
            </div>
            {previewUrls.length > 0 && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{previewUrls.length} foto dipilih</span>
                  <button
                    type="button"
                    onClick={() => {
                      setFiles([]);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                    className="inline-flex h-6 items-center gap-1 rounded-md border border-destructive/40 px-2 text-[11px] text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3 w-3" /> Hapus semua
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {previewUrls.map((url, idx) => (
                    <div key={url} className="relative">
                      <button
                        type="button"
                        onClick={() => setLightboxIdx(idx)}
                        className="block h-24 w-24 overflow-hidden rounded-md border focus:outline-none focus:ring-2 focus:ring-primary"
                        aria-label={`Lihat foto ${idx + 1} ukuran penuh`}
                      >
                        <img
                          src={url}
                          alt={`Pratinjau foto ${idx + 1}`}
                          className="h-full w-full object-cover transition-transform hover:scale-105"
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setFiles((prev) => prev.filter((_, i) => i !== idx));
                          if (fileRef.current) fileRef.current.value = "";
                        }}
                        className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full border border-destructive/50 bg-background text-destructive shadow hover:bg-destructive/10"
                        aria-label={`Hapus foto ${idx + 1}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                      {idx === 0 && (
                        <span className="absolute bottom-1 left-1 rounded bg-primary/90 px-1 text-[11px] font-semibold text-primary-foreground">
                          Utama
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="text-[11px] font-medium text-muted-foreground">Link lokasi (paste)</label>
            <div className="mt-1 flex items-center gap-1">
              <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                value={locationUrl}
                onChange={(e) => setLocationUrl(e.target.value)}
                placeholder="https://maps.app.goo.gl/…"
                className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm"
                inputMode="url"
              />
              <button
                type="button"
                onClick={async () => {
                  if (gpsBusy) return;
                  setGpsBusy(true);
                  try {
                    const loc = await getCurrentLocation();
                    const url = `https://www.google.com/maps?q=${loc.lat},${loc.lng}`;
                    setLocationUrl(url);
                    toast.success(`Lokasi diisi (±${Math.round(loc.accuracy ?? 0)} m)`);
                  } catch (e) {
                    const ge = toGeoError(e);
                    toast.error(ge.message || "Gagal mengambil GPS");
                  } finally {
                    setGpsBusy(false);
                  }
                }}
                disabled={gpsBusy}
                title="Ambil lokasi GPS saat ini"
                aria-label="Ambil lokasi GPS saat ini"
                className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-60"
              >
                {gpsBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crosshair className="h-3.5 w-3.5" />}
                <span>GPS</span>
              </button>
            </div>
            {locationUrl.trim() && (() => {
              const trimmed = locationUrl.trim();
              const coords = parseLatLngFromUrl(trimmed);
              const validUrl = isHttpsUrl(trimmed);
              if (coords) {
                const d = 0.005;
                const bbox = `${coords.lng - d},${coords.lat - d},${coords.lng + d},${coords.lat + d}`;
                const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${coords.lat},${coords.lng}`;
                return (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>Pratinjau lokasi</span>
                      <span className="tabular-nums">{coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}</span>
                    </div>
                    <div className="overflow-hidden rounded-md border">
                      <iframe
                        title="Pratinjau peta lokasi"
                        src={src}
                        className="h-40 w-full"
                        loading="lazy"
                      />
                    </div>
                    <a
                      href={validUrl ? trimmed : `https://www.openstreetmap.org/?mlat=${coords.lat}&mlon=${coords.lng}#map=16/${coords.lat}/${coords.lng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-primary underline"
                    >
                      <ExternalLink className="h-3 w-3" /> Buka di peta
                    </a>
                  </div>
                );
              }
              return (
                <div className="mt-2 rounded-md border border-dashed bg-muted/30 p-2 text-[11px] text-muted-foreground">
                  {validUrl
                    ? "Link tersimpan, tapi koordinat tidak terdeteksi otomatis. Pratinjau peta tidak tersedia — pastikan link Google Maps memuat koordinat (mis. /@lat,lng atau ?q=lat,lng)."
                    : "Tempel link Google Maps yang valid (https://) untuk melihat pratinjau peta."}
                </div>
              );
            })()}
            <label className="mt-2 block text-[11px] font-medium text-muted-foreground">Catatan (opsional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Catatan tambahan…"
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={resetForm}
            className="h-9 rounded-md border px-3 text-xs"
            disabled={busy}
          >Reset</button>
          <button
            type="button"
            onClick={onSave}
            disabled={busy || !title.trim()}
            className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Simpan
          </button>
        </div>
      </div>

      {/* Siap Dikirim */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">Siap Dikirim ({ready.length})</h2>
        {loading && rows.length === 0 ? (
          <div className="rounded-xl border bg-card p-4 text-center text-xs text-muted-foreground">Memuat…</div>
        ) : ready.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card p-4 text-center text-xs text-muted-foreground">
            Belum ada produk siap kirim. Isi form di atas dan klik Simpan.
          </div>
        ) : (
          <ul className="space-y-2">
            {ready.map((r) => (
              <li key={r.id} className="flex gap-3 rounded-xl border bg-card p-3 shadow-sm">
                {r.photo_path && thumbs[r.photo_path] ? (
                  <img src={thumbs[r.photo_path]} alt="" className="h-16 w-16 shrink-0 rounded-md border object-cover" />
                ) : (
                  <div className="grid h-16 w-16 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground">
                    <ImageIcon className="h-5 w-5" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{r.title}</div>
                  {r.location_url && (
                    <a href={r.location_url} target="_blank" rel="noreferrer"
                      className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-primary underline">
                      <MapPin className="h-3 w-3" /> Lihat lokasi <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {r.note && <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{r.note}</div>}
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Dibuat {new Date(r.created_at).toLocaleString("id-ID")}
                  </div>
                  {r.sold_at && (
                    <div className="mt-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-800 dark:text-emerald-200">
                      <div className="flex items-center gap-1 font-semibold">
                        {r.sold_payment_method === "kas" ? <Wallet className="h-3 w-3" /> : <HandCoins className="h-3 w-3" />}
                        {formatSoldPaymentSummary(
                          r.sold_payment_method,
                          Number(r.sold_total ?? 0),
                          Number(r.sold_paid_amount ?? 0),
                        )}
                      </div>
                      <div className="text-[10px] text-emerald-900/80 dark:text-emerald-100/80">
                        {new Date(r.sold_at).toLocaleString("id-ID")}
                      </div>
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {!r.sold_at ? (
                      <button
                        onClick={() => setSellTarget(r)}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-primary bg-primary px-2 text-[11px] font-semibold text-primary-foreground shadow-sm"
                      >
                        <Send className="h-3.5 w-3.5" /> Jual (catat penjualan)
                      </button>
                    ) : null}
                    <button
                      onClick={() => onSendWA(r)}
                      disabled={!r.sold_at}
                      title={r.sold_at ? "Kirim foto + rincian penjualan ke pembeli via WhatsApp" : "Catat penjualan dulu"}
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-[#25D366]/40 bg-[#25D366]/10 px-2 text-[11px] font-semibold text-[#1ea952] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Send className="h-3.5 w-3.5" /> Kirim WA
                    </button>
                    <button
                      onClick={() => setChatPickTarget(r)}
                      disabled={chatSendingId === r.id || !r.sold_at}
                      title={r.sold_at ? "Kirim ke MCM Chat" : "Catat penjualan dulu"}
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 text-[11px] font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label="Kirim ke MCM Chat"
                    >
                      {chatSendingId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />}
                      Kirim MCM
                    </button>
                    <button
                      onClick={() => onRemove(r)}
                      className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-[11px] text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Hapus
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Riwayat Terkirim */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">Riwayat Terkirim ({sent.length})</h2>
        {sent.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card p-4 text-center text-xs text-muted-foreground">
            Belum ada riwayat kiriman.
          </div>
        ) : (
          <ul className="space-y-2">
            {sent.map((r) => (
              <li key={r.id} className="flex gap-3 rounded-xl border bg-card p-3 shadow-sm opacity-90">
                {r.photo_path && thumbs[r.photo_path] ? (
                  <img src={thumbs[r.photo_path]} alt="" className="h-14 w-14 shrink-0 rounded-md border object-cover" />
                ) : (
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground">
                    <ImageIcon className="h-5 w-5" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{r.title}</div>
                  <div className="text-[11px] text-muted-foreground">
                    Dikirim {r.sent_at ? new Date(r.sent_at).toLocaleString("id-ID") : "—"}
                  </div>
                  {r.sent_channel && (
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
                      <span
                        className={
                          "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-semibold " +
                          (r.sent_channel === "chat"
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-[#25D366]/40 bg-[#25D366]/10 text-[#1ea952]")
                        }
                      >
                        {r.sent_channel === "chat" ? (
                          <><MessageCircle className="h-3 w-3" /> MCM Chat</>
                        ) : (
                          <><Send className="h-3 w-3" /> WhatsApp</>
                        )}
                      </span>
                      {r.sent_to && (
                        <span className="truncate text-muted-foreground" title={r.sent_to}>
                          → {r.sent_to}
                        </span>
                      )}
                    </div>
                  )}
                  {r.sent_summary && (
                    <div className="mt-1 line-clamp-2 whitespace-pre-wrap rounded-md border border-dashed bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground" title={r.sent_summary}>
                      {r.sent_summary}
                    </div>
                  )}
                  {r.location_url && (
                    <a href={r.location_url} target="_blank" rel="noreferrer"
                      className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-primary underline">
                      <MapPin className="h-3 w-3" /> Lokasi
                    </a>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={() => onUnsend(r)}
                      className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-[11px]"
                    >↩ Tandai belum terkirim</button>
                    <button
                      onClick={() => onRemove(r)}
                      className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-[11px] text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Hapus
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PickChatConversationDialog
        open={!!chatPickTarget}
        onOpenChange={(v) => { if (!v) setChatPickTarget(null); }}
        title="Kirim ke MCM Chat"
        onPick={(conversationId, displayTitle) => {
          const target = chatPickTarget;
          setChatPickTarget(null);
          if (target) void onSendChat(target, conversationId, displayTitle);
        }}
      />

      {sellTarget && uid && (
        <SellSelfPrepDialog
          open={!!sellTarget}
          onClose={() => setSellTarget(null)}
          uid={uid}
          selfPrepId={sellTarget.id}
          selfPrepTitle={sellTarget.title}
          customers={customers}
          warehouseItems={warehouseItems}
          onSold={() => {
            setSellTarget(null);
            void load();
          }}
        />
      )}
    </div>
  );
}