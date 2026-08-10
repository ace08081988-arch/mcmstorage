/**
 * Detail produk katalog publik — foto besar, deskripsi, status stok live,
 * dan tombol Pesan WA dengan draft pesan yang sudah terisi.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { canonical, socialMeta } from "@/lib/seo-meta";
import { CATALOG_OG_HEIGHT, CATALOG_OG_WIDTH } from "@/lib/catalog-og-image";
import {
  breadcrumbSchema,
  jsonLdScript,
  productSchema,
  storeSchema,
} from "@/lib/structured-data";
import { useEffect } from "react";
import { ArrowLeft, MessageCircle, PackageSearch } from "lucide-react";

import { Button } from "@/components/ui/button";
import { reportCatalogVitals } from "@/lib/web-vitals-report";
import {
  getPublicCatalogItem,
  type PublicCatalogItemDetail,
  type PublicCatalogItemPayload,
} from "@/lib/public-catalog.functions";

/**
 * Lebar tampil foto produk: penuh di ponsel, maksimal 768px (max-w-3xl)
 * di layar besar. Browser memakai ini untuk memilih varian srcset terkecil
 * yang masih tajam, jadi ponsel tidak mengunduh gambar 1600px.
 */
const IMAGE_SIZES = "(min-width: 768px) 768px, 100vw";

export const Route = createFileRoute("/katalog/$slug/$itemId")({
  ssr: true,
  loader: ({ params }) =>
    getPublicCatalogItem({ data: { slug: params.slug, itemId: params.itemId } }),
  head: ({ params, loaderData }) => {
    const it = loaderData?.item;
    // href wajib ada meski `imagesrcset` yang dipakai browser modern.
    const avifHref = it?.image_avif_srcset?.split(" ")[0] ?? null;
    const shopName = loaderData?.shop?.name ?? "Toko";
    const title = it
      ? `${it.name} — ${shopName} | Ace Storage`
      : "Produk tidak ditemukan — Ace Storage";
    const desc = it
      ? (it.description?.trim() ||
        `${it.name}${it.category ? ` (${it.category})` : ""} di ${shopName}. Cek stok terkini dan pesan langsung lewat WhatsApp.`)
      : "Produk yang Anda cari tidak tersedia di katalog ini.";
    const path = `/katalog/${params.slug}/${params.itemId}`;
    const url = `https://mcmstorage.app${path}`;
    return {
      meta: socialMeta({
        title,
        description: desc,
        url: path,
        type: "product",
        // URL Storage bertanda tangan kedaluwarsa sebelum crawler sempat
        // mengambilnya, jadi og:image memakai endpoint stabil /api/public/img/og.
        image: loaderData?.og?.path ?? null,
        imageVersion: loaderData?.og?.version ?? null,
        imageType: loaderData?.og?.type,
        imageAlt: it ? `Foto produk ${it.name} di ${shopName}` : undefined,
        ...(loaderData?.og
          ? { imageWidth: CATALOG_OG_WIDTH, imageHeight: CATALOG_OG_HEIGHT }
          : {}),
        noindex: !loaderData?.found,
      }),
      // Gambar produk adalah elemen LCP halaman ini, jadi di-preload supaya
      // unduhannya mulai bersamaan dengan HTML/CSS.
      links: [
        canonical(path),
        ...(it?.image_url
          ? [
              {
                rel: "preload",
                as: "image",
                href: avifHref ?? it.image_url,
                fetchpriority: "high",
                // Browser yang tidak mendukung AVIF melewati preload bertipe
                // image/avif, jadi hanya satu berkas yang pernah diunduh.
                ...(it.image_avif_srcset
                  ? {
                      type: "image/avif",
                      imagesrcset: it.image_avif_srcset,
                      imagesizes: IMAGE_SIZES,
                    }
                  : it.image_srcset
                    ? { imagesrcset: it.image_srcset, imagesizes: IMAGE_SIZES }
                    : {}),
              },
            ]
          : []),
      ],
      scripts:
        loaderData?.found && it
          ? [
              jsonLdScript([
                productSchema({
                  id: it.id,
                  name: it.name,
                  description: desc,
                  url: path,
                  image: it.image_url,
                  category: it.category,
                  price: it.selling_price_per_base,
                  unit: it.base_unit,
                  stock: it.stock_base,
                  seller: { name: shopName, url: `/katalog/${params.slug}` },
                }),
                storeSchema({
                  name: shopName,
                  url: `/katalog/${params.slug}`,
                  description: loaderData?.shop?.tagline ?? null,
                  telephone: loaderData?.shop?.wa ?? null,
                }),
                breadcrumbSchema([
                  { name: shopName, url: `/katalog/${params.slug}` },
                  { name: it.name, url: path },
                ]),
              ]),
            ]
          : [],
    };
  },
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Gagal memuat produk</h1>
      <p role="alert" className="mt-2 text-sm text-muted-foreground">
        {error.message}
      </p>
    </main>
  ),
  notFoundComponent: () => <MissingProduct />,
  component: PublicItemPage,
});

