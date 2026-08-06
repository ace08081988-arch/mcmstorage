/**
 * Kartu OG foto produk katalog publik.
 *
 * `/api/public/img/og?slug=<toko>&item=<uuid>`
 *
 * URL stabil & bebas token supaya crawler sosial (WhatsApp, X, Facebook,
 * Telegram) bisa mengambilnya kapan pun — endpoint menandatangani ulang
 * berkas Storage lalu mengalihkan (302) ke varian 1200×630. Path Storage
 * diselesaikan di server, jadi rute ini bukan proxy terbuka.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { CATALOG_OG_HEIGHT, CATALOG_OG_WIDTH } from "@/lib/catalog-og-image";

const querySchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
  item: z.string().uuid(),
});

export const Route = createFileRoute("/api/public/img/og")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
        if (!parsed.success) return new Response("Parameter tidak valid", { status: 400 });
        const { slug, item } = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: settings } = await supabaseAdmin
          .from("public_catalog_settings")
          .select("user_id, enabled")
          .eq("slug", slug)
          .maybeSingle();
        if (!settings?.enabled) return new Response("Tidak ditemukan", { status: 404 });

        const { data: row } = await supabaseAdmin
          .from("warehouse_items")
          .select("image_path")
          .eq("user_id", settings.user_id)
          .eq("id", item)
          .maybeSingle();
        if (!row?.image_path) return new Response("Tidak ditemukan", { status: 404 });

        const { data: signed } = await supabaseAdmin.storage
          .from("item-photos")
          .createSignedUrl(row.image_path, 60 * 60 * 24, {
            transform: {
              width: CATALOG_OG_WIDTH,
              height: CATALOG_OG_HEIGHT,
              resize: "cover",
              quality: 80,
              // Format asli: crawler tidak selalu mengirim Accept yang benar,
              // dan og:image:type harus cocok dengan berkas yang dikirim.
              format: "origin",
            },
          });
        if (!signed?.signedUrl) return new Response("Tidak ditemukan", { status: 404 });

        return new Response(null, {
          status: 302,
          headers: {
            location: signed.signedUrl,
            // URL tujuan bertanda tangan dan berumur pendek, jadi redirect-nya
            // di-cache singkat; cache-buster `?v=` yang menangani foto baru.
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
