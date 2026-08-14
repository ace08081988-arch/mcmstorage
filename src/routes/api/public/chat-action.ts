/**
 * Endpoint aksi notifikasi native (Balas / Tandai dibaca / Tolak panggilan).
 *
 * Dipanggil oleh Android `AceNotificationActionReceiver` saat aplikasi tidak
 * hidup. Autentikasi memakai token aksi bertanda tangan HMAC yang dikirim di
 * payload data FCM (lihat `src/lib/push-action-token.ts`) — TIDAK ada kunci
 * Supabase apa pun di dalam APK.
 *
 * Setelah token valid, server tetap memverifikasi ulang capability percakapan
 * dan mencatat nonce sekali-pakai untuk mencegah replay.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  verifyPushActionToken,
  type PushActionName,
} from "@/lib/push-action-token";
import { normalizeCapabilities } from "@/lib/chat-capabilities";

const bodySchema = z.object({
  token: z.string().min(20).max(4096),
  action: z.enum(["reply", "mark-read", "call-decline"]),
  text: z.string().min(1).max(4000).optional(),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/chat-action")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed: z.infer<typeof bodySchema>;
        try {
          parsed = bodySchema.parse(await request.json());
        } catch {
          return json({ ok: false, error: "invalid_request" }, 400);
        }

        const { pushActionSecret } = await import("@/lib/push-ownership.server");
        const secret = pushActionSecret();
        if (!secret) return json({ ok: false, error: "not_configured" }, 503);

        const verified = await verifyPushActionToken(parsed.token, secret, {
          action: parsed.action as PushActionName,
        });
        if (!verified.ok) return json({ ok: false, error: verified.reason }, 401);
        const { claims } = verified;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Replay guard: nonce hanya boleh dipakai sekali.
        const { error: nonceErr } = await supabaseAdmin.from("push_action_nonces").insert({
          nonce: claims.nonce,
          user_id: claims.uid,
          action: claims.act,
          expires_at: new Date(claims.exp).toISOString(),
        });
        if (nonceErr) return json({ ok: false, error: "replayed" }, 409);

        // Verifikasi ulang izin nyata (blokir/keanggotaan bisa berubah).
        const { data: capRaw, error: capErr } = await supabaseAdmin.rpc(
          "chat_conversation_capabilities",
          { _conversation_id: claims.cid, _user_id: claims.uid },
        );
        if (capErr) return json({ ok: false, error: "capability_failed" }, 500);
        const cap = normalizeCapabilities(capRaw);

        if (parsed.action === "reply") {
          if (!cap.canSend) return json({ ok: false, error: cap.reasonCode }, 403);
          if (!parsed.text) return json({ ok: false, error: "empty_reply" }, 400);
          const { data: msg, error } = await supabaseAdmin
            .from("messages")
            .insert({
              conversation_id: claims.cid,
              sender_id: claims.uid,
              body: parsed.text,
            })
            .select("id")
            .single();
          if (error || !msg) return json({ ok: false, error: "send_failed" }, 500);
          await supabaseAdmin
            .from("conversation_members")
            .update({ last_read_at: new Date().toISOString() })
            .eq("conversation_id", claims.cid)
            .eq("user_id", claims.uid);
          // Balasan dari notifikasi harus tetap membangunkan lawan bicara —
          // jalur ini tidak melewati `sendMessage`, jadi push dikirim di sini.
          try {
            const { notifyUsers } = await import("@/lib/push.server");
            const [{ data: members }, { data: prof }] = await Promise.all([
              supabaseAdmin
                .from("conversation_members")
                .select("user_id")
                .eq("conversation_id", claims.cid),
              supabaseAdmin
                .from("profiles")
                .select("display_name, avatar_url")
                .eq("id", claims.uid)
                .single(),
            ]);
            const senderName = prof?.display_name || "Pengguna";
            await notifyUsers({
              userIds: (members ?? []).map((m) => m.user_id).filter(Boolean) as string[],
              excludeUserId: claims.uid,
              payload: {
                title: senderName,
                body: parsed.text.slice(0, 140),
                url: `/chat/${claims.cid}`,
                tag: `conv:${claims.cid}`,
                conversationId: claims.cid,
                messageId: msg.id,
                kind: "chat",
                senderName,
                senderId: claims.uid,
                icon: prof?.avatar_url || undefined,
              },
            });
          } catch (e) {
            console.error("[chat-action] push balasan gagal", e);
          }
          return json({ ok: true, messageId: msg.id });
        }

        if (parsed.action === "mark-read") {
          if (!cap.canRead) return json({ ok: false, error: cap.reasonCode }, 403);
          const { error } = await supabaseAdmin
            .from("conversation_members")
            .update({ last_read_at: new Date().toISOString() })
            .eq("conversation_id", claims.cid)
            .eq("user_id", claims.uid);
          if (error) return json({ ok: false, error: "update_failed" }, 500);
          return json({ ok: true });
        }

        // call-decline
        if (!claims.callId) return json({ ok: false, error: "missing_call" }, 400);
        if (!cap.canRead) return json({ ok: false, error: cap.reasonCode }, 403);
        const { data: call, error: callErr } = await supabaseAdmin
          .from("chat_calls")
          .select("id, status, callee_id, caller_id")
          .eq("id", claims.callId)
          .maybeSingle();
        if (callErr) return json({ ok: false, error: "call_lookup_failed" }, 500);
        if (!call) return json({ ok: false, error: "call_not_found" }, 404);
        if (call.callee_id !== claims.uid && call.caller_id !== claims.uid)
          return json({ ok: false, error: "not_participant" }, 403);
        // Idempotent: panggilan yang sudah selesai tidak diubah lagi.
        if (call.status !== "ringing") return json({ ok: true, status: call.status });
        const { error: updErr } = await supabaseAdmin
          .from("chat_calls")
          .update({
            status: "declined",
            ended_at: new Date().toISOString(),
            end_reason: "declined_from_notification",
          })
          .eq("id", claims.callId)
          .eq("status", "ringing");
        if (updErr) return json({ ok: false, error: "update_failed" }, 500);
        return json({ ok: true, status: "declined" });
      },
      OPTIONS: async () => new Response(null, { status: 204 }),
    },
  },
});