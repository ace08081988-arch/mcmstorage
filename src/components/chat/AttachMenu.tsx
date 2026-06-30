import { useEffect, useState } from "react";
import { Plus, Image as ImageIcon, Camera, Film, Paperclip, MapPin, UserRound, Package, Loader2, Navigation, Sticker, X, Send, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import {
  pickFromCamera, pickViaInput, uploadChatFile,
} from "@/lib/chat-attachments";
import { encodeCard } from "@/lib/chat-cards";
import { getCurrentLocation, toGeoError } from "@/lib/get-location";
import { sendMessage } from "@/lib/chat.functions";
import { StickerPickerDialog } from "@/components/chat/StickerPickerDialog";
import type { LucideIcon } from "lucide-react";

function Tile({ icon: Icon, label, color, onClick }: { icon: LucideIcon; label: string; color: string; onClick: () => void | Promise<void> }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1.5 rounded-xl p-2 text-center transition hover:bg-accent active:scale-95">
      <span className={`flex h-12 w-12 items-center justify-center rounded-full ${color}`}>
        <Icon className="h-6 w-6" />
      </span>
      <span className="text-[11px] font-medium text-foreground">{label}</span>
    </button>
  );
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
  const [pending, setPending] = useState<{ file: File; previewUrl: string | null; caption: string } | null>(null);

  // Bersihkan object URL saat pratinjau ditutup / ganti.
  useEffect(() => {
    return () => { if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl); };
  }, [pending?.previewUrl]);

  /** Setelah file dipilih, JANGAN langsung kirim — buka pratinjau dulu. */
  function stageFile(file: File | null) {
    if (!file) return;
    setOpenSheet(false);
    const isPreviewable = file.type.startsWith("image/") || file.type.startsWith("video/");
    setPending({
      file,
      previewUrl: isPreviewable ? URL.createObjectURL(file) : null,
      caption: "",
    });
  }

  async function confirmSendPending() {
    if (!pending) return;
    setBusy("upload");
    try {
      const up = await uploadChatFile({ conversationId, file: pending.file });
      const caption = pending.caption.trim();
      await sendMessage({
        data: {
          conversationId,
          attachmentPath: up.path,
          attachmentMime: up.mime,
          attachmentName: up.name,
          attachmentSize: up.size,
          ...(caption ? { body: caption } : {}),
        },
      });
      setPending(null);
      onSent?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengirim lampiran");
    } finally {
      setBusy(null);
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
        <SheetTrigger asChild>
          <Button type="button" variant="ghost" size="icon" disabled={disabled || !!busy} aria-label="Lampirkan">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-5 w-5" />}
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="rounded-t-2xl pb-8">
          <SheetHeader className="pb-2">
            <SheetTitle className="text-base">Lampirkan</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-4 gap-3 pt-2">
            <Tile color="bg-violet-500/15 text-violet-500" icon={Paperclip} label="Dokumen"
              onClick={async () => stageFile(await pickViaInput({ accept: "*/*" }))} />
            <Tile color="bg-fuchsia-500/15 text-fuchsia-500" icon={ImageIcon} label="Galeri"
              onClick={async () => stageFile(await pickViaInput({ accept: "image/*" }))} />
            <Tile color="bg-sky-500/15 text-sky-500" icon={Camera} label="Kamera"
              onClick={async () => stageFile(await pickFromCamera())} />
            <Tile color="bg-rose-500/15 text-rose-500" icon={Film} label="Video"
              onClick={async () => stageFile(await pickViaInput({ accept: "video/*" }))} />
            <Tile color="bg-emerald-500/15 text-emerald-500" icon={MapPin} label="Lokasi"
              onClick={() => { setOpenSheet(false); setOpenLoc(true); }} />
            <Tile color="bg-blue-500/15 text-blue-500" icon={UserRound} label="Kontak"
              onClick={() => { setOpenSheet(false); setOpenContact(true); }} />
            <Tile color="bg-amber-500/15 text-amber-500" icon={Package} label="Produk"
              onClick={() => { setOpenSheet(false); setOpenProduct(true); }} />
            <Tile color="bg-pink-500/15 text-pink-500" icon={Sticker} label="Stiker"
              onClick={() => { setOpenSheet(false); setOpenSticker(true); }} />
          </div>
          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            Stiker: panah, no. rekening, teks, AI · Lokasi mendukung live · Produk = kartu siap kirim
          </p>
        </SheetContent>
      </Sheet>

      <Dialog open={!!pending} onOpenChange={(v) => { if (!v && !busy) setPending(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pratinjau lampiran</DialogTitle>
          </DialogHeader>
          {pending ? (
            <div className="space-y-3">
              <div className="flex items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
                {pending.previewUrl && pending.file.type.startsWith("image/") ? (
                  <img src={pending.previewUrl} alt={pending.file.name} className="max-h-72 w-full object-contain" />
                ) : pending.previewUrl && pending.file.type.startsWith("video/") ? (
                  <video src={pending.previewUrl} controls className="max-h-72 w-full" />
                ) : (
                  <div className="flex w-full items-center gap-3 p-4 text-left">
                    <FileText className="h-10 w-10 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{pending.file.name}</div>
                      <div className="text-[11px] text-muted-foreground">{formatBytes(pending.file.size)} · {pending.file.type || "berkas"}</div>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="truncate">{pending.file.name}</span>
                <span>{formatBytes(pending.file.size)}</span>
              </div>
              <div>
                <Label className="text-[11px] uppercase text-muted-foreground">Caption (opsional)</Label>
                <Textarea rows={2} maxLength={1000} placeholder="Tulis caption…"
                  value={pending.caption}
                  onChange={(e) => setPending((p) => p ? { ...p, caption: e.target.value } : p)} />
              </div>
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setPending(null)} disabled={!!busy}>
              <X className="mr-1 h-4 w-4" /> Batal
            </Button>
            <Button onClick={confirmSendPending} disabled={!!busy}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
              Kirim
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