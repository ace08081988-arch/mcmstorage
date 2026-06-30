import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

// Augmented type — messages now have starred_by[] and pinned_at
export type MessageExtras = {
  starred_by?: string[] | null;
  pinned_at?: string | null;
};

export function useStarMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ messageId, on }: { messageId: string; on: boolean }) => {
      const { error } = await supabase.rpc("message_star" as never, { _id: messageId, _on: on } as never);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat", "messages", conversationId] }),
  });
}

export function usePinMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ messageId, on }: { messageId: string; on: boolean }) => {
      const { error } = await supabase.rpc("message_pin" as never, { _id: messageId, _on: on } as never);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat", "messages", conversationId] }),
  });
}

// ---------------- Notes ----------------
export type ChatNote = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  source_message_id: string | null;
  conversation_id: string | null;
  created_at: string;
  updated_at: string;
};

export function useChatNotes() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["chat-notes"],
    queryFn: async (): Promise<ChatNote[]> => {
      const { data, error } = await supabase
        .from("chat_notes" as never)
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as ChatNote[];
    },
  });
  useEffect(() => {
    const ch = supabase
      .channel("chat-notes-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_notes" },
        () => qc.invalidateQueries({ queryKey: ["chat-notes"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);
  return query;
}

export function useSaveNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      title: string;
      body: string;
      source_message_id?: string | null;
      conversation_id?: string | null;
    }) => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("unauthorized");
      if (input.id) {
        const { error } = await supabase
          .from("chat_notes" as never)
          .update({ title: input.title, body: input.body } as never)
          .eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("chat_notes" as never).insert({
          user_id: uid,
          title: input.title,
          body: input.body,
          source_message_id: input.source_message_id ?? null,
          conversation_id: input.conversation_id ?? null,
        } as never);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat-notes"] }),
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("chat_notes" as never).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat-notes"] }),
  });
}

// ---------------- Quick Replies ----------------
export type QuickReply = {
  id: string;
  user_id: string;
  shortcut: string;
  body: string;
  created_at: string;
  updated_at: string;
};

export function useQuickReplies() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["chat-quick-replies"],
    queryFn: async (): Promise<QuickReply[]> => {
      const { data, error } = await supabase
        .from("chat_quick_replies" as never)
        .select("*")
        .order("shortcut", { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as QuickReply[];
    },
  });
  useEffect(() => {
    const ch = supabase
      .channel("chat-qr-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_quick_replies" },
        () => qc.invalidateQueries({ queryKey: ["chat-quick-replies"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);
  return query;
}

export function useSaveQuickReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; shortcut: string; body: string }) => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("unauthorized");
      const shortcut = input.shortcut.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 32);
      if (!shortcut) throw new Error("Shortcut wajib diisi");
      if (!input.body.trim()) throw new Error("Isi pesan wajib");
      if (input.id) {
        const { error } = await supabase
          .from("chat_quick_replies" as never)
          .update({ shortcut, body: input.body } as never)
          .eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("chat_quick_replies" as never)
          .insert({ user_id: uid, shortcut, body: input.body } as never);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat-quick-replies"] }),
  });
}

export function useDeleteQuickReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("chat_quick_replies" as never).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat-quick-replies"] }),
  });
}

// ---------------- Security code (channel fingerprint) ----------------
export async function computeSecurityCode(parts: string[]): Promise<string> {
  const joined = parts.slice().sort().join("|");
  const enc = new TextEncoder().encode(joined);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const bytes = Array.from(new Uint8Array(buf));
  // 60 digits in 12 groups of 5, like WhatsApp's security code.
  const digits: string[] = [];
  for (const b of bytes) {
    digits.push((b % 10).toString());
    if (digits.length >= 60) break;
  }
  while (digits.length < 60) digits.push("0");
  const groups: string[] = [];
  for (let i = 0; i < 60; i += 5) groups.push(digits.slice(i, i + 5).join(""));
  return groups.join(" ");
}