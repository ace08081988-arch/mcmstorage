import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ConversationRow = {
  id: string;
  kind: "dm" | "group" | "order";
  title: string | null;
  owner_user_id: string;
  last_message_at: string | null;
  updated_at: string;
};

export type ConversationListItem = ConversationRow & {
  display_title: string;
  last_body: string | null;
  last_at: string | null;
  unread: number;
  member_ids: string[];
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  attachment_path: string | null;
  attachment_mime: string | null;
  attachment_name: string | null;
  attachment_size: number | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
};

export function useMyUserId() {
  return useQuery({
    queryKey: ["auth", "uid"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
    staleTime: 60_000,
  });
}

export function useChatContacts(q: string) {
  return useQuery({
    queryKey: ["chat", "contacts", q],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_chat_contacts", { _q: q || "" });
      if (error) throw error;
      return (data ?? []) as Array<{
        user_id: string;
        display_name: string | null;
        email: string | null;
        kind: string;
        label: string | null;
      }>;
    },
    staleTime: 30_000,
  });
}

export function useStartDm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (partnerId: string) => {
      const { data, error } = await supabase.rpc("start_dm", { _partner: partnerId });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat", "conversations"] }),
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { title: string; memberIds: string[] }) => {
      const { data, error } = await supabase.rpc("create_group", {
        _title: args.title,
        _member_ids: args.memberIds,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat", "conversations"] }),
  });
}

