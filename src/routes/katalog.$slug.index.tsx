/**
 * Katalog publik per toko — bisa dibuka tanpa login.
 * Pengunjung melihat produk + stok dan memesan langsung lewat WhatsApp.
 */
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Copy, MessageCircle, Minus, PackageSearch, Plus, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { reportCatalogVitals } from "@/lib/web-vitals-report";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getPublicCatalog,
  type PublicCatalogItem,
  type PublicCatalogPayload,
} from "@/lib/public-catalog.functions";

export const Route = createFileRoute("/katalog/$slug/")({
  ssr: true,
  loader: ({ params }) => getPublicCatalog({ data: { slug: params.slug } }),
  head: ({ params, loaderData }) => {
    const name = loaderData?.shop?.name ?? null;
    const title = name ? `${name} — Katalog produk` : "Katalog produk tidak tersedia";
    const desc =
      loaderData?.shop?.tagline?.trim() ||
      `Lihat daftar produk ${name ?? "toko"} lengkap dengan stok dan harga, lalu pesan langsung lewat WhatsApp.`;
    const url = `https://mcmstorage.app/katalog/${params.slug}`;
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        { name: "twitter:card", content: "summary" },
        ...(loaderData?.found ? [] : [{ name: "robots", content: "noindex" }]),
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: loaderData?.found
        ? [
            {
              type: "application/ld+json",
              children: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "CollectionPage",
                name: title,
                description: desc,
                url,
              }),
            },
          ]
        : [],
    };
  },
  component: PublicKatalogPage,
});

function rupiah(n: number | null) {
  if (n == null || Number.isNaN(n)) return null;
  return `Rp${Math.round(n).toLocaleString("id-ID")}`;
}

