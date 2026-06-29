import { useState } from "react";
import { Plus, Image as ImageIcon, Camera, Film, Paperclip, MapPin, UserRound, Package, Loader2, Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
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

type Props = {
  conversationId: string;
  disabled?: boolean;
  onSent?: () => void;
};

export function AttachMenu({ conversationId, disabled, onSent }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [openLoc, setOpenLoc] = useState(false);
  const [openContact, setOpenContact] = useState(false);
  const [openProduct, setOpenProduct] = useState(false);

  async function handleUpload(file: File | null) {
    if (!file) return;
    setBusy("upload");
    try {
      const up = await uploadChatFile({ conversationId, file });
      await sendMessage({
        data: {
          conversationId,
          attachmentPath: up.path,
          attachmentMime: up.mime,
          attachmentName: up.name,
          attachmentSize: up.size,
        },
      });
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" disabled={disabled || !!busy} aria-label="Lampirkan">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-5 w-5" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-56">
          <DropdownMenuLabel className="text-[10px] uppercase">Media</DropdownMenuLabel>
          <DropdownMenuItem onSelect={async () => handleUpload(await pickViaInput({ accept: "image/*" }))}>
            <ImageIcon className="mr-2 h-4 w-4" /> Foto dari galeri
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={async () => handleUpload(await pickFromCamera())}>
            <Camera className="mr-2 h-4 w-4" /> Ambil foto (kamera)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={async () => handleUpload(await pickViaInput({ accept: "video/*" }))}>
            <Film className="mr-2 h-4 w-4" /> Video
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={async () => handleUpload(await pickViaInput({ accept: "*/*" }))}>
            <Paperclip className="mr-2 h-4 w-4" /> Berkas (PDF, dll.)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[10px] uppercase">Bagikan</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => setOpenLoc(true)}>
            <MapPin className="mr-2 h-4 w-4" /> Lokasi / Live location
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpenContact(true)}>
            <UserRound className="mr-2 h-4 w-4" /> Kontak
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpenProduct(true)}>
            <Package className="mr-2 h-4 w-4" /> Produk
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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