/** Aggregated conversation list with last message and unread count. */
export function useConversations() {
  const qc = useQueryClient();
  const { data: myId } = useMyUserId();

  const query = useQuery({
    queryKey: ["chat", "conversations", myId ?? "_"],
    enabled: !!myId,
    queryFn: async (): Promise<ConversationListItem[]> => {
      const { data: members, error: mErr } = await supabase
        .from("conversation_members")
        .select("conversation_id, last_read_at")
        .eq("user_id", myId!);
      if (mErr) throw mErr;
      const ids = (members ?? []).map((m) => m.conversation_id);
      if (ids.length === 0) return [];
      const lastReadMap = new Map((members ?? []).map((m) => [m.conversation_id, m.last_read_at]));

      const { data: convs, error: cErr } = await supabase
        .from("conversations")
        .select("id, kind, title, owner_user_id, last_message_at, updated_at")
        .in("id", ids)
        .order("last_message_at", { ascending: false, nullsFirst: false });
      if (cErr) throw cErr;

      // All members for these conversations (for DM titles)
      const { data: allMembers } = await supabase
        .from("conversation_members")
        .select("conversation_id, user_id")
        .in("conversation_id", ids);

      const memberMap = new Map<string, string[]>();
      for (const r of allMembers ?? []) {
        const arr = memberMap.get(r.conversation_id) ?? [];
        arr.push(r.user_id);
        memberMap.set(r.conversation_id, arr);
      }

      // Profiles for naming DMs
      const otherIds = new Set<string>();
      for (const c of convs ?? []) {
        if (c.kind === "dm") {
          const m = memberMap.get(c.id) ?? [];
          for (const uid of m) if (uid !== myId) otherIds.add(uid);
        }
      }
      let profileMap = new Map<string, { display_name: string | null; email: string | null }>();
      if (otherIds.size > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, display_name, email")
          .in("id", Array.from(otherIds));
        profileMap = new Map((profs ?? []).map((p) => [p.id, { display_name: p.display_name, email: p.email }]));
      }

      // Last messages
      const { data: lastMsgs } = await supabase
        .from("messages")
        .select("id, conversation_id, body, attachment_name, created_at, sender_id, deleted_at")
        .in("conversation_id", ids)
        .order("created_at", { ascending: false })
        .limit(500);
      const lastByConv = new Map<string, { body: string | null; created_at: string }>();
      const unreadByConv = new Map<string, number>();
      for (const m of lastMsgs ?? []) {
        if (!lastByConv.has(m.conversation_id)) {
          lastByConv.set(m.conversation_id, {
            body: m.deleted_at ? "(pesan dihapus)" : (m.body ?? (m.attachment_name ? `📎 ${m.attachment_name}` : "Lampiran")),
            created_at: m.created_at,
          });
        }
        const lr = lastReadMap.get(m.conversation_id);
        const lrTime = lr ? new Date(lr).getTime() : 0;
        if (m.sender_id !== myId && new Date(m.created_at).getTime() > lrTime) {
          unreadByConv.set(m.conversation_id, (unreadByConv.get(m.conversation_id) ?? 0) + 1);
        }
      }

      return (convs ?? []).map((c) => {
        let display = c.title ?? "";
        if (c.kind === "dm") {
          const m = memberMap.get(c.id) ?? [];
          const other = m.find((u) => u !== myId);
          const p = other ? profileMap.get(other) : null;
          display = p?.display_name || p?.email || "Percakapan";
        } else if (!display) {
          display = c.kind === "order" ? "Diskusi pesanan" : "Grup";
        }
        const last = lastByConv.get(c.id);
        return {
          ...(c as ConversationRow),
          display_title: display,
          last_body: last?.body ?? null,
          last_at: last?.created_at ?? c.last_message_at,
          unread: unreadByConv.get(c.id) ?? 0,
          member_ids: memberMap.get(c.id) ?? [],
        };
      });
    },
  });

  // Realtime: refresh on any message or membership change
  useEffect(() => {
    if (!myId) return;
    const ch = supabase
      .channel(`chat-list:${myId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
        qc.invalidateQueries({ queryKey: ["chat", "unread-total"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members", filter: `user_id=eq.${myId}` }, () => {
        qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [myId, qc]);

  return query;
}

export function useUnreadTotal() {
  const { data } = useConversations();
  return useMemo(() => (data ?? []).reduce((acc, c) => acc + c.unread, 0), [data]);
}

export function useConversationMessages(conversationId: string | undefined) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["chat", "messages", conversationId],
    enabled: !!conversationId,
    queryFn: async (): Promise<MessageRow[]> => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId!)
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as MessageRow[];
    },
  });

  useEffect(() => {
    if (!conversationId) return;
    const ch = supabase
      .channel(`chat-msgs:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          qc.setQueryData<MessageRow[]>(["chat", "messages", conversationId], (prev) => {
            const next = (prev ?? []).slice();
            const incoming = payload.new as MessageRow;
            if (!next.some((m) => m.id === incoming.id)) next.push(incoming);
            next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
            return next;
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          qc.setQueryData<MessageRow[]>(["chat", "messages", conversationId], (prev) =>
            (prev ?? []).map((m) => (m.id === (payload.new as MessageRow).id ? (payload.new as MessageRow) : m)),
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [conversationId, qc]);

  return query;
}

export async function getConversationMeta(conversationId: string) {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, kind, title, owner_user_id, last_message_at")
    .eq("id", conversationId)
    .single();
  if (error) throw error;
  return data;
}

export async function markConversationRead(conversationId: string, userId: string) {
  await supabase
    .from("conversation_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
}

/**
 * Hard-delete a single message I sent. Removes the row for both sides AND
 * any attachment object from storage so nothing remains. RLS only lets the
 * sender (or conversation owner) call this.
 */
export function useDeleteMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (msg: Pick<MessageRow, "id" | "attachment_path">) => {
      if (msg.attachment_path) {
        await supabase.storage.from("chat-attachments").remove([msg.attachment_path]);
      }
      const { error } = await supabase.from("messages").delete().eq("id", msg.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat", "messages", conversationId] });
      qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
    },
  });
}

/**
 * Hard-delete every message I sent in this conversation, including their
 * attachments. Other members keep their own messages. Leaves the conversation
 * itself intact (since the other side might keep using it).
 */
export function useDeleteAllMyMessages(conversationId: string) {
  const qc = useQueryClient();
  const { data: myId } = useMyUserId();
  return useMutation({
    mutationFn: async () => {
      if (!myId) throw new Error("not_signed_in");
      const { data: mine, error: selErr } = await supabase
        .from("messages")
        .select("id, attachment_path")
        .eq("conversation_id", conversationId)
        .eq("sender_id", myId);
      if (selErr) throw selErr;
      const paths = (mine ?? []).map((m) => m.attachment_path).filter((p): p is string => !!p);
      if (paths.length > 0) {
        await supabase.storage.from("chat-attachments").remove(paths);
      }
      const { error } = await supabase
        .from("messages")
        .delete()
        .eq("conversation_id", conversationId)
        .eq("sender_id", myId);
      if (error) throw error;
      return mine?.length ?? 0;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat", "messages", conversationId] });
      qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
    },
  });
}