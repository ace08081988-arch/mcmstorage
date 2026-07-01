import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { messagePreviewText } from "@/lib/chat-deleted";

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
  last_sender_id: string | null;
  last_delivered: boolean;
  last_read: boolean;
  unread: number;
  member_ids: string[];
  pinned_at: string | null;
  archived_at: string | null;
  muted_until: string | null;
  cleared_at: string | null;
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
  reply_to_id?: string | null;
  attachment_duration_sec?: number | null;
  starred_by?: string[] | null;
  pinned_at?: string | null;
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
        phone: string | null;
        invite_code: string | null;
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
      if (error) {
        // `can_chat` sekarang mengharuskan pertemanan diterima dulu.
        if (/not_allowed|forbidden|permission/i.test(error.message)) {
          const err = new Error(
            "Belum bisa chat — permintaan pertemanan belum diterima. Silakan tunggu konfirmasi teman.",
          );
          (err as Error & { code?: string }).code = "friend_gate";
          throw err;
        }
        throw error;
      }
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
  const channelInstanceRef = useRef(`chat-list-${Math.random().toString(36).slice(2)}`);

  const cacheKey = myId ? `chat:conversations:${myId}` : null;
  const cached = useMemo<ConversationListItem[] | undefined>(() => {
    if (!cacheKey || typeof window === "undefined") return undefined;
    try {
      const raw = window.localStorage.getItem(cacheKey);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as { data?: ConversationListItem[] };
      return Array.isArray(parsed?.data) ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }, [cacheKey]);

  const query = useQuery({
    queryKey: ["chat", "conversations", myId ?? "_"],
    enabled: !!myId,
    initialData: cached,
    initialDataUpdatedAt: cached ? 0 : undefined,
    retry: (failureCount, error) => {
      // Don't retry on auth/permission errors — those won't fix themselves.
      const code = (error as { code?: string } | null)?.code;
      const status = (error as { status?: number } | null)?.status;
      if (code === "PGRST301" || status === 401 || status === 403) return false;
      return failureCount < 4;
    },
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
    refetchOnReconnect: true,
    queryFn: async (): Promise<ConversationListItem[]> => {
      const { data: members, error: mErr } = await supabase
        .from("conversation_members")
        .select("conversation_id, last_read_at, pinned_at, archived_at, notifications_muted_until, cleared_at")
        .eq("user_id", myId!);
      if (mErr) throw mErr;
      const ids = (members ?? []).map((m) => m.conversation_id);
      if (ids.length === 0) return [];
      const lastReadMap = new Map((members ?? []).map((m) => [m.conversation_id, m.last_read_at]));
      const mineMemberMap = new Map(
        (members ?? []).map((m) => [
          m.conversation_id,
          {
            pinned_at: (m as { pinned_at?: string | null }).pinned_at ?? null,
            archived_at: (m as { archived_at?: string | null }).archived_at ?? null,
            muted_until: (m as { notifications_muted_until?: string | null }).notifications_muted_until ?? null,
            cleared_at: (m as { cleared_at?: string | null }).cleared_at ?? null,
          },
        ]),
      );

      const { data: convs, error: cErr } = await supabase
        .from("conversations")
        .select("id, kind, title, owner_user_id, last_message_at, updated_at")
        .in("id", ids)
        .order("last_message_at", { ascending: false, nullsFirst: false });
      if (cErr) throw cErr;

      // All members + their last_read_at (for DM titles & read receipts)
      const { data: allMembers } = await supabase
        .from("conversation_members")
        .select("conversation_id, user_id, last_read_at")
        .in("conversation_id", ids);

      const memberMap = new Map<string, string[]>();
      // per conversation: min(last_read_at) across other members (for ticks)
      const othersMinReadMap = new Map<string, number | null>();
      for (const r of allMembers ?? []) {
        const arr = memberMap.get(r.conversation_id) ?? [];
        arr.push(r.user_id);
        memberMap.set(r.conversation_id, arr);
        if (r.user_id !== myId) {
          const cur = othersMinReadMap.get(r.conversation_id);
          const t = r.last_read_at ? new Date(r.last_read_at).getTime() : 0;
          if (cur === undefined) othersMinReadMap.set(r.conversation_id, t);
          else if (cur !== null && t < cur) othersMinReadMap.set(r.conversation_id, t);
        }
      }

      // Profiles for naming DMs
      const otherIds = new Set<string>();
      for (const c of convs ?? []) {
        if (c.kind === "dm") {
          const m = memberMap.get(c.id) ?? [];
          for (const uid of m) if (uid !== myId) otherIds.add(uid);
        }
      }
      let profileMap = new Map<string, { display_name: string | null; phone: string | null; email: string | null }>();
      if (otherIds.size > 0) {
        try {
          const { data: profs, error: pErr } = await supabase.rpc("get_chat_member_profiles", {
            _user_ids: Array.from(otherIds),
          });
          if (pErr) throw pErr;
          profileMap = new Map(
            ((profs ?? []) as Array<{ id: string; display_name: string | null; phone: string | null; email: string | null }>).map(
              (p) => [p.id, { display_name: p.display_name, phone: p.phone, email: p.email }],
            ),
          );
        } catch (err) {
          // Non-fatal: fall back to generic DM titles so the list still renders.
          console.warn("[chat] get_chat_member_profiles failed:", err);
        }
      }

      // Contact aliases from address_book (nama kontak lokal) — prefer over profile display_name.
      const aliasByUser = new Map<string, string>();
      const aliasByPhone = new Map<string, string>();
      const aliasByEmail = new Map<string, string>();
      if (otherIds.size > 0) {
        try {
          const idsArr = Array.from(otherIds);
          const phones = idsArr
            .map((u) => profileMap.get(u)?.phone)
            .filter((p): p is string => !!p);
          const emails = idsArr
            .map((u) => profileMap.get(u)?.email?.toLowerCase().trim())
            .filter((e): e is string => !!e);
          const orParts: string[] = [];
          orParts.push(`linked_user_id.in.(${idsArr.join(",")})`);
          if (phones.length) orParts.push(`phone_norm.in.(${phones.map((p) => p.replace(/[^\d+]/g, "")).join(",")})`);
          if (emails.length) orParts.push(`email_norm.in.(${emails.join(",")})`);
          const { data: aliases } = await supabase
            .from("address_book")
            .select("name, linked_user_id, phone_norm, email_norm")
            .or(orParts.join(","));
          for (const a of (aliases ?? []) as Array<{ name: string | null; linked_user_id: string | null; phone_norm: string | null; email_norm: string | null }>) {
            if (!a.name) continue;
            if (a.linked_user_id) aliasByUser.set(a.linked_user_id, a.name);
            if (a.phone_norm) aliasByPhone.set(a.phone_norm, a.name);
            if (a.email_norm) aliasByEmail.set(a.email_norm, a.name);
          }
        } catch (err) {
          console.warn("[chat] address_book alias lookup failed:", err);
        }
      }

      // Last messages
      const { data: lastMsgs } = await supabase
        .from("messages")
        .select("id, conversation_id, body, attachment_name, created_at, sender_id, deleted_at")
        .in("conversation_id", ids)
        .order("created_at", { ascending: false })
        .limit(500);
      // Hidden-for-me: exclude these messages from unread counts AND from the
      // "last message" preview so deleting a message immediately shrinks the
      // badge and refreshes the row snippet.
      const { data: hiddenRows } = await supabase
        .from("message_hidden")
        .select("message_id")
        .eq("user_id", myId!);
      const hiddenSet = new Set((hiddenRows ?? []).map((r) => r.message_id as string));
      const clearedAtMap = new Map<string, number>(
        Array.from(mineMemberMap.entries()).map(([cid, m]) => [
          cid,
          m.cleared_at ? new Date(m.cleared_at).getTime() : 0,
        ]),
      );
      const lastByConv = new Map<string, { body: string | null; created_at: string; sender_id: string }>();
      const unreadByConv = new Map<string, number>();
      for (const m of lastMsgs ?? []) {
        if (hiddenSet.has(m.id)) continue;
        // Skip messages older-or-equal to the caller's cleared_at watermark —
        // "Bersihkan percakapan" hides the entire history for the caller.
        const cAt = clearedAtMap.get(m.conversation_id) ?? 0;
        if (cAt && new Date(m.created_at).getTime() <= cAt) continue;
        if (!lastByConv.has(m.conversation_id)) {
          lastByConv.set(m.conversation_id, {
            body: messagePreviewText(m) || "Lampiran",
            created_at: m.created_at,
            sender_id: m.sender_id,
          });
        }
        const lr = lastReadMap.get(m.conversation_id);
        const lrTime = lr ? new Date(lr).getTime() : 0;
        if (m.sender_id !== myId && new Date(m.created_at).getTime() > lrTime) {
          unreadByConv.set(m.conversation_id, (unreadByConv.get(m.conversation_id) ?? 0) + 1);
        }
      }

      const items = (convs ?? []).map((c) => {
        let display = c.title ?? "";
        if (c.kind === "dm") {
          const m = memberMap.get(c.id) ?? [];
          const other = m.find((u) => u !== myId);
          const p = other ? profileMap.get(other) : null;
          const alias =
            (other && aliasByUser.get(other)) ||
            (p?.phone && aliasByPhone.get(p.phone.replace(/[^\d+]/g, ""))) ||
            (p?.email && aliasByEmail.get(p.email.toLowerCase().trim())) ||
            null;
          display = alias || p?.display_name || p?.phone || p?.email || "Kontak";
        } else if (!display) {
          display = c.kind === "order" ? "Diskusi pesanan" : "Grup";
        }
        const last = lastByConv.get(c.id);
        const othersMinRead = othersMinReadMap.get(c.id);
        const lastSentMs = last ? new Date(last.created_at).getTime() : 0;
        const isMine = !!last && last.sender_id === myId;
        const delivered = isMine; // inserted in DB
        const read =
          isMine &&
          othersMinRead !== undefined &&
          othersMinRead !== null &&
          othersMinRead >= lastSentMs;
        const mine = mineMemberMap.get(c.id);
        return {
          ...(c as ConversationRow),
          display_title: display,
          last_body: last?.body ?? null,
          last_at: last?.created_at ?? c.last_message_at,
          last_sender_id: last?.sender_id ?? null,
          last_delivered: delivered,
          last_read: read,
          unread: unreadByConv.get(c.id) ?? 0,
          member_ids: memberMap.get(c.id) ?? [],
          pinned_at: mine?.pinned_at ?? null,
          archived_at: mine?.archived_at ?? null,
          muted_until: mine?.muted_until ?? null,
          cleared_at: mine?.cleared_at ?? null,
        };
      });
      // Hide conversations the user cleared that have no newer activity.
      // As soon as a peer sends a fresh message (or the user starts chatting
      // again), lastByConv gets an entry and the row reappears automatically.
      return items.filter((c) => {
        if (!c.cleared_at) return true;
        if (c.pinned_at) return true; // keep pinned rows visible
        if (lastByConv.has(c.id)) return true;
        return false;
      });
    },
  });

  // Persist successful results so the chat list can be shown from cache when
  // the RPC fails (offline / poor network).
  useEffect(() => {
    if (!cacheKey || typeof window === "undefined") return;
    if (!query.isSuccess || !query.data) return;
    try {
      window.localStorage.setItem(
        cacheKey,
        JSON.stringify({ data: query.data, savedAt: Date.now() }),
      );
    } catch {
      /* ignore quota errors */
    }
  }, [cacheKey, query.isSuccess, query.data, query.dataUpdatedAt]);

  // Realtime: refresh on any message or membership change
  useEffect(() => {
    if (!myId) return;
    const refreshChat = () => {
      qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
      qc.invalidateQueries({ queryKey: ["chat", "unread-total"] });
    };
    const topic = `chat-list:${myId}:${channelInstanceRef.current}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    let ch: ReturnType<typeof supabase.channel> | null = null;
    try {
      ch = supabase
        .channel(topic)
        .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, refreshChat)
        .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members", filter: `user_id=eq.${myId}` }, refreshChat)
        .subscribe();
    } catch (err) {
      // Realtime should never break opening the chat page. The query still
      // refetches on focus/online and manual refresh if live subscription fails.
      console.warn("[chat] realtime chat-list subscription skipped:", err);
      return;
    }
    return () => {
      if (ch) void supabase.removeChannel(ch);
    };
  }, [myId, qc]);

  // Re-sync on network/visibility changes so badge counts stay accurate
  // after offline → online or tab refocus (realtime may have missed events).
  useEffect(() => {
    if (!myId) return;
    const resync = () => {
      qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
      qc.invalidateQueries({ queryKey: ["chat", "unread-total"] });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") resync();
    };
    window.addEventListener("online", resync);
    window.addEventListener("focus", resync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", resync);
      window.removeEventListener("focus", resync);
      document.removeEventListener("visibilitychange", onVisible);
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
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const oldId = (payload.old as { id?: string }).id;
          if (!oldId) return;
          qc.setQueryData<MessageRow[]>(["chat", "messages", conversationId], (prev) =>
            (prev ?? []).filter((m) => m.id !== oldId),
          );
          qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
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
      // Soft-delete: keep the row so both sides see a "(pesan dihapus)"
      // tombstone, and so realtime UPDATE syncs the change to the other
      // participant's conversation in real time. Server-side function also
      // enforces sender/owner permission.
      const { data, error } = await supabase.rpc("message_delete_for_all", { _msg: msg.id });
      if (error) throw error;
      const path = (typeof data === "string" ? data : msg.attachment_path) || null;
      if (path) {
        // Best-effort attachment cleanup; ignore failure so UI still reflects delete.
        await supabase.storage.from("chat-attachments").remove([path]).catch(() => undefined);
      }
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
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("message_delete_all_mine", { _conv: conversationId });
      if (error) throw error;
      const paths = ((data ?? []) as string[]).filter((p): p is string => !!p);
      if (paths.length > 0) {
        await supabase.storage.from("chat-attachments").remove(paths).catch(() => undefined);
      }
      return paths.length;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat", "messages", conversationId] });
      qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
    },
  });
}

/** Add a contact (already chat-eligible via can_chat) into a group I own. */
export function useAddGroupMember(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("add_group_member", {
        _conv: conversationId,
        _user: userId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat", "conv-members", conversationId] });
      qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
    },
  });
}

/**
 * Remove a member from a group. RLS `cm_delete_self_or_owner` lets either
 * the member themselves or the conversation owner do this.
 */
export function useRemoveGroupMember(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from("conversation_members")
        .delete()
        .eq("conversation_id", conversationId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat", "conv-members", conversationId] });
      qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
    },
  });
}

/** Rename a group/order conversation. RLS only lets the owner update. */
export function useRenameConversation(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (title: string) => {
      const t = title.trim();
      if (t.length === 0) throw new Error("Nama tidak boleh kosong");
      if (t.length > 80) throw new Error("Nama maksimal 80 karakter");
      const { error } = await supabase
        .from("conversations")
        .update({ title: t })
        .eq("id", conversationId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat", "conv-meta", conversationId] });
      qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
    },
  });
}

// ---------------- Reactions ----------------
export type Reaction = { message_id: string; user_id: string; emoji: string };

export function useMessageReactions(conversationId: string | undefined, messageIds: string[]) {
  const qc = useQueryClient();
  const ids = messageIds.slice().sort().join(",");
  const query = useQuery({
    queryKey: ["chat", "reactions", conversationId, ids],
    enabled: !!conversationId && messageIds.length > 0,
    queryFn: async (): Promise<Reaction[]> => {
      const { data, error } = await supabase
        .from("message_reactions")
        .select("message_id, user_id, emoji")
        .in("message_id", messageIds);
      if (error) throw error;
      return (data ?? []) as Reaction[];
    },
    staleTime: 5_000,
  });
  useEffect(() => {
    if (!conversationId) return;
    const ch = supabase
      .channel(`chat-reactions:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reactions" },
        () => qc.invalidateQueries({ queryKey: ["chat", "reactions", conversationId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [conversationId, qc]);
  return query;
}

export function useReact(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { messageId: string; emoji: string; on: boolean }) => {
      const { error } = await supabase.rpc("message_react", {
        _msg: v.messageId,
        _emoji: v.emoji,
        _on: v.on,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat", "reactions", conversationId] }),
  });
}

// ---------------- Edit / Hide-for-me ----------------
export function useEditMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { messageId: string; body: string }) => {
      const { error } = await supabase.rpc("message_edit", { _msg: v.messageId, _body: v.body });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat", "messages", conversationId] }),
  });
}

export function useHideMessageForMe(conversationId: string) {
  const qc = useQueryClient();
  const { data: myId } = useMyUserId();
  return useMutation({
    mutationFn: async (messageId: string) => {
      const { error } = await supabase.rpc("message_hide_for_me", { _msg: messageId });
      if (error) throw error;
    },
    onMutate: async (messageId: string) => {
      // Wrap in try/catch: any unexpected exception here would flip the
      // mutation to error and surface a false "Gagal menghapus pesan" toast
      // even though the RPC hasn't run yet.
      try {
        await qc.cancelQueries({ queryKey: ["chat", "hidden"] });
        const prev = qc.getQueryData<Set<string>>(["chat", "hidden"]);
        const next = new Set(prev ?? []);
        next.add(messageId);
        qc.setQueryData<Set<string>>(["chat", "hidden"], next);

        const prevConvs = qc.getQueriesData<ConversationListItem[]>({ queryKey: ["chat", "conversations"] });
        const msgs = qc.getQueryData<MessageRow[]>(["chat", "messages", conversationId]);
        const hidden = msgs?.find((m) => m.id === messageId);
        if (hidden && myId && hidden.sender_id !== myId) {
          for (const [key, list] of prevConvs) {
            if (!Array.isArray(list)) continue;
            const patched = list.map((c) => {
              if (c.id !== conversationId) return c;
              const nextUnread = Math.max(0, (c.unread ?? 0) - 1);
              const isLastPreview = hidden.created_at === c.last_at;
              return {
                ...c,
                unread: nextUnread,
                last_body: isLastPreview ? null : c.last_body,
              };
            });
            qc.setQueryData(key, patched);
          }
        }
        return { prev, prevConvs };
      } catch (err) {
        console.warn("[useHideMessageForMe] onMutate optimistic patch failed:", err);
        return { prev: undefined, prevConvs: [] as ReturnType<typeof qc.getQueriesData<ConversationListItem[]>> };
      }
    },
    onError: (e, messageId, ctx) => {
      console.error("[useHideMessageForMe] RPC failed", { messageId, error: e });
      // Rollback: restore previous set, or remove the optimistic entry if there
      // was no prior cache to snapshot.
      if (ctx && "prev" in ctx) {
        if (ctx.prev) {
          qc.setQueryData(["chat", "hidden"], ctx.prev);
        } else {
          const current = qc.getQueryData<Set<string>>(["chat", "hidden"]);
          if (current) {
            const rolled = new Set(current);
            rolled.delete(messageId);
            qc.setQueryData<Set<string>>(["chat", "hidden"], rolled);
          }
        }
      }
      // Roll back conversation badge patches
      if (ctx && "prevConvs" in ctx && ctx.prevConvs) {
        for (const [key, list] of ctx.prevConvs) {
          qc.setQueryData(key, list);
        }
      }
      // Extract Supabase Postgrest error shape too, not just Error instances.
      const anyE = e as { message?: string; code?: string; details?: string } | undefined;
      const description =
        anyE?.message ||
        anyE?.details ||
        (typeof e === "string" ? e : "Coba lagi beberapa saat.");
      toast.error("Gagal menghapus pesan", { description });
    },
    onSuccess: (_data, messageId) => {
      // Undo: DELETE the message_hidden row for this user. RLS scopes it to
      // (user_id = auth.uid()) so this only affects our own row, and the
      // realtime DELETE event fans out to every other logged-in device on
      // the same account (channel `chat-hidden:{uid}`).
      let undone = false;
      toast.success("Pesan dihapus", {
        description: "Pesan disembunyikan dari perangkat kamu.",
        duration: 6000,
        action: {
          label: "Batalkan",
          onClick: async () => {
            if (undone) return;
            undone = true;
            const { error } = await supabase
              .from("message_hidden")
              .delete()
              .eq("message_id", messageId);
            if (error) {
              toast.error("Gagal membatalkan", { description: error.message });
              return;
            }
            // Local optimistic revert — realtime DELETE will confirm across devices.
            qc.setQueryData<Set<string>>(["chat", "hidden"], (prev) => {
              if (!prev || !prev.has(messageId)) return prev;
              const next = new Set(prev);
              next.delete(messageId);
              return next;
            });
            await Promise.all([
              qc.invalidateQueries({ queryKey: ["chat", "hidden"], refetchType: "active" }),
              qc.invalidateQueries({
                queryKey: ["chat", "messages", conversationId],
                refetchType: "active",
              }),
              qc.invalidateQueries({
                queryKey: ["chat", "conversations"],
                refetchType: "active",
              }),
            ]);
            qc.invalidateQueries({ queryKey: ["chat", "unread-total"] });
            toast.success("Pesan dikembalikan");
          },
        },
      });
    },
    onSettled: async () => {
      // Refetch hidden set immediately so any stale UI (e.g. other tabs of the
      // same conversation, forwards dialog, media panel) picks up the new id
      // in the same tick as the toast. `refetchType: "active"` targets only
      // mounted observers to avoid thrash on backgrounded routes.
      await Promise.all([
        qc.invalidateQueries({
          queryKey: ["chat", "hidden"],
          refetchType: "active",
        }),
        qc.invalidateQueries({
          queryKey: ["chat", "messages", conversationId],
          refetchType: "active",
        }),
      ]);
      // Refresh conversation list so unread count + last-message preview
      // (both derived from message_hidden server-side) resync from source
      // of truth. `refetchType: "active"` ensures the list badge updates
      // instantly for the visible chat index.
      await qc.invalidateQueries({
        queryKey: ["chat", "conversations"],
        refetchType: "active",
      });
      // Unread total badge (sidebar) also depends on this.
      qc.invalidateQueries({ queryKey: ["chat", "unread-total"] });
    },
  });
}

export function useHiddenMessageIds() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["chat", "hidden"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("message_hidden")
        .select("message_id");
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.message_id as string));
    },
    staleTime: 30_000,
  });

  // Realtime sync: keep the hidden set consistent across tabs/devices so
  // that when a realtime UPDATE arrives for a message, the filter already
  // knows the message is hidden and never lets it reappear.
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid || cancelled) return;
      channel = supabase
        .channel(`chat-hidden:${uid}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "message_hidden", filter: `user_id=eq.${uid}` },
          (payload) => {
            const id = (payload.new as { message_id?: string }).message_id;
            if (!id) return;
            qc.setQueryData<Set<string>>(["chat", "hidden"], (prev) => {
              const next = new Set(prev ?? []);
              next.add(id);
              return next;
            });
          },
        )
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "message_hidden", filter: `user_id=eq.${uid}` },
          (payload) => {
            const id = (payload.old as { message_id?: string }).message_id;
            if (!id) return;
            qc.setQueryData<Set<string>>(["chat", "hidden"], (prev) => {
              if (!prev || !prev.has(id)) return prev;
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          },
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [qc]);

  return query;
}

// ---------------- Pin / Archive / Mute ----------------
export function usePinConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { conversationId: string; pin: boolean }) => {
      const { error } = await supabase.rpc("chat_set_pin", { _conv: v.conversationId, _pin: v.pin });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat", "conversations"] }),
  });
}

export function useArchiveConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { conversationId: string; archive: boolean }) => {
      const { error } = await supabase.rpc("chat_set_archive", {
        _conv: v.conversationId,
        _arch: v.archive,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat", "conversations"] }),
  });
}

export function useMuteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { conversationId: string; until: Date | null }) => {
      const args = {
        _conv: v.conversationId,
        _until: v.until ? v.until.toISOString() : null,
      } as unknown as { _conv: string; _until: string };
      const { error } = await supabase.rpc("chat_mute", args);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat", "conversations"] }),
  });
}

// ---------------- Search ----------------
export function useChatSearch(q: string) {
  return useQuery({
    queryKey: ["chat", "search", q],
    enabled: q.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("chat_search_messages", {
        _q: q.trim(),
        _limit: 30,
      });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        conversation_id: string;
        sender_id: string;
        body: string | null;
        created_at: string;
      }>;
    },
    staleTime: 10_000,
  });
}

// ---------------- Heartbeat (last seen) ----------------
export function useChatHeartbeat() {
  const { data: myId } = useMyUserId();
  useEffect(() => {
    if (!myId) return;
    let stopped = false;
    const beat = () => {
      if (stopped) return;
      void supabase.rpc("chat_heartbeat");
    };
    beat();
    const onVis = () => {
      if (!document.hidden) beat();
    };
    document.addEventListener("visibilitychange", onVis);
    const id = window.setInterval(beat, 60_000);
    const onBeforeUnload = () => beat();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [myId]);
}