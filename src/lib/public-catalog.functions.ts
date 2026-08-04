/**
 * Katalog publik — data produk untuk pengunjung yang belum login.
 *
 * Hanya toko yang mengaktifkan katalog publik yang bisa dibaca, dan hanya
 * kolom aman yang dikirim (tanpa harga modal / user_id). Foto produk
 * ditandatangani di server supaya bucket tetap privat.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const slugSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "Slug tidak valid"),
});

export type PublicCatalogItem = {
  id: string;
  name: string;
  category: string | null;
  base_unit: string;
  stock_base: number;
  selling_price_per_base: number | null;
  image_url: string | null;
};

export type PublicCatalogItemDetail = PublicCatalogItem & {
  description: string | null;
  package_type: string;
  package_size: number;
  updated_at: string;
  /** Varian lebar gambar untuk `srcset` (kosong bila transformasi gagal). */
  image_srcset: string | null;
};

export type PublicCatalogItemPayload = {
  found: boolean;
  shop: { name: string; wa: string; tagline: string } | null;
  item: PublicCatalogItemDetail | null;
};

export type PublicCatalogPayload = {
  found: boolean;
  shop: { name: string; wa: string; tagline: string } | null;
  items: PublicCatalogItem[];
};

export const getPublicCatalog = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => slugSchema.parse(data))
  .handler(async ({ data }): Promise<PublicCatalogPayload> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: settings } = await supabaseAdmin
      .from("public_catalog_settings")
      .select("user_id, shop_name, wa_number, tagline, enabled")
      .eq("slug", data.slug)
      .maybeSingle();

    if (!settings || !settings.enabled) {
      return { found: false, shop: null, items: [] };
    }

    const { data: rows } = await supabaseAdmin
      .from("warehouse_items")
      .select("id, name, category, base_unit, stock_base, selling_price_per_base, image_path")
      .eq("user_id", settings.user_id)
      .order("name", { ascending: true })
      .limit(500);

    const list = rows ?? [];
    const paths = list.map((r) => r.image_path).filter((p): p is string => !!p);
    const urlByPath = new Map<string, string>();
    if (paths.length) {
      const { data: signed } = await supabaseAdmin.storage
        .from("item-photos")
        .createSignedUrls(paths, 3600);
      for (const s of signed ?? []) {
        if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
      }
    }

    return {
      found: true,
      shop: {
        name: settings.shop_name,
        wa: settings.wa_number,
        tagline: settings.tagline,
      },
      items: list.map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        base_unit: r.base_unit,
        stock_base: Number(r.stock_base) || 0,
        selling_price_per_base:
          r.selling_price_per_base == null ? null : Number(r.selling_price_per_base),
        image_url: r.image_path ? (urlByPath.get(r.image_path) ?? null) : null,
      })),
    };
  });

const itemSchema = slugSchema.extend({ itemId: z.string().uuid("Produk tidak valid") });

/**
 * Lebar varian foto detail produk.
 *
 * Storage melakukan negosiasi format otomatis lewat header `Accept`:
 * browser modern menerima WebP (rata-rata 5-10x lebih kecil dari JPEG asli),
 * yang lain tetap dapat JPEG. AVIF belum didukung transformer, jadi WebP
 * adalah format hemat terbaik yang tersedia.
 */
const DETAIL_WIDTHS = [640, 1024, 1600] as const;
/** Lebar yang dipakai sebagai `src` fallback bila browser tidak baca srcset. */
const DETAIL_FALLBACK_WIDTH = 1024;

/** Detail satu produk katalog publik (stok live, deskripsi, foto). */
export const getPublicCatalogItem = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => itemSchema.parse(data))
  .handler(async ({ data }): Promise<PublicCatalogItemPayload> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: settings } = await supabaseAdmin
      .from("public_catalog_settings")
      .select("user_id, shop_name, wa_number, tagline, enabled")
      .eq("slug", data.slug)
      .maybeSingle();

    if (!settings || !settings.enabled) return { found: false, shop: null, item: null };

    const { data: r } = await supabaseAdmin
      .from("warehouse_items")
      .select(
        "id, name, category, base_unit, stock_base, selling_price_per_base, image_path, description, package_type, package_size, updated_at",
      )
      .eq("user_id", settings.user_id)
      .eq("id", data.itemId)
      .maybeSingle();

    const shop = {
      name: settings.shop_name,
      wa: settings.wa_number,
      tagline: settings.tagline,
    };

    if (!r) return { found: false, shop, item: null };

    let imageUrl: string | null = null;
    let imageSrcset: string | null = null;
    if (r.image_path) {
      const path = r.image_path;
      // Semua varian ditandatangani paralel — token menyimpan parameter
      // transformasi, jadi tiap lebar butuh URL-nya sendiri.
      const variants = await Promise.all(
        DETAIL_WIDTHS.map(async (width) => {
          const { data: signed } = await supabaseAdmin.storage
            .from("item-photos")
            .createSignedUrl(path, 3600, {
              transform: { width, resize: "contain", quality: 72 },
            });
          return signed?.signedUrl ? { width, url: signed.signedUrl } : null;
        }),
      );
      const ok = variants.filter((v): v is { width: number; url: string } => v !== null);
      if (ok.length) {
        imageSrcset = ok.map((v) => `${v.url} ${v.width}w`).join(", ");
        imageUrl =
          (ok.find((v) => v.width === DETAIL_FALLBACK_WIDTH) ?? ok[ok.length - 1]).url;
      } else {
        // Fallback: transformasi tidak tersedia — kirim berkas asli.
        const { data: signed } = await supabaseAdmin.storage
          .from("item-photos")
          .createSignedUrl(path, 3600);
        imageUrl = signed?.signedUrl ?? null;
      }
    }

    return {
      found: true,
      shop,
      item: {
        id: r.id,
        name: r.name,
        category: r.category,
        base_unit: r.base_unit,
        stock_base: Number(r.stock_base) || 0,
        selling_price_per_base:
          r.selling_price_per_base == null ? null : Number(r.selling_price_per_base),
        image_url: imageUrl,
        image_srcset: imageSrcset,
        description: r.description ?? null,
        package_type: r.package_type,
        package_size: Number(r.package_size) || 0,
        updated_at: r.updated_at,
      },
    };
  });