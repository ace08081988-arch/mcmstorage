import { useEffect, useRef, useState } from "react";
import { Plus, Image as ImageIcon, Camera, Film, Paperclip, MapPin, UserRound, Package, Loader2, Navigation, Sticker, X, Send, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import {
  pickFromCamera, pickViaInput, pickMultipleViaInput, uploadChatFile,
} from "@/lib/chat-attachments";
import { encodeCard } from "@/lib/chat-cards";
import { getCurrentLocation, toGeoError } from "@/lib/get-location";
import { sendMessage } from "@/lib/chat.functions";
import { StickerPickerDialog } from "@/components/chat/StickerPickerDialog";
import type { LucideIcon } from "lucide-react";

function Tile({ icon: Icon, label, color, onClick, recent }: { icon: LucideIcon; label: string; color: string; onClick: () => void | Promise<void>; recent?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`relative flex flex-col items-center gap-1.5 rounded-xl p-2 text-center transition hover:bg-accent active:scale-95 ${recent ? "ring-2 ring-primary/60" : ""}`}>
      <span className={`flex h-12 w-12 items-center justify-center rounded-full ${color}`}>
        <Icon className="h-6 w-6" />
      </span>
      <span className="text-[11px] font-medium text-foreground">{label}</span>
      {recent ? (
        <span className="absolute -top-1 right-0 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-semibold leading-none text-primary-foreground">
          Terakhir
        </span>
      ) : null}
    </button>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  conversationId: string;
  disabled?: boolean;
  onSent?: () => void;
};

export function AttachMenu({ conversationId, disabled, onSent }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [openSheet, setOpenSheet] = useState(false);
  const [openLoc, setOpenLoc] = useState(false);
  const [openContact, setOpenContact] = useState(false);
  const [openProduct, setOpenProduct] = useState(false);
  const [openSticker, setOpenSticker] = useState(false);
  type TileId = "doc" | "gallery" | "camera" | "video" | "location" | "contact" | "product" | "sticker";
  const LAST_KEY = "chat:lastAttachTile";
  const [lastTile, setLastTile] = useState<TileId | null>(() => {
    try {
      const v = localStorage.getItem(LAST_KEY);
      return v && ["doc","gallery","camera","video","location","contact","product","sticker"].includes(v) ? (v as TileId) : null;
    } catch { return null; }
  });
  const persistLast = (id: TileId) => {
    setLastTile(id);
    try { localStorage.setItem(LAST_KEY, id); } catch { /* ignore */ }
  };
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressedRef = useRef(false);
  type PendingItem = { file: File; previewUrl: string | null };
  const [pending, setPending] = useState<PendingItem[] | null>(null);
  const [caption, setCaption] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function runTile(id: TileId) {
    persistLast(id);
    setOpenSheet(false);
    switch (id) {
      case "doc":     return stageFiles(await pickMultipleViaInput({ accept: "*/*" }));
      case "gallery": return stageFiles(await pickMultipleViaInput({ accept: "image/*" }));
      case "camera":  return stageFiles(await pickFromCamera());
      case "video":   return stageFiles(await pickMultipleViaInput({ accept: "video/*" }));
      case "location": setOpenLoc(true); return;
      case "contact":  setOpenContact(true); return;
      case "product":  setOpenProduct(true); return;
      case "sticker":  setOpenSticker(true); return;
    }
  }

  function handlePlusPointerDown() {
    longPressedRef.current = false;
    longPressRef.current = setTimeout(() => {
      longPressedRef.current = true;
      setOpenSheet(true);
    }, 450);
  }
  function clearLongPress() {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
  }
  function handlePlusClick() {
    clearLongPress();
    if (longPressedRef.current) return; // sheet already opened
    if (lastTile) { void runTile(lastTile); } else { setOpenSheet(true); }
  }

  // Bersihkan object URL saat pratinjau ditutup / ganti.
  useEffect(() => {
    return () => { pending?.forEach((p) => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); }); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  function stageFiles(files: File[] | File | null) {
    const arr = Array.isArray(files) ? files : files ? [files] : [];
    if (arr.length === 0) return;
    setOpenSheet(false);
    setCaption("");
    setPending(arr.map((f) => ({
      file: f,
      previewUrl: (f.type.startsWith("image/") || f.type.startsWith("video/")) ? URL.createObjectURL(f) : null,
    })));
  }

  function removePendingAt(idx: number) {
    setPending((prev) => {
      if (!prev) return prev;
      const removed = prev[idx];
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      const next = prev.filter((_, i) => i !== idx);
      return next.length ? next : null;
    });
  }

  async function confirmSendPending() {
    if (!pending || pending.length === 0) return;
    setBusy("upload");
    setProgress({ done: 0, total: pending.length });
    const cap = caption.trim();
    try {
      for (let i = 0; i < pending.length; i++) {
        const item = pending[i];
        const up = await uploadChatFile({ conversationId, file: item.file });
        await sendMessage({
          data: {
            conversationId,
            attachmentPath: up.path,
            attachmentMime: up.mime,
            attachmentName: up.name,
            attachmentSize: up.size,
            // Caption hanya pada lampiran pertama agar tidak duplikat
            ...(i === 0 && cap ? { body: cap } : {}),
          },
        });
        setProgress({ done: i + 1, total: pending.length });
      }
      setPending(null);
      setCaption("");
      onSent?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengirim lampiran");
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function shareLocationNow(durationMin?: number) {
    setBusy("loc");
    try {
      const loc = await getCurrentLocation();
      const card = encodeCard({
        type: "location",
        lat: loc.lat,
        lng: loc.lng,
        accuracy: loc.accuracy,
        ...(durationMin ? { live_until: new Date(Date.now() + durationMin * 60_000).toISOString() } : {}),
      });
      await sendMessage({ data: { conversationId, body: card } });
      setOpenLoc(false);
      setOpenSheet(false);
      onSent?.();
    } catch (e) {
      const ge = toGeoError(e);
      toast.error(ge.message, { description: ge.hint });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Sheet open={openSheet} onOpenChange={(v) => !busy && setOpenSheet(v)}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled || !!busy}
          aria-label={lastTile ? `Lampirkan (terakhir: ${lastTile}) — tahan untuk pilih lain` : "Lampirkan"}
          onClick={handlePlusClick}
          onPointerDown={handlePlusPointerDown}
          onPointerUp={clearLongPress}
          onPointerLeave={clearLongPress}
          onPointerCancel={clearLongPress}
          onContextMenu={(e) => e.preventDefault()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-5 w-5" />}
        </Button>
        <SheetContent side="bottom" className="rounded-t-2xl pb-8">
          <SheetHeader className="pb-2">
            <SheetTitle className="text-base">Lampirkan</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-4 gap-3 pt-2">
            <Tile recent={lastTile === "doc"} color="bg-violet-500/15 text-violet-500" icon={Paperclip} label="Dokumen" onClick={() => runTile("doc")} />
            <Tile recent={lastTile === "gallery"} color="bg-fuchsia-500/15 text-fuchsia-500" icon={ImageIcon} label="Galeri" onClick={() => runTile("gallery")} />
            <Tile recent={lastTile === "camera"} color="bg-sky-500/15 text-sky-500" icon={Camera} label="Kamera" onClick={() => runTile("camera")} />
            <Tile recent={lastTile === "video"} color="bg-rose-500/15 text-rose-500" icon={Film} label="Video" onClick={() => runTile("video")} />
            <Tile recent={lastTile === "location"} color="bg-emerald-500/15 text-emerald-500" icon={MapPin} label="Lokasi" onClick={() => runTile("location")} />
            <Tile recent={lastTile === "contact"} color="bg-blue-500/15 text-blue-500" icon={UserRound} label="Kontak" onClick={() => runTile("contact")} />
            <Tile recent={lastTile === "product"} color="bg-amber-500/15 text-amber-500" icon={Package} label="Produk" onClick={() => runTile("product")} />
            <Tile recent={lastTile === "sticker"} color="bg-pink-500/15 text-pink-500" icon={Sticker} label="Stiker" onClick={() => runTile("sticker")} />
          </div>
          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            Tap "+" → opsi terakhir. Tahan "+" untuk menu ini. "Terakhir" = pilihan tersimpan.
          </p>
        </SheetContent>
      </Sheet>

      <Dialog open={!!pending} onOpenChange={(v) => { if (!v && !busy) setPending(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Pratinjau lampiran{pending && pending.length > 1 ? ` · ${pending.length} berkas` : ""}
            </DialogTitle>
          </DialogHeader>
          {pending && pending.length > 0 ? (
            <div className="space-y-3">
              <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto">
                {pending.map((p, i) => (
                  <div key={i} className="relative aspect-square overflow-hidden rounded-lg border bg-muted/30">
                    {p.previewUrl && p.file.type.startsWith("image/") ? (
                      <img src={p.previewUrl} alt={p.file.name} className="h-full w-full object-cover" />
                    ) : p.previewUrl && p.file.type.startsWith("video/") ? (
                      <video src={p.previewUrl} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center p-2 text-center">
                        <FileText className="h-8 w-8 text-muted-foreground" />
                        <div className="mt-1 line-clamp-2 text-[10px] font-medium">{p.file.name}</div>
                        <div className="text-[10px] text-muted-foreground">{formatBytes(p.file.size)}</div>
                      </div>
                    )}
                    {pending.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removePendingAt(i)}
                        disabled={!!busy}
                        aria-label={`Hapus ${p.file.name}`}
                        className="absolute right-1 top-1 rounded-full bg-background/80 p-1 shadow hover:bg-background disabled:opacity-50"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    ) : null}
                    <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 text-[10px] text-white">
                      {p.file.name}
                    </div>
                  </div>
                ))}
              </div>
              <div>
                <Label className="text-[11px] uppercase text-muted-foreground">
                  Caption {pending.length > 1 ? "(berlaku pada berkas pertama)" : "(opsional)"}
                </Label>
                <Textarea rows={2} maxLength={1000} placeholder="Tulis caption…"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)} />
              </div>
              {progress ? (
                <div className="text-[11px] text-muted-foreground">
                  Mengirim {progress.done}/{progress.total}…
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setPending(null)} disabled={!!busy}>
              <X className="mr-1 h-4 w-4" /> Batal
            </Button>
            <Button onClick={confirmSendPending} disabled={!!busy}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
              Kirim{pending && pending.length > 1 ? ` (${pending.length})` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openLoc} onOpenChange={(v) => !busy && setOpenLoc(v)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Bagikan lokasi</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <Button className="w-full justify-start" variant="outline" onClick={() => shareLocationNow()} disabled={!!busy}>
              <MapPin className="mr-2 h-4 w-4" /> Lokasi sekarang (sekali kirim)
            </Button>
            <Button className="w-full justify-start" variant="outline" onClick={() => shareLocationNow(15)} disabled={!!busy}>
              <Navigation className="mr-2 h-4 w-4" /> Live location · 15 menit
            </Button>
            <Button className="w-full justify-start" variant="outline" onClick={() => shareLocationNow(60)} disabled={!!busy}>
              <Navigation className="mr-2 h-4 w-4" /> Live location · 1 jam
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Live location dipasang sebagai label; posisinya tetap pada saat dikirim (tidak diperbarui otomatis di backend).
              Kirim ulang jika ingin update posisi.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <ContactDialog
        conversationId={conversationId}
        open={openContact}
        onOpenChange={setOpenContact}
        onSent={() => { onSent?.(); setOpenContact(false); }}
      />
      <ProductDialog
        conversationId={conversationId}
        open={openProduct}
        onOpenChange={setOpenProduct}
        onSent={() => { onSent?.(); setOpenProduct(false); }}
      />
      <StickerPickerDialog
        conversationId={conversationId}
        open={openSticker}
        onOpenChange={setOpenSticker}
        onSent={() => { onSent?.(); setOpenSticker(false); }}
      />
    </>
  );
}

function ContactDialog({ conversationId, open, onOpenChange, onSent }: { conversationId: string; open: boolean; onOpenChange: (v: boolean) => void; onSent: () => void; }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const staff = useQuery({
    queryKey: ["chat-attach", "staff"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.from("staff_contacts").select("id,name,wa_phone").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  async function submit() {
    if (!name.trim() || !phone.trim()) { toast.error("Nama & nomor wajib diisi"); return; }
    setBusy(true);
    try {
      await sendMessage({ data: { conversationId, body: encodeCard({ type: "contact", name: name.trim(), phone: phone.trim(), note: note.trim() || undefined }) } });
      setName(""); setPhone(""); setNote("");
      onSent();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengirim kontak");
    } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Kirim kontak</DialogTitle></DialogHeader>
        {staff.data && staff.data.length > 0 ? (
          <div className="space-y-1">
            <Label className="text-[11px] uppercase text-muted-foreground">Dari daftar pegawai</Label>
            <div className="max-h-32 space-y-1 overflow-y-auto rounded border p-1">
              {staff.data.map((s) => (
                <button key={s.id} type="button" className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-accent"
                  onClick={() => { setName(s.name); setPhone(s.wa_phone); }}>
                  <span className="truncate">{s.name}</span>
                  <span className="text-muted-foreground">{s.wa_phone}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="space-y-2">
          <div><Label>Nama</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Nomor WhatsApp</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="62812..." /></div>
          <div><Label>Catatan (opsional)</Label><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Batal</Button>
          <Button onClick={submit} disabled={busy}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Kirim</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProductDialog({ conversationId, open, onOpenChange, onSent }: { conversationId: string; open: boolean; onOpenChange: (v: boolean) => void; onSent: () => void; }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const items = useQuery({
    queryKey: ["chat-attach", "warehouse-items", q],
    enabled: open,
    queryFn: async () => {
      let qb = supabase.from("warehouse_items").select("id,name,category,package_type,package_size").order("name").limit(40);
      const term = q.trim();
      if (term) qb = qb.ilike("name", `%${term}%`);
      const { data, error } = await qb;
      if (error) throw error;
      return data ?? [];
    },
  });
  async function send(it: { id: string; name: string; category: string | null; package_type: string; package_size: number }) {
    setBusy(true);
    try {
      const pkg = `${it.package_size} ${it.package_type}`;
      await sendMessage({ data: { conversationId, body: encodeCard({ type: "product", id: it.id, name: it.name, package: pkg, category: it.category, href: "/ecer" }) } });
      onSent();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengirim produk");
    } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Kirim tautan produk</DialogTitle></DialogHeader>
        <Input placeholder="Cari nama produk…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {items.isLoading ? <div className="p-2 text-center text-xs text-muted-foreground">Memuat…</div> : null}
          {items.data?.length === 0 ? <div className="p-2 text-center text-xs text-muted-foreground">Tidak ditemukan.</div> : null}
          {(items.data ?? []).map((it) => (
            <button key={it.id} type="button" className="flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50"
              disabled={busy}
              onClick={() => send(it as { id: string; name: string; category: string | null; package_type: string; package_size: number })}>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{it.name}</span>
                {it.category ? <span className="ml-1 text-muted-foreground">· {it.category}</span> : null}
              </span>
              <span className="shrink-0 text-muted-foreground">{it.package_size} {it.package_type}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}