function waLink(wa: string, text: string) {
  const digits = wa.replace(/\D/g, "").replace(/^0/, "62");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

function orderText(shopName: string, it: PublicCatalogItem) {
  const price = rupiah(it.selling_price_per_base);
  return [
    `Halo ${shopName}, saya mau pesan:`,
    `• ${it.name}${it.category ? ` (${it.category})` : ""}`,
    `Jumlah: ___ ${it.base_unit || "pcs"}`,
    price ? `Harga: ${price}/${it.base_unit || "pcs"}` : "",
    "",
    "Mohon info ketersediaan & totalnya. Terima kasih.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Pesan WA sekali kirim untuk banyak produk sekaligus. */
function bulkOrderText(
  shopName: string,
  lines: { item: PublicCatalogItem; qty: number }[],
) {
  let total = 0;
  let complete = true;
  const rows = lines.map(({ item, qty }, i) => {
    const unit = item.base_unit || "pcs";
    const price = item.selling_price_per_base;
    if (price == null) complete = false;
    else total += price * qty;
    const sub = price != null ? ` = ${rupiah(price * qty)}` : "";
    const at = price != null ? ` × ${rupiah(price)}` : "";
    return `${i + 1}. ${item.name} — ${qty.toLocaleString("id-ID")} ${unit}${at}${sub}`;
  });
  return [
    `Halo ${shopName}, saya mau pesan ${lines.length} produk:`,
    "",
    ...rows,
    "",
    complete ? `Perkiraan total: ${rupiah(total)}` : "Mohon info harga total.",
    "Mohon konfirmasi ketersediaan & totalnya. Terima kasih.",
  ].join("\n");
}

const ALL = "__all__";
type SortOption = "name" | "price-asc" | "price-desc" | "stock";

function PublicKatalogPage() {
  const data = Route.useLoaderData() as PublicCatalogPayload;
  const { slug } = Route.useParams();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState(ALL);
  const [onlyReady, setOnlyReady] = useState(false);
  const [sort, setSort] = useState<SortOption>("name");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Pemantauan Core Web Vitals lapangan (LCP/CLS/INP) — hanya di browser.
  useEffect(() => reportCatalogVitals("katalog_list", slug), [slug]);

  const cartLines = useMemo(
    () =>
      data.items
        .filter((i) => (cart[i.id] ?? 0) > 0)
        .map((item) => ({ item, qty: cart[item.id] })),
    [data.items, cart],
  );
  const cartTotal = useMemo(
    () => cartLines.reduce((s, l) => s + (l.item.selling_price_per_base ?? 0) * l.qty, 0),
    [cartLines],
  );
  // Teks pesanan WA dibangun SEKALI per perubahan keranjang. Sebelumnya
  // dipanggil 3x per render (textarea, tombol salin, link WA) — pada katalog
  // besar itu ~50ms per ketukan tombol +/- di perangkat Android kelas menengah.
  const cartOrderText = useMemo(
    () => bulkOrderText(data.shop?.name ?? "", cartLines),
    [data.shop?.name, cartLines],
  );
  const setQty = (id: string, qty: number) =>
    setCart((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[id];
      else next[id] = qty;
      return next;
    });

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const it of data.items) if (it.category?.trim()) set.add(it.category.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b, "id-ID"));
  }, [data.items]);

  // Pencarian dipisah dari render input supaya mengetik tetap responsif:
  // filter+sort katalog besar berjalan di prioritas rendah.
  const deferredQ = useDeferredValue(q);
  const filtered = useMemo(() => {
    const s = deferredQ.trim().toLowerCase();
    const list = data.items.filter((i) => {
      if (cat !== ALL && (i.category ?? "").trim() !== cat) return false;
      if (onlyReady && i.stock_base <= 0) return false;
      if (!s) return true;
      return i.name.toLowerCase().includes(s) || (i.category ?? "").toLowerCase().includes(s);
    });
    list.sort((a, b) => {
      switch (sort) {
        case "price-asc":
          return (a.selling_price_per_base ?? Infinity) - (b.selling_price_per_base ?? Infinity);
        case "price-desc":
          return (b.selling_price_per_base ?? -Infinity) - (a.selling_price_per_base ?? -Infinity);
        case "stock":
          return b.stock_base - a.stock_base;
        default:
          return a.name.localeCompare(b.name, "id-ID");
      }
    });
    return list;
  }, [data.items, deferredQ, cat, onlyReady, sort]);

  if (!data.found || !data.shop) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-3 px-4 text-center">
        <PackageSearch className="h-8 w-8 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-semibold">Katalog tidak tersedia</h1>
        <p className="text-sm text-muted-foreground">
          Tautan katalog ini tidak ditemukan atau sedang dinonaktifkan pemiliknya.
        </p>
      </main>
    );
  }

  const shop = data.shop;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 pb-28">
      <header className="lux-plate mb-5 rounded-2xl p-5">
        <p className="lux-eyebrow">Katalog produk</p>
        <h1 className="text-2xl font-semibold tracking-tight">{shop.name}</h1>
        {shop.tagline?.trim() ? (
          <p className="mt-1 text-sm text-muted-foreground">{shop.tagline}</p>
        ) : null}
        <p className="mt-2 text-xs text-muted-foreground">
          {data.items.length} produk · stok diperbarui langsung dari gudang
        </p>
        {shop.wa ? (
          <Button asChild size="sm" className="mt-3 rounded-full">
            <a
              href={waLink(shop.wa, `Halo ${shop.name}, saya mau tanya produk.`)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden /> Chat penjual
            </a>
          </Button>
        ) : null}
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari produk / kategori…"
            aria-label="Cari produk"
            className="h-9 w-full rounded-full border bg-background pl-9 pr-3 text-sm"
          />
        </div>
        {categories.length > 0 && (
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger aria-label="Filter kategori" className="h-9 w-auto min-w-36 rounded-full">
              <SelectValue placeholder="Kategori" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Semua kategori</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={sort} onValueChange={(v) => setSort(v as SortOption)}>
          <SelectTrigger aria-label="Urutkan produk" className="h-9 w-auto min-w-36 rounded-full">
            <SelectValue placeholder="Urutkan" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Nama (A-Z)</SelectItem>
            <SelectItem value="price-asc">Harga terendah</SelectItem>
            <SelectItem value="price-desc">Harga tertinggi</SelectItem>
            <SelectItem value="stock">Stok tersedia</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant={onlyReady ? "default" : "outline"}
          className="rounded-full"
          onClick={() => setOnlyReady((v) => !v)}
        >
          Stok tersedia
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="lux-card p-6 text-center text-sm text-muted-foreground">
          Tidak ada produk yang cocok dengan filter ini.
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((it, idx) => {
            const empty = it.stock_base <= 0;
            const qty = cart[it.id] ?? 0;
            // Kartu pertama adalah satu-satunya kandidat LCP: eager +
            // fetchpriority high. Kartu 2-4 masih di viewport awal jadi
            // tetap eager, tapi prioritas auto supaya tidak berebut
            // bandwidth dengan LCP. Sisanya lazy + paint ditunda lewat
            // content-visibility.
            const aboveFold = idx < 4;
            const isLcp = idx === 0;
            return (
              <li
                key={it.id}
                style={
                  aboveFold
                    ? undefined
                    : { contentVisibility: "auto", containIntrinsicSize: "auto 280px" }
                }
                className={`lux-card flex flex-col gap-2 p-2.5 ${qty > 0 ? "ring-1 ring-primary" : ""}`}
              >
                {it.image_url ? (
                  <Link to="/katalog/$slug/$itemId" params={{ slug, itemId: it.id }}>
                  <img
                    src={it.image_url}
                    alt={`Foto produk ${it.name}`}
                    width={600}
                    height={600}
                    sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                    loading={aboveFold ? "eager" : "lazy"}
                    fetchPriority={isLcp ? "high" : aboveFold ? "auto" : "low"}
                    decoding="async"
                    className="aspect-square w-full rounded-lg border border-border/50 object-cover"
                  />
                  </Link>
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-muted text-xl font-semibold text-muted-foreground">
                    {it.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <Link
                    to="/katalog/$slug/$itemId"
                    params={{ slug, itemId: it.id }}
                    className="block truncate text-sm font-semibold hover:underline"
                    title={it.name}
                  >
                    {it.name}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {it.category?.trim() || "Tanpa kategori"}
                  </p>
                  {it.selling_price_per_base != null && (
                    <p className="truncate text-sm font-medium">
                      {rupiah(it.selling_price_per_base)}
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        /{it.base_unit || "pcs"}
                      </span>
                    </p>
                  )}
                </div>
                <span
                  className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] ${
                    empty ? "text-muted-foreground" : "text-foreground"
                  }`}
                >
                  {empty
                    ? "Stok habis"
                    : `${it.stock_base.toLocaleString("id-ID", { maximumFractionDigits: 2 })} ${it.base_unit || "pcs"}`}
                </span>
                {shop.wa ? (
                  <div className="mt-auto">
                    {qty > 0 ? (
                      <div className="flex items-center justify-between rounded-full border p-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 rounded-full"
                          aria-label={`Kurangi ${it.name}`}
                          onClick={() => setQty(it.id, qty - 1)}
                        >
                          <Minus className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                        <span className="text-sm font-semibold tabular-nums">{qty}</span>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 rounded-full"
                          aria-label={`Tambah ${it.name}`}
                          onClick={() => setQty(it.id, qty + 1)}
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="flex-1 rounded-full px-2"
                          disabled={empty}
                          onClick={() => setQty(it.id, 1)}
                        >
                          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Pilih
                        </Button>
                        <Button asChild size="sm" className="rounded-full px-2.5">
                          <a
                            href={waLink(shop.wa, orderText(shop.name, it))}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Pesan ${it.name} lewat WhatsApp`}
                          >
                            <MessageCircle className="h-4 w-4" aria-hidden />
                          </a>
                        </Button>
                      </div>
                    )}
                  </div>
                ) : null}
                <Link
                  to="/katalog/$slug/$itemId"
                  params={{ slug, itemId: it.id }}
                  className="text-center text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Lihat detail
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {shop.wa && cartLines.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {cartLines.length} produk dipilih
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {cartTotal > 0 ? `Perkiraan total ${rupiah(cartTotal)}` : "Total dikonfirmasi penjual"}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="rounded-full"
              onClick={() => setCart({})}
            >
              <X className="mr-1 h-4 w-4" aria-hidden /> Kosongkan
            </Button>
            <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
              <DialogTrigger asChild>
                <Button type="button" size="sm" className="rounded-full">
                  <Check className="mr-1.5 h-4 w-4" aria-hidden /> Kirim pesanan WA
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Pratinjau pesanan WA</DialogTitle>
                  <DialogDescription>
                    Cek dan ubah jumlah tiap produk sebelum kirim ke {shop.name}.
                  </DialogDescription>
                </DialogHeader>
                <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
                  <ul className="space-y-2">
                    {cartLines.map(({ item, qty }) => {
                      const empty = item.stock_base <= 0;
                      return (
                        <li
                          key={item.id}
                          className="flex items-center justify-between gap-2 rounded-lg border p-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{item.name}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {item.selling_price_per_base != null
                                ? `${rupiah(item.selling_price_per_base)}/${item.base_unit || "pcs"}`
                                : "Harga dikonfirmasi penjual"}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 rounded-full"
                              aria-label={`Kurangi ${item.name}`}
                              onClick={() => setQty(item.id, qty - 1)}
                            >
                              <Minus className="h-3.5 w-3.5" aria-hidden />
                            </Button>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={qty}
                              onChange={(e) => {
                                const v = parseInt(e.target.value.replace(/\D/g, ""), 10);
                                setQty(item.id, Number.isNaN(v) ? 0 : v);
                              }}
                              className="h-7 w-12 rounded-md border bg-background text-center text-sm tabular-nums"
                              aria-label={`Jumlah ${item.name}`}
                            />
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 rounded-full"
                              aria-label={`Tambah ${item.name}`}
                              disabled={!empty && qty >= item.stock_base}
                              onClick={() => setQty(item.id, qty + 1)}
                            >
                              <Plus className="h-3.5 w-3.5" aria-hidden />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 rounded-full text-destructive"
                              aria-label={`Hapus ${item.name}`}
                              onClick={() => setQty(item.id, 0)}
                            >
                              <X className="h-3.5 w-3.5" aria-hidden />
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <textarea
                    readOnly
                    value={cartOrderText}
                    className="min-h-[120px] w-full rounded-lg border bg-muted/50 p-3 text-sm leading-relaxed"
                    aria-label="Teks pesanan WhatsApp"
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{cartLines.length} produk</span>
                    <span>{cartTotal > 0 ? `Perkiraan total ${rupiah(cartTotal)}` : "Total dikonfirmasi penjual"}</span>
                  </div>
                </div>
                <DialogFooter className="flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(cartOrderText)
                        .then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        });
                    }}
                  >
                    <Copy className="mr-1.5 h-4 w-4" aria-hidden />
                    {copied ? "Tersalin" : "Salin teks"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="rounded-full"
                    onClick={() => setPreviewOpen(false)}
                  >
                    Tutup
                  </Button>
                  <Button asChild className="rounded-full">
                    <a
                      href={waLink(shop.wa, cartOrderText)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setPreviewOpen(false)}
                    >
                      <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden /> Kirim ke WhatsApp
                    </a>
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      ) : null}
    </main>
  );
}