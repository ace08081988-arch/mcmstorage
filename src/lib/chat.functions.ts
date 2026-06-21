import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const sendSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().min(1).max(4000).optional(),
  attachmentPath: z.string().max(512).optional(),
  attachmentMime: z.string().max(120).optional(),
  attachmentName: z.string().max(255).optional(),
  attachmentSize: z.number().int().min(0).max(50 * 1024 * 1024).optional(),
}).refine((d) => !!d.body || !!d.attachmentPath, { message: "Pesan kosong" });

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => sendSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Insert (RLS akan memastikan pengirim adalah anggota percakapan)
    const { data: msg, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: data.conversationId,
        sender_id: userId,
        body: data.body ?? null,
        attachment_path: data.attachmentPath ?? null,
        attachment_mime: data.attachmentMime ?? null,
        attachment_name: data.attachmentName ?? null,
        attachment_size: data.attachmentSize ?? null,
      })
      .select("id, conversation_id, sender_id, body, attachment_name, created_at")
      .single();
    if (error || !msg) throw new Error(error?.message ?? "send_failed");

    // Kirim push ke anggota lain (best-effort; tidak mempengaruhi response)
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { notifyUsers } = await import("./push.server");

      const [{ data: members }, { data: conv }, { data: prof }] = await Promise.all([
        supabaseAdmin
          .from("conversation_members")
          .select("user_id")
          .eq("conversation_id", data.conversationId),
        supabaseAdmin
          .from("conversations")
          .select("kind, title")
          .eq("id", data.conversationId)
          .single(),
        supabaseAdmin
          .from("profiles")
          .select("display_name, email")
          .eq("id", userId)
          .single(),
      ]);

      const userIds = (members ?? []).map((m) => m.user_id).filter(Boolean) as string[];
      const senderName = prof?.display_name || prof?.email || "Pengguna";
      const isGroup = conv?.kind === "group" || conv?.kind === "order";
      const title = isGroup
        ? `${conv?.title ?? "Grup"} · ${senderName}`
        : senderName;
      const preview = data.body
        ? data.body.slice(0, 140)
        : data.attachmentName
          ? `📎 ${data.attachmentName}`
          : "Lampiran";
      await notifyUsers({
        userIds,
        excludeUserId: userId,
        payload: {
          title,
          body: preview,
          url: `/chat/${data.conversationId}`,
          tag: `conv:${data.conversationId}`,
          conversationId: data.conversationId,
        },
      });
    } catch (e) {
      console.error("[chat] push dispatch failed", e);
    }

    return { id: msg.id };
  });