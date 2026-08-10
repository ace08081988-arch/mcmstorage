import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  clientKeyFromRequest,
  rateLimit,
  rateLimitedResponse,
  readBoundedJson,
} from "@/lib/edge-guard";
import { verifyPushOwnershipToken } from "@/lib/push-ownership";

/**
 * Pemulihan langganan push saat browser merotasi endpoint
 * (`pushsubscriptionchange`). Service worker tidak punya sesi login, jadi
 * kepemilikan dibuktikan dengan token bertanda tangan HMAC yang diterbitkan
 * server saat langganan didaftarkan oleh pengguna yang login.
 *
 * Endpoint lama saja TIDAK cukup sebagai otorisasi (bisa bocor lewat log),
 * jadi token wajib. Replay dicegah karena token terikat endpoint lama; sekali
 * dirotasi, baris endpoint lama tidak ada lagi.
 */
const bodySchema = z.object({
  oldEndpoint: z.string().url().max(2048),
  endpoint: z.string().url().max(2048),
  p256dh: z.string().min(10).max(512),
  auth: z.string().min(10).max(512),
  userAgent: z.string().max(512).optional().nullable(),
  ownershipToken: z.string().min(20).max(2048),
});

export const Route = createFileRoute("/api/public/push-resubscribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rl = rateLimit(clientKeyFromRequest(request, "push-resub"), {
          limit: 20,
          windowMs: 60_000,
        });
        if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSeconds);

        const body = await readBoundedJson(request, 8 * 1024);
        if (!body.ok) return new Response(body.error, { status: body.error === "too_large" ? 413 : 400 });
        const parsedBody = bodySchema.safeParse(body.value);
        if (!parsedBody.success) return new Response("bad_request", { status: 400 });
        const parsed = parsedBody.data;

        const { pushOwnershipSecret } = await import("@/lib/push-ownership.server");
        const secret = pushOwnershipSecret();
        // Fail-closed: tanpa kunci server, tidak ada rotasi yang diterima.
        if (!secret) return new Response("ownership_unavailable", { status: 503 });

        const verified = await verifyPushOwnershipToken(parsed.ownershipToken, secret, {
          endpoint: parsed.oldEndpoint,
        });
        if (!verified.ok) return new Response("forbidden", { status: 403 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: existing } = await supabaseAdmin
          .from("push_subscriptions")
          .select("id,user_id")
          .eq("endpoint", parsed.oldEndpoint)
          .maybeSingle();
        if (!existing) return new Response("unknown_subscription", { status: 404 });
        // Token harus milik pemilik baris — bukan sekadar tanda tangan valid.
        if (existing.user_id !== verified.claims.userId)
          return new Response("forbidden", { status: 403 });

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
