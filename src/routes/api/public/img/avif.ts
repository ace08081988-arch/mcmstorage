/**
 * Varian AVIF foto produk katalog publik.
 *
 * `/api/public/img/avif?slug=<toko>&item=<uuid>&w=<lebar>`
 *
 * URL ini stabil dan bebas token supaya bisa dipakai di `srcset` + cache
 * lama; endpoint yang menandatangani ulang berkas Storage lalu mengalihkan
 * (302) ke CDN transcoding. Penyedia CDN bisa diganti lewat env tanpa
 * mengubah markup. Path Storage diselesaikan di server — tidak ada URL
 * sembarang yang bisa dititipkan, jadi rute ini bukan proxy terbuka.
 *
 * Bila transcoding tidak dikonfigurasi, respons dialihkan ke varian WebP
 * Storage sehingga `<source type="image/avif">` tidak pernah rusak.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const DETAIL_WIDTHS = [640, 1024, 1600];

const querySchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
  item: z.string().uuid(),
  w: z.coerce.number().int().refine((n) => DETAIL_WIDTHS.includes(n)),
  q: z.coerce.number().int().min(30).max(90).default(55),
});

export const Route = createFileRoute("/api/public/img/avif")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
        if (!parsed.success) return new Response("Parameter tidak valid", { status: 400 });
        const { slug, item, w, q } = parsed.data;

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

        // Sumber untuk CDN: varian WebP berukuran target, bukan berkas asli,
        // supaya CDN tidak perlu mengunduh foto mentah bermegabyte.
        const { data: signed } = await supabaseAdmin.storage
          .from("item-photos")
          .createSignedUrl(row.image_path, 60 * 60 * 24, {
            transform: { width: w, resize: "contain", quality: 82 },
          });
        if (!signed?.signedUrl) return new Response("Tidak ditemukan", { status: 404 });

        const { getAvifCdnTemplate, buildAvifCdnUrl } = await import("@/lib/avif-cdn.server");
        const template = getAvifCdnTemplate();
        const target = template
          ? buildAvifCdnUrl(template, signed.signedUrl, w, q)
          : signed.signedUrl;

        return new Response(null, {
          status: 302,
          headers: {
            location: target,
            // Redirect di-cache pendek karena URL sumber bertanda tangan
            // punya masa berlaku; berkas AVIF sendiri di-cache lama di CDN.
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
