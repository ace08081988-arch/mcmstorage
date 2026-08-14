/**
 * Pembuatan + pendering panggilan yang authoritative di server.
 *
 * Sebelumnya panggilan hanya di-broadcast lewat Supabase Realtime, jadi
 * ponsel penerima yang aplikasinya tertutup TIDAK pernah berdering.
 * Sekarang server:
 *   1. memverifikasi capability percakapan (SSOT yang sama dgn sendMessage),
 *   2. membuat row `chat_calls` (status `ringing`),
 *   3. mengirim FCM data-message HIGH priority + TTL 35 detik ke callee,
 *   4. Realtime tetap dipakai sebagai fast-path saat aplikasi hidup.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeCapabilities } from "@/lib/chat-capabilities";

const ringSchema = z.object({
  conversationId: z.string().uuid(),
  calleeId: z.string().uuid(),
  kind: z.enum(["audio", "video"]),
});

export const createAndRingCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ringSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: capRaw, error: capErr } = await supabase.rpc(
      "chat_conversation_capabilities",
      { _conversation_id: data.conversationId },
    );
    if (capErr) throw new Error(capErr.message);
    const cap = normalizeCapabilities(capRaw);
    if (!cap.canCall) throw new Error(`chat_capability:${cap.reasonCode}`);
    // Callee TIDAK boleh datang dari klien tanpa verifikasi: hanya peer DM
    // yang dikembalikan capability yang sah.
    if (!cap.peerUserId || cap.peerUserId !== data.calleeId)
      throw new Error("chat_capability:callee_mismatch");
    if (data.calleeId === userId) throw new Error("chat_capability:self_call");

    const { data: call, error } = await supabase
      .from("chat_calls")
      .insert({
        conversation_id: data.conversationId,
        caller_id: userId,
        callee_id: data.calleeId,
        kind: data.kind,
        status: "ringing",
      })
      .select("*")
      .single();
    if (error || !call) throw new Error(error?.message ?? "call_create_failed");

    let pushed = 0;
    let pushConfigured = false;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { notifyUsers } = await import("./push.server");
      const { isFcmConfigured } = await import("./fcm.server");
      pushConfigured = isFcmConfigured();
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", userId)
        .single();
      const callerName = prof?.display_name || "Pengguna";
      const res = await notifyUsers({
        userIds: [data.calleeId],
        excludeUserId: userId,
        payload: {
          title: `Panggilan ${data.kind === "video" ? "video" : "suara"} masuk`,
          body: `${callerName} sedang memanggil…`,
          url: `/chat/${data.conversationId}?call=${call.id}`,
          tag: `call:${call.id}`,
          conversationId: data.conversationId,
          kind: "call",
          callId: call.id,
          callKind: data.kind,
          callerName,
          icon: prof?.avatar_url || undefined,
          requireInteraction: true,
          vibrate: [500, 400, 500, 400, 500],
          timestamp: Date.now(),
        },
      });
      pushed = res.sent;
    } catch (e) {
      // Jangan sembunyikan: panggilan tetap dibuat, tetapi klien harus tahu
      // bahwa dering latar belakang tidak terkirim.
      console.error("[calls] ring push gagal", e);
    }

    return { call, pushed, pushConfigured };
  });

const statusSchema = z.object({ callId: z.string().uuid() });

/** Tandai panggilan `ringing` yang kedaluwarsa menjadi `missed` (idempotent). */
export const timeoutCallIfRinging = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => statusSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("chat_calls")
      .update({ status: "missed", ended_at: new Date().toISOString(), end_reason: "timeout" })
      .eq("id", data.callId)
      .eq("status", "ringing");
    if (error) throw new Error(error.message);
    return { ok: true };
  });