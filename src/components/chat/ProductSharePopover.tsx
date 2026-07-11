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
import { friendlyError, notifyError } from "@/lib/friendly-error";

/**
 * Popover di sebelah tombol "Kirim" pada composer chat.
 * Menampilkan daftar paket **siap dikirim** dari dua sumber:
 *   - `ready_packages.status='ready'` (via Pegawai / gudang) — foto di
 *      bucket `ready-packages`, punya jumlah & unit.
 *   - `self_prep_items.status='ready'` (Siapkan Sendiri di /tugas) —
 *      foto di bucket `self-prep-photos`, tanpa jumlah/unit (judul bebas).
 *
 * Saat user tap satu paket:
 *   1. Foto & link Maps yang tersimpan di paket dikirim ke percakapan
 *      aktif via `shareToChat` (foto diunggah ulang ke bucket chat).
 *   2. Paket ditandai `status='sent'` di tabel asalnya — stok gudang
 *      tetap berkurang (deduksi sudah terjadi saat paket dibuat) dan
 *      paket pindah ke Riwayat terkirim.
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
  source: "ready" | "self" | "catalog";
  bucket: "ready-packages" | "self-prep-photos" | "item-photos";
  productName: string;
  baseUnit: "g" | "pcs" | null;
  qty: number | null;
  variant: string | null;
  photoPath: string | null;
  photoPaths: string[];
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
    const [readyRes, selfRes, catalogRes] = await Promise.all([
      supabase
        .from("ready_packages")
        .select(
          "id,qty_base,photo_path,location_url,note,warehouse_item_id,created_at,warehouse_items(name,base_unit)",
        )
        .eq("status", "ready")
        .order("created_at", { ascending: false }),
      // self_prep_items belum ada di typegen — pakai cast supaya build lolos.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from as any)("self_prep_items")
        .select("id,title,note,photo_path,photo_paths,location_url,created_at")
        .eq("status", "ready")
        .order("created_at", { ascending: false }),
      supabase
        .from("warehouse_items")
        .select("id,name,base_unit,stock_base,image_path,package_type")
        .order("name", { ascending: true }),
    ]);
    setLoading(false);
    if (readyRes.error) {
      notifyError(readyRes.error);
      return;
    }
    const mappedReady: Row[] = ((readyRes.data ?? []) as unknown as ReadyRow[]).map((r) => ({
      id: r.id,
      source: "ready" as const,
      bucket: "ready-packages" as const,
      productName: r.warehouse_items?.name ?? "Produk",
      baseUnit: (r.warehouse_items?.base_unit ?? "pcs") as "g" | "pcs",
      qty: Number(r.qty_base) || 0,
      variant: r.note?.trim() ? r.note.trim() : null,
      photoPath: r.photo_path,
      photoPaths: r.photo_path ? [r.photo_path] : [],
      locationUrl: r.location_url,
    }));
    type SelfRow = {
      id: string;
      title: string;
      note: string | null;
      photo_path: string | null;
      photo_paths: string[] | null;
      location_url: string | null;
    };
    const mappedSelf: Row[] = ((selfRes.data ?? []) as SelfRow[]).map((r) => {
      const paths = Array.from(
        new Set([...(r.photo_path ? [r.photo_path] : []), ...((r.photo_paths ?? []) as string[])]),
      );
      return {
        id: r.id,
        source: "self" as const,
        bucket: "self-prep-photos" as const,
        productName: r.title || "Produk",
        baseUnit: null,
        qty: null,
        variant: r.note?.trim() ? r.note.trim() : null,
        photoPath: paths[0] ?? null,
        photoPaths: paths,
        locationUrl: r.location_url,
      };
    });
    type CatalogRow = {
      id: string;
      name: string;
      base_unit: "g" | "pcs";
      stock_base: number | null;
      image_path: string | null;
      package_type: string | null;
    };
    const mappedCatalog: Row[] = ((catalogRes.data ?? []) as unknown as CatalogRow[]).map((r) => ({
      id: r.id,
      source: "catalog" as const,
      bucket: "item-photos" as const,
      productName: r.name || "Produk",
      baseUnit: (r.base_unit ?? "pcs") as "g" | "pcs",
      qty: Number(r.stock_base) || 0,
      variant: r.package_type?.trim() ? r.package_type.trim() : null,
      photoPath: r.image_path,
      photoPaths: r.image_path ? [r.image_path] : [],
      locationUrl: null,
    }));
    setRows([...mappedReady, ...mappedSelf, ...mappedCatalog]);
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

  const grouped = useMemo(() => {
    const paket = filtered.filter((r) => r.source !== "catalog");
    const katalog = filtered.filter((r) => r.source === "catalog");
    return { paket, katalog };
  }, [filtered]);

  async function pickAndSend(row: Row) {
    if (sendingId) return;
    setSendingId(row.id);
    try {
      // 1. Fetch photos (if any) via signed URLs and turn them into Files.
      const shots: { id: string; file: File }[] = [];
      for (let i = 0; i < row.photoPaths.length; i++) {
        const p = row.photoPaths[i];
        const { data: signed, error: signErr } = await supabase.storage
          .from(row.bucket)
          .createSignedUrl(p, 3600);
        if (signErr || !signed?.signedUrl) {
          toast.error("Gagal mengambil foto produk");
          return;
        }
        const file = await urlToFile(
          signed.signedUrl,
          `${row.productName.replace(/[^\w.-]+/g, "_")}-${i + 1}.jpg`,
          "image/jpeg",
        );
        if (file) shots.push({ id: `${row.id}:${i}`, file });
      }

      const qtyLabel = row.source === "catalog" ? "Stok" : "Jumlah";
      const caption = [
        `📦 ${row.productName}`,
        row.qty !== null && row.baseUnit ? `${qtyLabel}: ${fmtBase(row.qty, row.baseUnit)}` : null,
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

      // 3. Mark row as sent di tabel asalnya (kolomnya beda antar tabel).
      // Katalog gudang tidak diubah statusnya — hanya paket yang pindah ke Riwayat.
      const nowIso = new Date().toISOString();
      const peer = peerName?.trim() || null;
      const summary = caption.length > 140 ? `${caption.slice(0, 140)}…` : caption;
      let upErr: unknown = null;
      if (row.source === "ready") {
        upErr = (await supabase
          .from("ready_packages")
          .update({ status: "sent", sent_at: nowIso, sent_to_name: peer })
          .eq("id", row.id)).error;
      } else if (row.source === "self") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        upErr = (await (supabase.from as any)("self_prep_items")
          .update({
            status: "sent",
            sent_at: nowIso,
            sent_channel: "chat",
            sent_to: peer,
            sent_summary: summary,
          })
          .eq("id", row.id)).error;
      }
      if (upErr) {
        // Message already delivered — surface but don't rollback the send.
        toast.error(`Terkirim tapi gagal update status: ${friendlyError(upErr)}`);
      } else {
        toast.success(`Terkirim: ${row.productName}`);
      }

      // Paket yang sudah dikirim di-drop dari daftar supaya tidak dikirim
      // dua kali. Katalog gudang tetap ada — bisa dikirim ke chat lain.
      if (row.source !== "catalog") {
        setRows((prev) => prev.filter((r) => r.id !== row.id));
      }
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
                ? "Belum ada produk di gudang."
                : "Tidak ada produk yang cocok."}
            </div>
          ) : (
            <div>
              {grouped.paket.length > 0 ? (
                <>
                  <div className="sticky top-0 z-[1] bg-muted/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                    Paket siap kirim
                  </div>
                  <ul className="divide-y">
                    {grouped.paket.map((row) => (
                      <ProductRow key={row.id} row={row} sendingId={sendingId} onPick={pickAndSend} />
                    ))}
                  </ul>
                </>
              ) : null}
              {grouped.katalog.length > 0 ? (
                <>
                  <div className="sticky top-0 z-[1] bg-muted/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                    Katalog gudang
                  </div>
                  <ul className="divide-y">
                    {grouped.katalog.map((row) => (
                      <ProductRow key={row.id} row={row} sendingId={sendingId} onPick={pickAndSend} />
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const thumbCache = new Map<string, { url: string; exp: number }>();

function ProductRow({
  row,
  sendingId,
  onPick,
}: {
  row: Row;
  sendingId: string | null;
  onPick: (row: Row) => void | Promise<void>;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => void onPick(row)}
        disabled={sendingId !== null}
        className="flex w-full items-center gap-2 p-2 text-left hover:bg-accent disabled:opacity-60"
      >
        <ProductThumb path={row.photoPath} bucket={row.bucket} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{row.productName}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            {row.qty !== null && row.baseUnit ? (
              <span>{fmtBase(row.qty, row.baseUnit)}</span>
            ) : (
              <span className="rounded bg-muted px-1 py-0.5 text-[10px]">sendiri</span>
            )}
            {row.variant ? <span>· {row.variant}</span> : null}
            {row.locationUrl ? (
              <span className="inline-flex items-center gap-0.5">
                <MapPin className="h-3 w-3" /> lokasi
              </span>
            ) : null}
            {row.source === "catalog" ? (
              <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">katalog</span>
            ) : null}
          </div>
        </div>
        {sendingId === row.id ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        ) : null}
      </button>
    </li>
  );
}

function ProductThumb({ path, bucket }: { path: string | null; bucket: "ready-packages" | "self-prep-photos" | "item-photos" }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    const key = `${bucket}:${path}`;
    const c = thumbCache.get(key);
    if (c && c.exp > Date.now()) {
      setUrl(c.url);
      return;
    }
    let alive = true;
    supabase.storage
      .from(bucket)
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (!alive || !data?.signedUrl) return;
        thumbCache.set(key, {
          url: data.signedUrl,
          exp: Date.now() + 50 * 60 * 1000,
        });
        setUrl(data.signedUrl);
      });
    return () => {
      alive = false;
    };
  }, [path, bucket]);
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