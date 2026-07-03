import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type ChatList = {
  id: string;
  user_id: string;
  name: string;
  color: string;
  icon: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ChatListWithCount = ChatList & { member_count: number };

const LISTS_KEY = ["chat", "lists"] as const;
const LIST_MEMBERS_KEY = (id: string) => ["chat", "list-members", id] as const;
const ALL_MEMBERS_KEY = ["chat", "lists", "all-members"] as const;

// Untyped table access via `any` to avoid regenerated types dependency.
// The tables were just created by migration and are protected via RLS.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function useChatLists() {
  return useQuery<ChatListWithCount[]>({
    queryKey: LISTS_KEY,
    queryFn: async () => {
      const { data, error } = await db
        .from("chat_lists")
        .select("*, chat_list_members(count)")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as Array<
        ChatList & { chat_list_members: Array<{ count: number }> }
      >).map((row) => ({
        id: row.id,
        user_id: row.user_id,
        name: row.name,
        color: row.color,
        icon: row.icon,
        sort_order: row.sort_order,
        created_at: row.created_at,
        updated_at: row.updated_at,
        member_count: row.chat_list_members?.[0]?.count ?? 0,
      }));
    },
    staleTime: 10_000,
  });
}

export function useChatListMembers(listId: string | undefined) {
  return useQuery<string[]>({
    queryKey: LIST_MEMBERS_KEY(listId ?? ""),
    enabled: !!listId,
    queryFn: async () => {
      const { data, error } = await db
        .from("chat_list_members")
        .select("conversation_id")
        .eq("list_id", listId!);
      if (error) throw error;
      return ((data ?? []) as Array<{ conversation_id: string }>).map((r) => r.conversation_id);
    },
    staleTime: 5_000,
  });
}

export function useAllChatListMembers() {
  return useQuery<Record<string, string[]>>({
    queryKey: ALL_MEMBERS_KEY,
    queryFn: async () => {
      const { data, error } = await db
        .from("chat_list_members")
        .select("list_id, conversation_id");
      if (error) throw error;
      const map: Record<string, string[]> = {};
      for (const row of (data ?? []) as Array<{ list_id: string; conversation_id: string }>) {
        (map[row.list_id] ??= []).push(row.conversation_id);
      }
      return map;
    },
    staleTime: 10_000,
  });
}

export function useCreateChatList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; color?: string; icon?: string }) => {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) throw new Error("Belum masuk");
      const { data, error } = await db
        .from("chat_lists")
        .insert({
          user_id: uid,
          name: input.name.trim(),
          color: input.color ?? "#22c55e",
          icon: input.icon ?? "tag",
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as ChatList;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LISTS_KEY });
      toast.success("Daftar dibuat");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Gagal membuat daftar"),
  });
}

export function useUpdateChatList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      name?: string;
      color?: string;
      icon?: string;
      sort_order?: number;
    }) => {
      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch.name = input.name.trim();
      if (input.color !== undefined) patch.color = input.color;
      if (input.icon !== undefined) patch.icon = input.icon;
      if (input.sort_order !== undefined) patch.sort_order = input.sort_order;
      const { error } = await db.from("chat_lists").update(patch).eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: LISTS_KEY }),
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan"),
  });
}

export function useDeleteChatList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("chat_lists").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LISTS_KEY });
      qc.invalidateQueries({ queryKey: ALL_MEMBERS_KEY });
      toast.success("Daftar dihapus");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Gagal menghapus"),
  });
}

export function useSetChatListMembers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { listId: string; conversationIds: string[] }) => {
      const { error: delErr } = await db
        .from("chat_list_members")
        .delete()
        .eq("list_id", input.listId);
      if (delErr) throw delErr;
      if (input.conversationIds.length > 0) {
        const rows = input.conversationIds.map((cid) => ({
          list_id: input.listId,
          conversation_id: cid,
        }));
        const { error: insErr } = await db.from("chat_list_members").insert(rows);
        if (insErr) throw insErr;
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: LIST_MEMBERS_KEY(vars.listId) });
      qc.invalidateQueries({ queryKey: LISTS_KEY });
      qc.invalidateQueries({ queryKey: ALL_MEMBERS_KEY });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan anggota"),
  });
}

export function useAddConversationsToList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { listId: string; conversationIds: string[] }) => {
      if (input.conversationIds.length === 0) return;
      const rows = input.conversationIds.map((cid) => ({
        list_id: input.listId,
        conversation_id: cid,
      }));
      const { error } = await db
        .from("chat_list_members")
        .upsert(rows, { onConflict: "list_id,conversation_id" });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: LIST_MEMBERS_KEY(vars.listId) });
      qc.invalidateQueries({ queryKey: LISTS_KEY });
      qc.invalidateQueries({ queryKey: ALL_MEMBERS_KEY });
    },
  });
}

export const CHAT_LIST_COLORS = [
  "#22c55e",
  "#ef4444",
  "#3b82f6",
  "#f59e0b",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
  "#6b7280",
] as const;

export const CHAT_LIST_ICONS = [
  "tag",
  "star",
  "heart",
  "bot",
  "users",
  "map-pin",
  "briefcase",
  "shopping-bag",
  "shield",
  "flag",
] as const;
