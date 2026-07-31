/**
 * Katalog produk — daftar produk gudang (SSOT `warehouse_items`) yang bisa
 * difilter per kategori, dengan tombol "Pesan WA" per kartu yang membuka
 * WhatsApp berisi teks pesanan siap kirim.
 */
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { MessageCircle, PackageSearch } from "lucide-react";

import { PageContainer, PageHeader, PillsTabs } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useLiveStock, type LiveStockItem } from "@/lib/live-stock";
import { openWhatsAppPreferBusiness } from "@/lib/share-wa";
import { useEffect } from "react";

const TITLE = "Katalog Produk — MCM Storage";
const DESC =
  "Lihat katalog produk gudang lengkap dengan sisa stok, filter kategori, dan tombol pesan langsung lewat WhatsApp.";

export const Route = createFileRoute("/_authenticated/katalog")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: KatalogPage,
});

const signedUrlCache = new Map<string, { url: string; exp: number }>();

function ProductThumb({ path, name }: { path: string | null; name: string }) {
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
      <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-muted text-ms-xl font-semibold text-muted-foreground">
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

function stockLabel(it: LiveStockItem) {
  const n = Number(it.stock_base) || 0;
  const unit = it.base_unit || "pcs";
  return `${n.toLocaleString("id-ID", { maximumFractionDigits: 2 })} ${unit}`;
}

function buildOrderText(it: LiveStockItem) {
  return [
    "Halo, saya mau pesan:",
    `• ${it.name}${it.category ? ` (${it.category})` : ""}`,
    `Jumlah: ___ ${it.base_unit || "pcs"}`,
    "",
    "Mohon info ketersediaan & harganya. Terima kasih.",
  ].join("\n");
}

const ALL = "__all__";

function KatalogPage() {
  const { items, loading, connected, refresh } = useLiveStock();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>(ALL);
  const [onlyReady, setOnlyReady] = useState(false);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) if (it.category?.trim()) set.add(it.category.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b, "id-ID"));
  }, [items]);

  const tabs = useMemo(
    () => [
      { k: ALL, label: `Semua (${items.length})` },
      ...categories.map((c) => ({
        k: c,
        label: `${c} (${items.filter((i) => (i.category ?? "").trim() === c).length})`,
      })),
    ],
    [categories, items],
  );

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) => {
      if (cat !== ALL && (i.category ?? "").trim() !== cat) return false;
      if (onlyReady && (Number(i.stock_base) || 0) <= 0) return false;
      if (!s) return true;
      return (
        i.name.toLowerCase().includes(s) || (i.category ?? "").toLowerCase().includes(s)
      );
    });
  }, [items, q, cat, onlyReady]);

  return (
    <>
      <PageHeader
        icon={PackageSearch}
        title="Katalog produk"
        subtitle="Stok langsung · pesan lewat WA"
        stat={{ label: "Produk", value: String(filtered.length) }}
      >
        <PillsTabs tabs={tabs} value={cat} onChange={setCat} ariaLabel="Filter kategori produk" />
      </PageHeader>
      <div className="hidden md:block">
        <PillsTabs tabs={tabs} value={cat} onChange={setCat} ariaLabel="Filter kategori produk" />
      </div>
      <PageContainer ariaLabel="Katalog produk">
        <section className="space-ms-3">
          <div className="flex flex-wrap items-center gap-ms-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari produk / kategori…"
              aria-label="Cari produk"
              className="h-9 min-w-40 flex-1 rounded-md border bg-background px-ms-3 text-ms-sm"
            />
            <Button
              type="button"
              size="sm"
              variant={onlyReady ? "default" : "outline"}
              className="rounded-full"
              onClick={() => setOnlyReady((v) => !v)}
            >
              Stok tersedia
            </Button>
            <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={refresh}>
              Segarkan
            </Button>
            <span className="text-ms-2xs text-muted-foreground">
              {connected ? "Live" : "Offline"}
            </span>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 gap-ms-3 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-56 animate-pulse rounded-xl bg-muted/60" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="lux-card flex flex-col items-center gap-ms-2 p-ms-6 text-center">
              <PackageSearch className="h-6 w-6 text-muted-foreground" aria-hidden />
              <p className="text-ms-sm text-muted-foreground">
                {items.length === 0
                  ? "Belum ada produk di Gudang."
                  : "Tidak ada produk yang cocok dengan filter ini."}
              </p>
              <Button asChild size="sm" variant="outline" className="rounded-full">
                <Link to="/gudang">Buka Gudang</Link>
              </Button>
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-ms-3 sm:grid-cols-3">
              {filtered.map((it) => {
                const empty = (Number(it.stock_base) || 0) <= 0;
                return (
                  <li
                    key={it.id}
                    style={{ contentVisibility: "auto", containIntrinsicSize: "auto 240px" }}
                    className="lux-card flex flex-col gap-ms-2 p-ms-2.5"
                  >
                    <ProductThumb path={it.image_path} name={it.name} />
                    <div className="min-w-0">
                      <p className="truncate text-ms-sm font-semibold" title={it.name}>
                        {it.name}
                      </p>
                      <p className="truncate text-ms-2xs text-muted-foreground">
                        {it.category?.trim() || "Tanpa kategori"}
                      </p>
                    </div>
                    <span
                      className={`inline-flex w-fit items-center rounded-full border px-ms-2 py-0.5 text-ms-2xs font-medium ${
                        empty
                          ? "border-destructive/40 text-destructive"
                          : "border-primary/30 text-primary"
                      }`}
                    >
                      {empty ? "Stok habis" : stockLabel(it)}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      className="mt-auto w-full rounded-full"
                      onClick={() => openWhatsAppPreferBusiness(buildOrderText(it))}
                    >
                      <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden />
                      Pesan WA
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </PageContainer>
    </>
  );
}