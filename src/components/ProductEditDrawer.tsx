import { useEffect, useState } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from "@/components/ui/drawer";
import { toast } from "sonner";
import { friendlyError } from "@/lib/friendly-error";

export type Satuan = "gram" | "kg" | "botol" | "sachet" | "pcs" | "lusin" | "pak" | "dus";

type Status = "Belum Dikirim" | "Sudah Dikirim";

export type Produk = {
  id: number;
  kategori: string;
  nama: string;
  harga: number;
  status: Status;
  keterangan: string;
  lokasi: string;
  satuan?: Satuan;
  jumlah?: number;
  foto?: string;
  galeri?: string[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  produk: Produk | null;
  categories: string[];
  satuanList: Satuan[];
  satuanBounds: (s: Satuan) => { min: number; max: number; step: number };
  formatJumlah: (n: number, s: Satuan) => string;
  rupiah: (n: number) => string;
  update: (id: number, patch: Partial<Produk>) => void;
  setFoto: (id: number, files: FileList | null) => void | Promise<void>;
  addGaleri: (id: number, files: FileList | null) => void | Promise<void>;
  removeFoto: (id: number) => void;
  removeGaleri: (id: number, idx: number) => void;
  removeItem: (id: number) => void;
  markSent: (id: number) => void;
  buildPesan: (p: Produk) => string;
};

export function ProductEditDrawer(props: Props) {
  const {
    open, onOpenChange, produk, categories, satuanList, satuanBounds, formatJumlah, rupiah,
    update, setFoto, addGaleri, removeFoto, removeGaleri, removeItem, markSent, buildPesan,
  } = props;

  // Local draft so user can review then save explicitly
  const [draft, setDraft] = useState<Produk | null>(produk);
  useEffect(() => { setDraft(produk); }, [produk]);

  if (!produk || !draft) return null;

  const sent = draft.status === "Sudah Dikirim";
  const s = (draft.satuan ?? "pcs") as Satuan;
  const b = satuanBounds(s);
  const waUrl = `https://wa.me/?text=${encodeURIComponent(buildPesan(draft))}`;

  const patch = (p: Partial<Produk>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const save = () => {
    if (!draft.nama.trim()) {
      toast.error("Nama produk wajib diisi");
      return;
    }
    update(draft.id, {
      kategori: draft.kategori,
      nama: draft.nama.trim(),
      harga: Math.max(0, draft.harga || 0),
      satuan: draft.satuan,
      jumlah: draft.jumlah,
      keterangan: draft.keterangan,
      lokasi: draft.lokasi,
    });
    toast.success("Perubahan disimpan");
    onOpenChange(false);
  };

  const ambilLokasi = () => {
    if (!navigator.geolocation) { toast.error("Geolocation tidak tersedia"); return; }
    const tId = toast.loading("Mengambil lokasi…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        patch({ lokasi: `https://www.google.com/maps?q=${latitude},${longitude}` });
        toast.success("Lokasi diperbarui", { id: tId });
      },
      (err) => toast.error("Gagal: " + friendlyError(err), { id: tId }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92vh]">
        <DrawerHeader className="border-b text-left">
          <DrawerTitle className="truncate text-base">Edit produk</DrawerTitle>
          <DrawerDescription className="text-[11px]">
            {sent ? "Status: Sudah dikirim" : "Status: Belum dikirim"} · {rupiah(draft.harga)}
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-sm">
          {/* Foto */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Foto</h3>
            <div className="flex flex-wrap items-start gap-2">
              {draft.foto && (
                <div className="relative">
                  <img src={draft.foto} alt="" className="h-20 w-20 rounded-md border object-cover" />
                  <button
                    onClick={() => { removeFoto(draft.id); patch({ foto: undefined }); }}
                    aria-label="Hapus foto utama"
                    className="absolute -right-1.5 -top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full border bg-background text-xs shadow"
                  >×</button>
                </div>
              )}
              {(draft.galeri ?? []).map((src, idx) => (
                <div key={idx} className="relative">
                  <img src={src} alt="" className="h-20 w-20 rounded-md border object-cover" />
                  <button
                    onClick={() => {
                      removeGaleri(draft.id, idx);
                      patch({ galeri: (draft.galeri ?? []).filter((_, i) => i !== idx) });
                    }}
                    aria-label="Hapus foto galeri"
                    className="absolute -right-1.5 -top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full border bg-background text-xs shadow"
                  >×</button>
                </div>
              ))}
              <label className="inline-flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed text-[11px] hover:bg-accent">
                📷
                <span>{draft.foto ? "Ganti" : "Foto"}</span>
                <input type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={(e) => setFoto(draft.id, e.target.files)} />
              </label>
              <label className="inline-flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed text-[11px] hover:bg-accent">
                🖼️
                <span>Galeri</span>
                <input type="file" accept="image/*" multiple className="hidden"
                  onChange={(e) => addGaleri(draft.id, e.target.files)} />
              </label>
            </div>
          </section>

          {/* Identitas */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Info produk</h3>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Nama</span>
              <input
                value={draft.nama}
                onChange={(e) => patch({ nama: e.target.value })}
                placeholder="Nama produk"
                className="mt-1 h-11 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Kategori</span>
              <select
                value={draft.kategori}
                onChange={(e) => patch({ kategori: e.target.value })}
                className="mt-1 h-11 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {categories.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
          </section>

          {/* Harga */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Harga</h3>
            <label className="flex h-11 items-center gap-2 rounded-md border bg-background px-3 text-sm">
              <span className="text-muted-foreground">Rp</span>
              <input
                type="number" inputMode="numeric" min={0}
                value={draft.harga}
                onChange={(e) => patch({ harga: Math.max(0, Number(e.target.value) || 0) })}
                className="w-full bg-transparent tabular-nums outline-none"
                placeholder="0"
              />
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{rupiah(draft.harga)}</span>
            </label>
          </section>

          {/* Satuan & Jumlah */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Satuan & jumlah</h3>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Satuan</span>
                <select
                  value={s}
                  onChange={(e) => {
                    const next = e.target.value as Satuan;
                    const nb = satuanBounds(next);
                    const cur = draft.jumlah ?? 1;
                    patch({ satuan: next, jumlah: Math.min(nb.max, Math.max(nb.min, cur)) });
                  }}
                  className="mt-1 h-11 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  {satuanList.map((sv) => <option key={sv} value={sv}>{sv}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Jumlah</span>
                <input
                  type="number" inputMode="decimal"
                  min={b.min} max={b.max} step={b.step}
                  value={draft.jumlah ?? b.min}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    if (!Number.isFinite(raw)) return;
                    patch({ jumlah: Math.min(b.max, Math.max(b.min, raw)) });
                  }}
                  className="mt-1 h-11 w-full rounded-md border bg-background px-3 text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {formatJumlah(draft.jumlah ?? b.min, s)} · Gram: 0.01–5000 · Kg: 0.001–5
            </p>
          </section>

          {/* Keterangan */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Keterangan</h3>
            <textarea
              value={draft.keterangan}
              onChange={(e) => patch({ keterangan: e.target.value })}
              placeholder="Catatan untuk pelanggan…"
              rows={3}
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </section>

          {/* Lokasi */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Lokasi</h3>
            <input
              value={draft.lokasi}
              onChange={(e) => patch({ lokasi: e.target.value })}
              placeholder="Link lokasi (Google Maps)"
              className="h-11 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="grid grid-cols-2 gap-2">
              <button onClick={ambilLokasi} className="h-10 rounded-md border text-[12px] font-medium hover:bg-accent">
                📍 Ambil sekarang
              </button>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(draft.lokasi)
                    .then(() => toast.success("Link disalin"))
                    .catch(() => toast.error("Gagal menyalin"));
                }}
                className="h-10 rounded-md border text-[12px] font-medium hover:bg-accent"
              >
                🔗 Salin link
              </button>
              {draft.lokasi && (
                <a href={draft.lokasi} target="_blank" rel="noreferrer"
                  className="col-span-2 inline-flex h-10 items-center justify-center rounded-md border text-[12px] font-medium hover:bg-accent">
                  🗺️ Buka peta
                </a>
              )}
            </div>
          </section>

          {/* Status */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Status pengiriman</h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { update(draft.id, { status: "Belum Dikirim" }); patch({ status: "Belum Dikirim" }); }}
                className={`h-10 rounded-md border text-[12px] font-medium ${!sent ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              >
                📦 Belum
              </button>
              <button
                onClick={() => { markSent(draft.id); patch({ status: "Sudah Dikirim" }); }}
                className={`h-10 rounded-md border text-[12px] font-medium ${sent ? "border-[#128C7E] bg-[#25D366] text-white" : "hover:bg-accent"}`}
              >
                ✓ Terkirim
              </button>
            </div>
          </section>

          {/* Hapus */}
          <section className="pt-2">
            <button
              onClick={() => {
                if (confirm(`Hapus produk "${draft.nama || "tanpa nama"}"?`)) {
                  removeItem(draft.id);
                  onOpenChange(false);
                }
              }}
              className="inline-flex h-10 w-full items-center justify-center rounded-md border border-destructive/40 text-[12px] font-semibold text-destructive hover:bg-destructive/10"
            >
              🗑 Hapus produk
            </button>
          </section>
        </div>

        <DrawerFooter className="sticky bottom-0 grid grid-cols-[auto_1fr] gap-2 border-t bg-card/95 pt-3 backdrop-blur">
          <a
            href={waUrl} target="_blank" rel="noreferrer"
            className="inline-flex h-11 items-center justify-center rounded-md bg-[#25D366] px-3 text-[13px] font-semibold text-white hover:opacity-90"
          >
            💬 WA
          </a>
          <button
            onClick={save}
            className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            💾 Simpan
          </button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}