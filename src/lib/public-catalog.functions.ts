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