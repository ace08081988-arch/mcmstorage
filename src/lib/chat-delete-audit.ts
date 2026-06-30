import { supabase } from "@/integrations/supabase/client";

export type ChatDeleteAction =
  | "for_me"
  | "for_all"
  | "for_me_bulk"
  | "for_all_bulk"
  | "all_mine";

/**
 * Fire-and-forget audit log entry for a chat delete action.
 * Errors are swallowed so audit failure never blocks the user's action.
 */
export async function logChatDelete(input: {
  conversationId: string;
  action: ChatDeleteAction;
  messageId?: string | null;
  messageIds?: string[];
  count?: number;
}) {
  try {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase.from("chat_delete_audit").insert({
      conversation_id: input.conversationId,
      message_id: input.messageId ?? null,
      message_ids: input.messageIds ?? null,
      action: input.action,
      count: input.count ?? input.messageIds?.length ?? 1,
      actor_user_id: u.user.id,
    });
  } catch {
    /* ignore */
  }
}