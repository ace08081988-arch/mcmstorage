import { useEffect, useMemo, useState } from "react";
import { Package, Loader2, MapPin, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { fmtBase } from "@/lib/stock-format";
import { urlToFile } from "@/lib/share-wa";
import { shareToChat } from "@/lib/share-chat";
import { friendlyError } from "@/lib/friendly-error";

/**
 * Popover di sebelah tombol "Kirim" pada composer chat.
 * Menampilkan daftar paket **siap dikirim** (`ready_packages.status='ready'`)
 * dari gudang beserta nama produk + jumlah tersedia + varian (note).
 *
 * Saat user tap satu paket:
 *   1. Foto & link Maps yang tersimpan di paket dikirim ke percakapan
 *      aktif via `shareToChat` (foto diunggah ulang ke bucket chat).
 *   2. Paket ditandai `status='sent'` + `sent_at=now()` + `sent_to_name`
 *      (nama alias lawan chat) — stok gudang tetap berkurang (deduksi
 *      sudah terjadi saat paket dibuat) dan paket pindah ke Riwayat
 *      terkirim di Panel Ready Packages.
 */

type ReadyRow = {
  id: string;
  qty_base: number;
  photo_path: string | null;
  location_url: string | null;
  note: string | null;
  warehouse_item_id: string;
  created_at: string;
  warehouse_items?: {
    name: string;
    base_unit: "g" | "pcs";
  } | null;
};

type Row = {
  id: string;
  productName: string;
  baseUnit: "g" | "pcs";
  qty: number;
  variant: string | null;
  photoPath: string | null;
  locationUrl: string | null;
};

export function ProductSharePopover({
  conversationId,
  disabled,
  peerName,
  onSent,
}: {
  conversationId: string;
  disabled?: boolean;
  peerName?: string;
  onSent?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [sendingId, setSendingId] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    const { data, error } = await supabase
      .from("ready_packages")
      .select(
        "id,qty_base,photo_path,location_url,note,warehouse_item_id,created_at,warehouse_items(name,base_unit)",
      )
      .eq("status", "ready")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error(friendlyError(error));
      return;
    }
    const mapped: Row[] = ((data ?? []) as unknown as ReadyRow[]).map((r) => ({
      id: r.id,
      productName: r.warehouse_items?.name ?? "Produk",
      baseUnit: (r.warehouse_items?.base_unit ?? "pcs") as "g" | "pcs",
      qty: Number(r.qty_base) || 0,
      variant: r.note?.trim() ? r.note.trim() : null,
      photoPath: r.photo_path,
      locationUrl: r.location_url,
    }));
    setRows(mapped);
  }

  useEffect(() => {
    if (open) void reload();
  }, [open]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      `${r.productName} ${r.variant ?? ""}`.toLowerCase().includes(needle),
    );
  }, [rows, q]);

  async function pickAndSend(row: Row) {
    if (sendingId) return;
    setSendingId(row.id);
    try {
      // 1. Fetch photo (if any) via signed URL and turn into a File for chat.
      const shots: { id: string; file: File }[] = [];
      if (row.photoPath) {
        const { data: signed, error: signErr } = await supabase.storage
          .from("ready-packages")
          .createSignedUrl(row.photoPath, 3600);
        if (signErr || !signed?.signedUrl) {
          toast.error("Gagal mengambil foto produk");
          return;
        }
        const file = await urlToFile(
          signed.signedUrl,
          `${row.productName.replace(/[^\w.-]+/g, "_")}.jpg`,
          "image/jpeg",
        );
        if (file) shots.push({ id: row.id, file });
      }

      const caption = [
        `📦 ${row.productName}`,
        `Jumlah: ${fmtBase(row.qty, row.baseUnit)}`,
        row.variant ? `Varian: ${row.variant}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      // 2. Send caption + photo + location into the current conversation.
      const res = await shareToChat({
        conversationId,
        caption,
        locationUrl: row.locationUrl,
        shots,
        idemKey: `chat-share-${row.id}`,
      });

      if (res.status === "failed") {
        toast.error(res.error || "Gagal mengirim produk");
        return;
      }

      // 3. Mark ready_package as sent so stock deduction persists AND the
      //    row moves into "Riwayat terkirim" (ReadyPackagesPanel history tab).
      const { error: upErr } = await supabase
        .from("ready_packages")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          sent_to_name: peerName?.trim() || null,
        })
        .eq("id", row.id);
      if (upErr) {
        // Message already delivered — surface but don't rollback the send.
        toast.error(`Terkirim tapi gagal update status: ${friendlyError(upErr)}`);
      } else {
        toast.success(`Terkirim: ${row.productName}`);
      }

      // Optimistically drop from local list so the same package can't be
      // resent by accident.
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      onSent?.();
    } catch (e) {
      toast.error((e as Error)?.message || "Gagal mengirim produk");
    } finally {
      setSendingId(null);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={disabled}
          aria-label="Kirim produk dari gudang"
          title="Kirim produk dari gudang"
          data-testid="chat-product-picker-trigger"
        >
          <Package className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-80 p-0" data-no-press>
        <div className="border-b p-2">
          <div className="text-sm font-medium">Kirim produk siap kirim</div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Ketuk satu produk untuk langsung kirim foto + lokasi. Stok akan tetap
            berkurang dan paket pindah ke Riwayat terkirim.
          </p>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari nama produk / varian…"
              className="h-8 pl-7 text-sm"
            />
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Memuat…
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {rows.length === 0
                ? "Belum ada paket siap kirim di gudang."
                : "Tidak ada produk yang cocok."}
            </div>
          ) : (
            <ul className="divide-y">
              {filtered.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => void pickAndSend(row)}
                    disabled={sendingId !== null}
                    className="flex w-full items-center gap-2 p-2 text-left hover:bg-accent disabled:opacity-60"
                  >
                    <ProductThumb path={row.photoPath} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {row.productName}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span>{fmtBase(row.qty, row.baseUnit)}</span>
                        {row.variant ? <span>· {row.variant}</span> : null}
                        {row.locationUrl ? (
                          <span className="inline-flex items-center gap-0.5">
                            <MapPin className="h-3 w-3" /> lokasi
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {sendingId === row.id ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const thumbCache = new Map<string, { url: string; exp: number }>();
function ProductThumb({ path }: { path: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    const c = thumbCache.get(path);
    if (c && c.exp > Date.now()) {
      setUrl(c.url);
      return;
    }
    let alive = true;
    supabase.storage
      .from("ready-packages")
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (!alive || !data?.signedUrl) return;
        thumbCache.set(path, {
          url: data.signedUrl,
          exp: Date.now() + 50 * 60 * 1000,
        });
        setUrl(data.signedUrl);
      });
    return () => {
      alive = false;
    };
  }, [path]);
  if (!path) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-dashed text-[9px] text-muted-foreground">
        —
      </div>
    );
  }
  return (
    <div className="h-10 w-10 shrink-0 overflow-hidden rounded border bg-muted">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : null}
    </div>
  );
}