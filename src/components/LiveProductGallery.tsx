/**
 * Galeri produk gudang dengan stok realtime.
 *
 * Dipasang di Beranda supaya perubahan stok yang terjadi di Gudang /
 * POS Kasir / Kios langsung terlihat tanpa reload. Sumber angka tetap
 * `warehouse_items` (SSOT inventaris) — tidak ada copy ke user_storage.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useLiveStock, type LiveStockItem } from "@/lib/live-stock";

const signedUrlCache = new Map<string, { url: string; exp: number }>();

function ItemThumb({ path, name }: { path: string | null; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    const cached = signedUrlCache.get(path);
    if (cached && cached.exp > Date.now()) {
      setUrl(cached.url);
      return;
    }
    supabase.storage
      .from("item-photos")
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (!alive || !data) return;
        signedUrlCache.set(path, { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 });
        setUrl(data.signedUrl);
      });
    return () => {
      alive = false;
    };
  }, [path]);
  if (!url) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-muted text-ms-lg text-muted-foreground">
        {name.slice(0, 1).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={`Foto produk ${name}`}
      loading="lazy"
      className="aspect-square w-full rounded-lg border border-border/50 object-cover"
    />
  );
}

function formatStock(it: LiveStockItem) {
  const n = Number(it.stock_base) || 0;
  const unit = it.base_unit === "g" ? "g" : it.base_unit || "pcs";
  return `${n.toLocaleString("id-ID", { maximumFractionDigits: 2 })} ${unit}`;
}

export function LiveProductGallery() {
  const { items, loading, lastSyncAt, connected, refresh } = useLiveStock();
  const [q, setQ] = useState("");
  const [flash, setFlash] = useState<Record<string, number>>({});
  const [prevStock, setPrevStock] = useState<Record<string, number>>({});

  // Sorot kartu yang stoknya baru berubah supaya sinkronisasi terlihat.
  useEffect(() => {
    const next: Record<string, number> = {};
    const changed: string[] = [];
    for (const it of items) {
      next[it.id] = Number(it.stock_base) || 0;
      if (prevStock[it.id] !== undefined && prevStock[it.id] !== next[it.id]) changed.push(it.id);
    }
    if (changed.length) {
      const now = Date.now();
      setFlash((f) => ({ ...f, ...Object.fromEntries(changed.map((id) => [id, now])) }));
      const t = setTimeout(() => setFlash({}), 2200);
      setPrevStock(next);
      return () => clearTimeout(t);
    }
    setPrevStock(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter(
      (i) => i.name.toLowerCase().includes(s) || (i.category ?? "").toLowerCase().includes(s),
    );
  }, [items, q]);

  return (
    <section className="rounded-xl border bg-card/80 p-ms-3 shadow-sm" aria-label="Galeri produk gudang">
      <div className="mb-ms-2 flex flex-wrap items-center gap-2">
        <h2 className="text-ms-base font-semibold">Galeri produk (stok langsung)</h2>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-ms-2xs ${
            connected ? "border-emerald-500/40 text-emerald-500" : "border-border text-muted-foreground"
          }`}
          title={connected ? "Terhubung ke pembaruan langsung" : "Menyambung ulang…"}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-muted-foreground"}`} />
          {connected ? "Live" : "Offline"}
        </span>
        <span className="text-ms-2xs text-muted-foreground">
          {lastSyncAt ? `Sinkron ${new Date(lastSyncAt).toLocaleTimeString("id-ID")}` : "Memuat…"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            className="rounded-md border px-2 py-1 text-ms-2xs hover:bg-accent"
          >
            Segarkan
          </button>
          <Link to="/gudang" className="rounded-md border px-2 py-1 text-ms-2xs hover:bg-accent">
            Buka Gudang
          </Link>
        </div>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Cari produk / kategori…"
        className="mb-ms-2 h-9 w-full rounded-md border bg-background px-ms-2 text-ms-sm"
        aria-label="Cari produk gudang"
      />

      {loading ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-lg bg-muted/60" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-ms-3 text-center text-ms-xs text-muted-foreground">
          {items.length === 0 ? "Belum ada produk di Gudang." : "Tidak ada produk yang cocok."}
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {filtered.map((it) => {
            const isFlash = Boolean(flash[it.id]);
            const empty = (Number(it.stock_base) || 0) <= 0;
            return (
              <li
                key={it.id}
                className={`rounded-lg border p-1.5 transition-colors duration-500 ${
                  isFlash ? "border-primary bg-primary/10" : "border-border/50 bg-background/60"
                }`}
              >
                <ItemThumb path={it.image_path} name={it.name} />
                <p className="mt-1 truncate text-ms-2xs font-medium" title={it.name}>
                  {it.name}
                </p>
                <p
                  className={`truncate text-ms-2xs ${empty ? "text-destructive" : "text-muted-foreground"}`}
                  title={formatStock(it)}
                >
                  {empty ? "Stok habis" : formatStock(it)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
