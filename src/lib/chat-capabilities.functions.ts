import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeCapabilities, type ConversationCapabilities } from "@/lib/chat-capabilities";

const idSchema = z.object({ conversationId: z.string().uuid() });

export const getConversationCapabilities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => idSchema.parse(data))
  .handler(async ({ data, context }): Promise<ConversationCapabilities> => {
    const { data: raw, error } = await context.supabase.rpc(
      "chat_conversation_capabilities",
      { _conversation_id: data.conversationId },
    );
    if (error) throw new Error(error.message);
    return normalizeCapabilities(raw);
  });

const blockSchema = z.object({ peerUserId: z.string().uuid() });

export const blockChatPeer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => blockSchema.parse(data))
  .handler(async ({ data, context }) => {
    if (data.peerUserId === context.userId) throw new Error("Tidak bisa memblokir diri sendiri");
    const { error } = await context.supabase
      .from("chat_blocks")
      .upsert(
        { blocker_user_id: context.userId, blocked_user_id: data.peerUserId },
        { onConflict: "blocker_user_id,blocked_user_id", ignoreDuplicates: true },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const unblockChatPeer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => blockSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("chat_blocks")
      .delete()
      .eq("blocker_user_id", context.userId)
      .eq("blocked_user_id", data.peerUserId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });