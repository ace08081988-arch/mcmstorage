import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

const BASE_URL = "https://mcmstorage.app";

interface SitemapEntry {
  path: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

/**
 * Katalog publik bersifat dinamis: satu entri per toko yang mengaktifkan
 * katalog, plus satu entri per produknya. Filter `enabled` mengikuti loader
 * `/katalog/$slug` supaya sitemap tidak pernah menawarkan halaman 404.
 */
async function catalogEntries(): Promise<SitemapEntry[]> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: shops } = await supabaseAdmin
      .from("public_catalog_settings")
      .select("slug, user_id, enabled")
      .eq("enabled", true)
      .limit(500);
    if (!shops?.length) return [];

    const out: SitemapEntry[] = [];
    for (const shop of shops) {
      out.push({ path: `/katalog/${shop.slug}`, changefreq: "daily", priority: "0.8" });
      const { data: items } = await supabaseAdmin
        .from("warehouse_items")
        .select("id, updated_at")
        .eq("user_id", shop.user_id)
        .order("name", { ascending: true })
        .limit(500);
      for (const it of items ?? []) {
        out.push({
          path: `/katalog/${shop.slug}/${it.id}`,
          // `updated_at` milik baris produk itu sendiri — timestamp yang benar
          // untuk lastmod (bukan waktu build/generate sitemap).
          ...(it.updated_at ? { lastmod: new Date(it.updated_at).toISOString() } : {}),
          changefreq: "daily",
          priority: "0.7",
        });
      }
    }
    return out;
  } catch {
    // Sitemap statis tetap tersaji walau backend sedang tidak bisa dibaca.
    return [];
  }
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const entries: SitemapEntry[] = [
          { path: "/", changefreq: "weekly", priority: "1.0" },
          { path: "/produk", changefreq: "monthly", priority: "0.9" },
          { path: "/harga", changefreq: "monthly", priority: "0.8" },
          { path: "/faq", changefreq: "monthly", priority: "0.7" },
          { path: "/refund", changefreq: "yearly", priority: "0.5" },
          { path: "/terms", changefreq: "yearly", priority: "0.5" },
          { path: "/trust", changefreq: "yearly", priority: "0.5" },
          { path: "/download", changefreq: "monthly", priority: "0.6" },
          { path: "/auth", changefreq: "yearly", priority: "0.3" },
        ];
        entries.push(...(await catalogEntries()));

        const urls = entries.map((e) =>
          [
            `  <url>`,
            `    <loc>${BASE_URL}${e.path}</loc>`,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ]
            .filter(Boolean)
            .join("\n"),
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});