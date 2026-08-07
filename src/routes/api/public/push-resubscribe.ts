import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Pemulihan langganan push saat browser merotasi endpoint
 * (`pushsubscriptionchange`). Service worker tidak punya sesi login, jadi
 * identitas dibuktikan dengan mengetahui endpoint LAMA yang memang tersimpan
 * di database milik seorang pengguna. Endpoint push bersifat rahasia &
 * unguessable, sehingga cukup sebagai bukti kepemilikan untuk memindahkan
 * baris ke endpoint baru. Tidak ada data pengguna yang dikembalikan.
 */
const bodySchema = z.object({
  oldEndpoint: z.string().url().max(2048),
  endpoint: z.string().url().max(2048),
  p256dh: z.string().min(10).max(512),
  auth: z.string().min(10).max(512),
  userAgent: z.string().max(512).optional().nullable(),
});

export const Route = createFileRoute("/api/public/push-resubscribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed;
        try {
          parsed = bodySchema.parse(await request.json());
        } catch {
          return new Response("bad_request", { status: 400 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: existing } = await supabaseAdmin
          .from("push_subscriptions")
          .select("id,user_id")
          .eq("endpoint", parsed.oldEndpoint)
          .maybeSingle();
        if (!existing) return new Response("unknown_subscription", { status: 404 });

        // Bersihkan baris lain yang mungkin sudah memakai endpoint baru.
        await supabaseAdmin
          .from("push_subscriptions")
          .delete()
          .eq("endpoint", parsed.endpoint)
          .neq("id", existing.id);

        const { error } = await supabaseAdmin
          .from("push_subscriptions")
          .update({
            endpoint: parsed.endpoint,
            p256dh: parsed.p256dh,
            auth: parsed.auth,
            user_agent: parsed.userAgent ?? null,
            last_used_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
        if (error) return new Response("update_failed", { status: 500 });

        return Response.json({ ok: true });
      },
    },
  },
});
