/**
 * SSOT schema.org (JSON-LD) untuk halaman publik.
 *
 * Dipakai agar hasil pencarian menampilkan rich preview: kartu Organization
 * untuk brand Ace Storage, dan kartu Product (harga + ketersediaan) untuk tiap
 * produk katalog toko.
 */
import { BRAND, SITE_URL, DEFAULT_OG_IMAGE, absoluteUrl } from "./seo-meta";

export type JsonLd = Record<string, unknown>;

/** Organization sitewide (penerbit aplikasi Ace Storage). */
export function organizationSchema(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: BRAND,
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl("/apple-touch-icon.png"),
    },
    image: DEFAULT_OG_IMAGE,
    description:
      "Ace Storage — aplikasi pengelola pesanan, stok gudang, dan hutang-piutang yang terhubung ke WhatsApp.",
  };
}

/** WebSite sitewide, dipasang berdampingan dengan Organization. */
export function websiteSchema(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: BRAND,
    url: SITE_URL,
    inLanguage: "id-ID",
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
}

/** Organization untuk toko pemilik katalog (bukan brand aplikasi). */
export function storeSchema(input: {
  name: string;
  url: string;
  description?: string | null;
  telephone?: string | null;
}): JsonLd {
  const url = absoluteUrl(input.url);
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${url}#store`,
    name: input.name,
    url,
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    ...(input.telephone ? { telephone: normalizeWa(input.telephone) } : {}),
  };
}

function normalizeWa(wa: string): string {
  const digits = wa.replace(/\D/g, "").replace(/^0/, "62");
  return `+${digits}`;
}

export type ProductSchemaInput = {
  id: string;
  name: string;
  description: string;
  /** Path atau URL halaman produk. */
  url: string;
  image?: string | null;
  category?: string | null;
  /** Harga per satuan dasar; null = harga tidak dipublikasikan. */
  price?: number | null;
  unit?: string | null;
  /** Sisa stok dalam satuan dasar. */
  stock?: number | null;
  seller?: { name: string; url: string } | null;
};

/** Product + Offer (IDR) dengan ketersediaan dari sisa stok. */
export function productSchema(input: ProductSchemaInput): JsonLd {
  const url = absoluteUrl(input.url);
  const inStock = (input.stock ?? 0) > 0;
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${url}#product`,
    name: input.name,
    description: input.description,
    sku: input.id,
    url,
    ...(input.image ? { image: [absoluteUrl(input.image)] } : {}),
    ...(input.category ? { category: input.category } : {}),
    ...(input.seller ? { brand: { "@type": "Brand", name: input.seller.name } } : {}),
    offers: {
      "@type": "Offer",
      url,
      priceCurrency: "IDR",
      availability: inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      ...(input.price != null && Number.isFinite(input.price)
        ? { price: String(Math.round(input.price)) }
        : {}),
      ...(input.unit ? { eligibleQuantity: { "@type": "QuantitativeValue", unitText: input.unit } } : {}),
      ...(input.seller
        ? {
            seller: {
              "@type": "Organization",
              name: input.seller.name,
              url: absoluteUrl(input.seller.url),
            },
          }
        : {}),
    },
  };
}

/** ItemList produk untuk halaman katalog (daftar). */
export function productListSchema(input: {
  name: string;
  url: string;
  products: ProductSchemaInput[];
  /** Batas maksimum item yang diserialisasi agar HTML tidak membengkak. */
  limit?: number;
}): JsonLd {
  const url = absoluteUrl(input.url);
  const products = input.products.slice(0, input.limit ?? 50);
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: input.name,
    url,
    numberOfItems: products.length,
    itemListElement: products.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: stripContext(productSchema(p)),
    })),
  };
}

/** BreadcrumbList sederhana dari pasangan nama → path. */
export function breadcrumbSchema(items: { name: string; url: string }[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: absoluteUrl(it.url),
    })),
  };
}

function stripContext(node: JsonLd): JsonLd {
  const { "@context": _ctx, ...rest } = node;
  return rest;
}

/** Bungkus objek JSON-LD jadi entri `head().scripts`. */
export function jsonLdScript(data: JsonLd | JsonLd[]) {
  return { type: "application/ld+json", children: JSON.stringify(data) };
}