function rupiah(n: number | null) {
  if (n == null || Number.isNaN(n)) return null;
  return `Rp${Math.round(n).toLocaleString("id-ID")}`;
}

function waLink(wa: string, text: string) {
  const digits = wa.replace(/\D/g, "").replace(/^0/, "62");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

function qty(n: number) {
  return n.toLocaleString("id-ID", { maximumFractionDigits: 2 });
}

function orderText(shopName: string, it: PublicCatalogItemDetail, url: string) {
  const price = rupiah(it.selling_price_per_base);
  return [
    `Halo ${shopName}, saya mau pesan produk ini:`,
    `• ${it.name}${it.category ? ` (${it.category})` : ""}`,
    `Jumlah: ___ ${it.base_unit || "pcs"}`,
    price ? `Harga: ${price}/${it.base_unit || "pcs"}` : "",
    url ? `Tautan: ${url}` : "",
    "",
    "Mohon info ketersediaan & totalnya. Terima kasih.",
  ]
    .filter(Boolean)
    .join("\n");
}

function MissingProduct() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-3 px-4 text-center">
      <PackageSearch className="h-8 w-8 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold">Produk tidak ditemukan</h1>
      <p className="text-sm text-muted-foreground">
        Produk ini sudah tidak ada di katalog atau katalog sedang dinonaktifkan.
      </p>
    </main>
  );
}

function PublicItemPage() {
  const data = Route.useLoaderData() as PublicCatalogItemPayload;
  const { slug, itemId } = Route.useParams();

  // Pemantauan Core Web Vitals lapangan untuk halaman detail produk.
  useEffect(() => reportCatalogVitals("katalog_detail", slug), [slug]);

  if (!data.found || !data.item || !data.shop) return <MissingProduct />;

  const it = data.item;
  const shop = data.shop;
  const empty = it.stock_base <= 0;
  const price = rupiah(it.selling_price_per_base);
  // URL dibangun dari params (bukan window) supaya markup SSR dan hasil
  // hidrasi identik — mismatch memaksa React re-render dan menaikkan CLS/INP.
  const pageUrl = `https://mcmstorage.app/katalog/${slug}/${itemId}`;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <Link
        to="/katalog/$slug"
        params={{ slug }}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Kembali ke katalog {shop.name}
      </Link>

      <article className="lux-card overflow-hidden">
        {it.image_url ? (
          <picture>
            {it.image_avif_srcset ? (
              <source type="image/avif" srcSet={it.image_avif_srcset} sizes={IMAGE_SIZES} />
            ) : null}
            <img
              src={it.image_url}
              {...(it.image_srcset ? { srcSet: it.image_srcset, sizes: IMAGE_SIZES } : {})}
              alt={`Foto produk ${it.name}`}
              width={1200}
              height={1200}
              fetchPriority="high"
            loading="eager"
              decoding="async"
              className="aspect-square w-full border-b border-border/50 object-cover sm:aspect-[16/10]"
            />
          </picture>
        ) : (
          <div className="flex aspect-[16/10] w-full items-center justify-center border-b border-border/50 bg-muted text-4xl font-semibold text-muted-foreground">
            {it.name.slice(0, 1).toUpperCase()}
          </div>
        )}

        <div className="space-y-4 p-5">
          <div>
            <p className="lux-eyebrow">{it.category?.trim() || "Tanpa kategori"}</p>
            <h1 className="text-2xl font-semibold tracking-tight">{it.name}</h1>
            {price ? (
              <p className="mt-1 text-lg font-semibold">
                {price}
                <span className="text-sm font-normal text-muted-foreground">
                  {" "}
                  /{it.base_unit || "pcs"}
                </span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                Harga belum dicantumkan — tanyakan lewat WhatsApp.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${
                empty ? "border-destructive/40 text-destructive" : "border-primary/30 text-primary"
              }`}
            >
              {empty ? "Stok habis" : `Tersedia ${qty(it.stock_base)} ${it.base_unit || "pcs"}`}
            </span>
            {it.package_type && it.package_type !== "pcs" && it.package_size > 0 ? (
              <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
                1 {it.package_type} = {qty(it.package_size)} {it.base_unit}
              </span>
            ) : null}
            <span className="text-xs text-muted-foreground">
              Stok langsung dari gudang · diperbarui{" "}
              {new Date(it.updated_at).toLocaleString("id-ID", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          </div>

          <section>
            <h2 className="text-sm font-semibold">Deskripsi</h2>
            <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
              {it.description?.trim() || "Penjual belum menambahkan deskripsi untuk produk ini."}
            </p>
          </section>

          {shop.wa ? (
            <Button asChild size="lg" className="w-full rounded-full">
              <a
                href={waLink(shop.wa, orderText(shop.name, it, pageUrl))}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle className="mr-2 h-5 w-5" aria-hidden />
                {empty ? "Tanya stok lewat WA" : "Pesan WA"}
              </a>
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Penjual belum mencantumkan nomor WhatsApp.
            </p>
          )}
        </div>
      </article>
    </main>
  );
}