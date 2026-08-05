/**
 * Varian AVIF foto produk katalog publik.
 *
 * `/api/public/img/avif?slug=<toko>&item=<uuid>&w=<lebar>`
 *
 * Hanya melayani foto milik toko yang katalog publiknya aktif — path
 * Storage diselesaikan di server, jadi tidak ada URL sembarang yang bisa
 * dititipkan lewat query (mencegah rute ini jadi proxy terbuka).
 * Bila codec gagal, respons dialihkan ke varian WebP asli supaya halaman
 * tetap menampilkan gambar.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const querySchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
  item: z.string().uuid(),
  w: z.coerce.number().int().refine((n) => [640, 1024, 1600].includes(n)),
  q: z.coerce.number().int().min(30).max(80).default(50),
});

const CACHE_CONTROL = "public, max-age=31536000, immutable";

export const Route = createFileRoute("/api/public/img/avif")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
        if (!parsed.success) return new Response("Parameter tidak valid", { status: 400 });
        const { slug, item, w, q } = parsed.data;

        // Cache tepi: hasil encode mahal, jadi disimpan per URL.
        const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
        const cacheKey = new Request(url.toString(), { method: "GET" });
        const hit = await cache?.match(cacheKey);
        if (hit) return hit;

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
          .createSignedUrl(row.image_path, 600, {
            transform: { width: w, resize: "contain", quality: 82 },
          });
        if (!signed?.signedUrl) return new Response("Tidak ditemukan", { status: 404 });

        const upstream = await fetch(signed.signedUrl, {
          headers: { Accept: "image/webp,image/jpeg" },
        });
        if (!upstream.ok) return Response.redirect(signed.signedUrl, 302);

        const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
        const source = await upstream.arrayBuffer();

        try {
          const { transcodeToAvif } = await import("@/lib/avif-transcode.server");
          const avif = await transcodeToAvif(source, contentType, q);
          const response = new Response(avif, {
            headers: {
              "content-type": "image/avif",
              "cache-control": CACHE_CONTROL,
              vary: "Accept",
            },
          });
          await cache?.put(cacheKey, response.clone());
          return response;
        } catch {
          // Fallback aman: kirim berkas sumber apa adanya.
          return new Response(source, {
            headers: { "content-type": contentType, "cache-control": "public, max-age=3600" },
          });
        }
      },
    },
  },
});
