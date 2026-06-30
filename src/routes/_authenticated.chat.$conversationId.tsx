import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, Send, Loader2, MessageCircle, MoreVertical, Trash2, Share2, Copy, Users,
  Check, CheckCheck, AlertCircle, RefreshCw, WifiOff, Reply, Pencil, EyeOff, Smile, X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  getConversationMeta,
  markConversationRead,
  useDeleteAllMyMessages,
  useDeleteMessage,
  useConversationMessages,
  useMyUserId,
  type MessageRow,
  useChatHeartbeat,
  useMessageReactions,
  useReact,
  useEditMessage,
  useHideMessageForMe,
  useHiddenMessageIds,
} from "@/lib/chat";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { sendMessage } from "@/lib/chat.functions";
import { shareToWhatsApp, notifyShareResult } from "@/lib/share-wa";
import { ManageGroupDialog } from "@/components/chat/ManageGroupDialog";
import { useEntitlement } from "@/hooks/useEntitlement";
import { ProPaywall } from "@/components/ProPaywall";
import { AttachMenu } from "@/components/chat/AttachMenu";
import { MessageAttachment, CardBlock, decodeCard } from "@/components/chat/MessageAttachment";
import { previewText } from "@/lib/chat-cards";

function ChatProGate() {
  const ent = useEntitlement();
  if (ent.loading || ent.isPro) return null;
  return (
    <div className="mb-2">
      <ProPaywall feature="Kirim pesan chat" compact />
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/chat/$conversationId")({
  component: ChatRoomPage,
});

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}
function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long" });
}
function fmtRelative(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} hari lalu`;
  return new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
}
const REACTION_SET = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

function ChatRoomPage() {
  useChatHeartbeat();
  const { conversationId } = Route.useParams();
  const navigate = useNavigate();
  const { data: myId } = useMyUserId();
  const { data: messages, isLoading } = useConversationMessages(conversationId);
  const deleteMsg = useDeleteMessage(conversationId);
  const deleteAllMine = useDeleteAllMyMessages(conversationId);
  const editMsg = useEditMessage(conversationId);
  const hideMsg = useHideMessageForMe(conversationId);
  const react = useReact(conversationId);
  const hiddenIds = useHiddenMessageIds();
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<MessageRow | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [longPressMsg, setLongPressMsg] = useState<MessageRow | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);
  const startLongPress = useCallback((m: MessageRow) => {
    if (m.deleted_at) return;
    longPressFired.current = false;
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try { navigator.vibrate?.(15); } catch { /* noop */ }
      }
      setLongPressMsg(m);
    }, 500);
  }, []);
  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);
  const entitlement = useEntitlement();
  const chatBlocked = !entitlement.loading && !entitlement.isPro;

  const meta = useQuery({
    queryKey: ["chat", "conv-meta", conversationId],
    queryFn: () => getConversationMeta(conversationId),
  });

  // Member list & profiles for sender names (DM/group)
  const members = useQuery({
    queryKey: ["chat", "conv-members", conversationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversation_members")
        .select("user_id")
        .eq("conversation_id", conversationId);
      if (error) throw error;
      return (data ?? []).map((m) => m.user_id as string);
    },
  });

  const profileIds = useMemo(() => members.data ?? [], [members.data]);
  const profiles = useQuery({
    queryKey: ["chat", "conv-profiles", conversationId, profileIds.join(",")],
    enabled: profileIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_chat_member_profiles", {
        _user_ids: profileIds,
      });
      if (error) throw error;
      return new Map(
        ((data ?? []) as Array<{
          id: string;
          display_name: string | null;
          email: string | null;
          phone: string | null;
          last_seen_at?: string | null;
          show_last_seen?: boolean | null;
        }>).map(
          (p) => [p.id, p],
        ),
      );
    },
  });

  // Visible messages (apply per-user hide list)
  const visibleMessages = useMemo(() => {
    const hide = hiddenIds.data;
    if (!hide || hide.size === 0) return messages ?? [];
    return (messages ?? []).filter((m) => !hide.has(m.id));
  }, [messages, hiddenIds.data]);

  // Reactions for visible messages
  const visibleIds = useMemo(() => visibleMessages.map((m) => m.id), [visibleMessages]);
  const reactionsQ = useMessageReactions(conversationId, visibleIds);
  const reactionMap = useMemo(() => {
    const out = new Map<string, Map<string, Set<string>>>(); // msg -> emoji -> user set
    for (const r of reactionsQ.data ?? []) {
      let m = out.get(r.message_id);
      if (!m) {
        m = new Map();
        out.set(r.message_id, m);
      }
      let s = m.get(r.emoji);
      if (!s) {
        s = new Set();
        m.set(r.emoji, s);
      }
      s.add(r.user_id);
    }
    return out;
  }, [reactionsQ.data]);

  const messageById = useMemo(() => {
    const m = new Map<string, MessageRow>();
    for (const x of messages ?? []) m.set(x.id, x);
    return m;
  }, [messages]);

  const headerTitle = useMemo(() => {
    if (!meta.data) return "Memuat…";
    if (meta.data.kind === "dm" && myId && profiles.data) {
      const other = (members.data ?? []).find((u) => u !== myId);
      const p = other ? profiles.data.get(other) : null;
      return p?.display_name || p?.phone || p?.email || "Kontak";
    }
    return meta.data.title || (meta.data.kind === "order" ? "Diskusi pesanan" : "Grup");
  }, [meta.data, profiles.data, members.data, myId]);

  const dmPresence = useMemo(() => {
    if (!meta.data || meta.data.kind !== "dm" || !myId || !profiles.data) return null;
    const other = (members.data ?? []).find((u) => u !== myId);
    if (!other) return null;
    const p = profiles.data.get(other);
    if (!p || p.show_last_seen === false || !p.last_seen_at) return null;
    const ms = new Date(p.last_seen_at).getTime();
    if (Date.now() - ms < 60_000) return "Online";
    return `Terakhir dilihat ${fmtRelative(p.last_seen_at)}`;
  }, [meta.data, profiles.data, members.data, myId]);

  // Other members' last_read_at — for per-message read receipts
  const othersRead = useQuery({
    queryKey: ["chat", "conv-others-read", conversationId, myId ?? "_"],
    enabled: !!myId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversation_members")
        .select("user_id, last_read_at")
        .eq("conversation_id", conversationId);
      if (error) throw error;
      let minMs: number | null = null;
      for (const r of data ?? []) {
        if (r.user_id === myId) continue;
        const t = r.last_read_at ? new Date(r.last_read_at).getTime() : 0;
        if (minMs === null || t < minMs) minMs = t;
      }
      return minMs;
    },
    refetchInterval: 5000,
  });

  // Typing indicator via Realtime broadcast
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  useEffect(() => {
    if (!myId) return;
    const ch = supabase.channel(`chat-typing:${conversationId}`, {
      config: { broadcast: { self: false } },
    });
    ch.on("broadcast", { event: "typing" }, (msg) => {
      const uid = (msg.payload as { userId?: string } | undefined)?.userId;
      if (!uid || uid === myId) return;
      const p = profiles.data?.get(uid);
      const name = p?.display_name || p?.phone || p?.email || "Seseorang";
      setTypingNames((prev) => (prev.includes(name) ? prev : [...prev, name]));
      const prevT = typingTimers.current.get(uid);
      if (prevT) clearTimeout(prevT);
      const t = setTimeout(() => {
        setTypingNames((prev) => prev.filter((n) => n !== name));
        typingTimers.current.delete(uid);
      }, 3500);
      typingTimers.current.set(uid, t);
    });
    ch.subscribe();
    typingChannelRef.current = ch;
    return () => {
      typingTimers.current.forEach((t) => clearTimeout(t));
      typingTimers.current.clear();
      supabase.removeChannel(ch);
      typingChannelRef.current = null;
    };
  }, [conversationId, myId, profiles.data]);

  const lastTypingSentRef = useRef(0);
  const emitTyping = () => {
    const now = Date.now();
    if (now - lastTypingSentRef.current < 1500) return;
    lastTypingSentRef.current = now;
    typingChannelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { userId: myId },
    });
  };

  // Mark read on mount + when new messages arrive
  useEffect(() => {
    if (!myId || !messages || messages.length === 0) return;
    markConversationRead(conversationId, myId).catch(() => {});
  }, [conversationId, myId, messages?.length]);

  // Scroll to bottom
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages?.length]);

  const [body, setBody] = useState("");

  // ---- Outbox (optimistic send + retry on failure / reconnect) ----
  type OutboxItem = {
    tempId: string;
    body: string;
    status: "sending" | "failed";
    error?: string;
    createdAt: string;
    replyToId?: string;
  };
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const doSend = useCallback(
    async (item: OutboxItem) => {
      setOutbox((prev) =>
        prev.map((o) => (o.tempId === item.tempId ? { ...o, status: "sending", error: undefined } : o)),
      );
      try {
        await sendMessage({
          data: {
            conversationId,
            body: item.body,
            ...(item.replyToId ? { replyToId: item.replyToId } : {}),
          },
        });
        // Drop from outbox; realtime INSERT will surface the row.
        setOutbox((prev) => prev.filter((o) => o.tempId !== item.tempId));
        void othersRead.refetch();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Gagal mengirim";
        setOutbox((prev) =>
          prev.map((o) => (o.tempId === item.tempId ? { ...o, status: "failed", error: msg } : o)),
        );
        toast.error(msg);
      }
    },
    [conversationId, othersRead],
  );

  const doSendWith = useCallback(
    (item: OutboxItem, replyToId: string | null) => {
      const it = { ...item, replyToId: replyToId ?? undefined };
      setOutbox((prev) => prev.map((o) => (o.tempId === item.tempId ? it : o)));
      void doSend(it);
    },
    [doSend],
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = body.trim();
    if (!t) return;
    // Edit mode -> commit edit instead of sending new
    if (editing) {
      editMsg.mutate(
        { messageId: editing.id, body: t },
        {
          onSuccess: () => {
            setEditing(null);
            setBody("");
            toast.success("Pesan diperbarui");
          },
          onError: (err) => toast.error(err instanceof Error ? err.message : "Gagal mengedit"),
        },
      );
      return;
    }
    const item: OutboxItem = {
      tempId: `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      body: t,
      status: "sending",
      createdAt: new Date().toISOString(),
    };
    const replyId = replyTo?.id ?? null;
    setOutbox((prev) => [...prev, item]);
    setBody("");
    setReplyTo(null);
    void doSendWith(item, replyId);
  };

  // Auto-retry failed messages once the browser is back online.
  const prevOnlineRef = useRef(online);
  useEffect(() => {
    if (!prevOnlineRef.current && online) {
      outbox
        .filter((o) => o.status === "failed")
        .forEach((o) => {
          void doSend(o);
        });
    }
    prevOnlineRef.current = online;
  }, [online, outbox, doSend]);

  // Group messages by day
  const grouped = useMemo(() => {
    const out: { day: string; items: MessageRow[] }[] = [];
    for (const m of visibleMessages) {
      const day = fmtDay(m.created_at);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(m);
      else out.push({ day, items: [m] });
    }
    return out;
  }, [visibleMessages]);

  // Re-scroll when outbox changes too.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [outbox.length]);

  return (
    <div className="mx-auto flex h-[100dvh] max-w-2xl flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate({ to: "/chat" })}
          aria-label="Kembali"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary">
          <MessageCircle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{headerTitle}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {typingNames.length > 0 ? (
              <span className="italic text-primary">
                {meta.data?.kind === "dm"
                  ? "sedang menulis pesan…"
                  : `${typingNames.join(", ")} sedang menulis…`}
              </span>
            ) : !online ? (
              <span className="inline-flex items-center gap-1 text-amber-600">
                <WifiOff className="h-3 w-3" /> Offline · pesan akan dikirim saat online
              </span>
            ) : meta.data?.kind === "dm" ? (
              dmPresence ?? "Percakapan pribadi"
            ) : meta.data?.kind === "order" ? (
              "Diskusi pesanan"
            ) : (
              `Grup · ${members.data?.length ?? 0} anggota`
            )}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Opsi percakapan">
              <MoreVertical className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {meta.data?.kind === "group" ? (
              <DropdownMenuItem onSelect={() => setManageOpen(true)}>
                <Users className="mr-2 h-4 w-4" />
                Kelola grup &amp; anggota
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setConfirmAllOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Hapus semua pesan saya
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div ref={scrollerRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {isLoading ? (
          <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Memuat pesan…
          </div>
        ) : (messages ?? []).length === 0 ? (
          <div className="grid place-items-center p-12 text-center text-xs text-muted-foreground">
            Belum ada pesan. Sapa dulu yuk.
          </div>
        ) : (
          grouped.map((g) => (
            <div key={g.day} className="space-y-2">
              <div className="my-2 flex justify-center">
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-[10px] text-muted-foreground">{g.day}</span>
              </div>
              {g.items.map((m) => {
                const mine = m.sender_id === myId;
                const senderProfile = profiles.data?.get(m.sender_id);
                const senderName = senderProfile?.display_name || senderProfile?.email || "Pengguna";
                const showSender = !mine && (meta.data?.kind !== "dm");
                const replyMsg = m.reply_to_id ? messageById.get(m.reply_to_id) : null;
                const replySender = replyMsg ? profiles.data?.get(replyMsg.sender_id) : null;
                const replySenderName = replySender?.display_name || replySender?.email || "Pengguna";
                const myReactions = new Set<string>();
                const reactionEntries: Array<{ emoji: string; count: number; mine: boolean }> = [];
                const rmap = reactionMap.get(m.id);
                if (rmap) {
                  for (const [emoji, users] of rmap) {
                    const mineHere = !!myId && users.has(myId);
                    if (mineHere) myReactions.add(emoji);
                    reactionEntries.push({ emoji, count: users.size, mine: mineHere });
                  }
                }
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`group relative flex max-w-[80%] items-start gap-1 ${mine ? "flex-row-reverse" : "flex-row"}`}>
                      <div
                        className={`rounded-2xl px-3 py-1.5 text-sm leading-snug shadow-sm ${
                          mine
                            ? "rounded-br-sm bg-primary text-primary-foreground"
                            : "rounded-bl-sm bg-muted text-foreground"
                        }`}
                      >
                        {showSender ? (
                          <div className="mb-0.5 text-[10px] font-semibold opacity-80">{senderName}</div>
                        ) : null}
                        {replyMsg ? (
                          <div
                            className={`mb-1 rounded-md border-l-2 px-2 py-1 text-[11px] ${
                              mine
                                ? "border-primary-foreground/60 bg-primary-foreground/10"
                                : "border-primary/60 bg-background/60"
                            }`}
                          >
                            <div className="font-semibold opacity-80">
                              {replyMsg.sender_id === myId ? "Anda" : replySenderName}
                            </div>
                            <div className="line-clamp-2 opacity-80">
                              {replyMsg.deleted_at ? <em>(pesan dihapus)</em> : (previewText(replyMsg.body) ?? "(lampiran)")}
                            </div>
                          </div>
                        ) : null}
                        {m.deleted_at ? (
                          <em className="opacity-70">(pesan dihapus)</em>
                        ) : (
                          (() => {
                            const card = decodeCard(m.body);
                            return (
                              <div className="space-y-1">
                                {m.attachment_path ? (
                                  <MessageAttachment
                                    path={m.attachment_path}
                                    mime={m.attachment_mime}
                                    name={m.attachment_name}
                                    size={m.attachment_size}
                                    mine={mine}
                                  />
                                ) : null}
                                {card ? <CardBlock card={card} mine={mine} /> : null}
                                {!card && m.body ? (
                                  <div className="whitespace-pre-wrap break-words">{m.body}</div>
                                ) : null}
                              </div>
                            );
                          })()
                        )}
                        <div className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                          {m.edited_at && !m.deleted_at ? <span className="italic">diedit</span> : null}
                          <span>{fmtTime(m.created_at)}</span>
                          {mine && !m.deleted_at ? (
                            (() => {
                              const sentMs = new Date(m.created_at).getTime();
                              const read = othersRead.data !== null && othersRead.data !== undefined && othersRead.data >= sentMs;
                              return read ? (
                                <CheckCheck className="h-3.5 w-3.5 text-sky-300" aria-label="Dibaca" />
                              ) : (
                                <CheckCheck className="h-3.5 w-3.5 opacity-80" aria-label="Terkirim" />
                              );
                            })()
                          ) : null}
                        </div>
                        {reactionEntries.length > 0 ? (
                          <div className={`mt-1 flex flex-wrap gap-1 ${mine ? "justify-end" : "justify-start"}`}>
                            {reactionEntries.map((r) => (
                              <button
                                key={r.emoji}
                                type="button"
                                onClick={() =>
                                  react.mutate({ messageId: m.id, emoji: r.emoji, on: !r.mine })
                                }
                                className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] leading-none transition ${
                                  r.mine
                                    ? "border-primary bg-primary/20 text-foreground"
                                    : "border-border bg-background/70 text-foreground hover:bg-accent"
                                }`}
                              >
                                <span>{r.emoji}</span>
                                <span>{r.count}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      {!m.deleted_at ? (
                        <div className="flex items-center gap-1 self-center opacity-0 transition-opacity group-hover:opacity-100 data-[open=true]:opacity-100">
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              aria-label="Tambah reaksi"
                            >
                              <Smile className="h-3.5 w-3.5" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-1" align={mine ? "end" : "start"}>
                            <div className="flex gap-1">
                              {REACTION_SET.map((e) => (
                                <button
                                  key={e}
                                  type="button"
                                  className={`grid h-8 w-8 place-items-center rounded-md text-lg hover:bg-accent ${
                                    myReactions.has(e) ? "bg-primary/15" : ""
                                  }`}
                                  onClick={() =>
                                    react.mutate({ messageId: m.id, emoji: e, on: !myReactions.has(e) })
                                  }
                                >
                                  {e}
                                </button>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              aria-label="Opsi pesan"
                            >
                              <MoreVertical className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem
                              onSelect={() => {
                                setReplyTo(m);
                                setEditing(null);
                              }}
                            >
                              <Reply className="mr-2 h-4 w-4" />
                              Balas
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={async () => {
                                const text = `${senderName}: ${previewText(m.body) ?? "(lampiran)"}`;
                                const res = await shareToWhatsApp({ text });
                                notifyShareResult(res);
                              }}
                            >
                              <Share2 className="mr-2 h-4 w-4" />
                              Teruskan via WhatsApp
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => {
                                navigator.clipboard?.writeText(m.body ?? "").then(
                                  () => toast.success("Teks pesan disalin"),
                                  () => toast.error("Gagal menyalin"),
                                );
                              }}
                            >
                              <Copy className="mr-2 h-4 w-4" />
                              Salin teks
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() =>
                                hideMsg.mutate(m.id, {
                                  onSuccess: () => toast.success("Pesan disembunyikan untuk Anda"),
                                  onError: (err) => toast.error(err instanceof Error ? err.message : "Gagal"),
                                })
                              }
                            >
                              <EyeOff className="mr-2 h-4 w-4" />
                              Hapus untuk saya
                            </DropdownMenuItem>
                            {mine && m.body ? (
                              (() => {
                                const ageMin = (Date.now() - new Date(m.created_at).getTime()) / 60_000;
                                if (ageMin > 24 * 60) return null;
                                return (
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      setEditing({ id: m.id, body: m.body ?? "" });
                                      setReplyTo(null);
                                      setBody(m.body ?? "");
                                    }}
                                  >
                                    <Pencil className="mr-2 h-4 w-4" />
                                    Edit
                                  </DropdownMenuItem>
                                );
                              })()
                            ) : null}
                            {mine ? (
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                disabled={deleteMsg.isPending}
                                onSelect={() => {
                                  deleteMsg.mutate(
                                    { id: m.id, attachment_path: m.attachment_path },
                                    {
                                      onError: (e) =>
                                        toast.error(e instanceof Error ? e.message : "Gagal menghapus"),
                                    },
                                  );
                                }}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Hapus untuk semua orang
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}

        {outbox.length > 0 ? (
          <div className="space-y-2">
            {outbox.map((o) => (
              <div key={o.tempId} className="flex justify-end">
                <div className="flex max-w-[80%] flex-row-reverse items-start gap-1">
                  <div
                    className={`rounded-2xl rounded-br-sm px-3 py-1.5 text-sm leading-snug shadow-sm ${
                      o.status === "failed"
                        ? "bg-destructive/15 text-foreground ring-1 ring-destructive/40"
                        : "bg-primary/80 text-primary-foreground"
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words">{o.body}</div>
                    <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] opacity-90">
                      <span>{fmtTime(o.createdAt)}</span>
                      {o.status === "sending" ? (
                        <Check className="h-3.5 w-3.5 opacity-80" aria-label="Belum terkirim" />
                      ) : (
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <AlertCircle className="h-3.5 w-3.5" aria-label="Gagal" />
                          Gagal
                        </span>
                      )}
                    </div>
                  </div>
                  {o.status === "failed" ? (
                    <div className="flex flex-col gap-1 self-center">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        aria-label="Kirim ulang"
                        onClick={() => void doSend(o)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-destructive"
                        aria-label="Buang pesan"
                        onClick={() => setOutbox((prev) => prev.filter((x) => x.tempId !== o.tempId))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <form onSubmit={onSubmit} className="sticky bottom-0 z-10 border-t bg-background/95 p-2 backdrop-blur">
        <ChatProGate />
        {editing ? (
          <div className="mb-2 flex items-start gap-2 rounded-md border border-primary/40 bg-primary/5 px-2 py-1 text-xs">
            <Pencil className="mt-0.5 h-3.5 w-3.5 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-primary">Edit pesan</div>
              <div className="line-clamp-2 text-muted-foreground">{editing.body || "(kosong)"}</div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              aria-label="Batal edit"
              onClick={() => {
                setEditing(null);
                setBody("");
              }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : replyTo ? (
          <div className="mb-2 flex items-start gap-2 rounded-md border-l-2 border-primary bg-muted/60 px-2 py-1 text-xs">
            <Reply className="mt-0.5 h-3.5 w-3.5 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">
                Balas {replyTo.sender_id === myId ? "Anda" : (profiles.data?.get(replyTo.sender_id)?.display_name || "Pengguna")}
              </div>
              <div className="line-clamp-2 text-muted-foreground">
                {replyTo.deleted_at ? <em>(pesan dihapus)</em> : (previewText(replyTo.body) ?? "(lampiran)")}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              aria-label="Batal balas"
              onClick={() => setReplyTo(null)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <AttachMenu conversationId={conversationId} disabled={chatBlocked} onSent={() => { void othersRead.refetch(); }} />
          <Textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              if (e.target.value.length > 0) emitTyping();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit(e as unknown as React.FormEvent);
              }
            }}
            placeholder="Tulis pesan…"
            rows={1}
            className="max-h-32 min-h-9 resize-none"
            disabled={chatBlocked}
          />
          <Button type="submit" size="icon" disabled={!body.trim() || chatBlocked} aria-label="Kirim">
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="mt-1 px-1 text-[10px] text-muted-foreground">
          Enter untuk kirim · Shift+Enter untuk baris baru
        </p>
      </form>

      <AlertDialog open={confirmAllOpen} onOpenChange={setConfirmAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus semua pesan saya?</AlertDialogTitle>
            <AlertDialogDescription>
              Semua pesan yang pernah Anda kirim di percakapan ini akan hilang dari kedua sisi,
              termasuk lampirannya. Tindakan ini tidak bisa dibatalkan. Pesan dari pihak lain
              tetap utuh di sisi mereka.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteAllMine.isPending}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteAllMine.isPending}
              onClick={(e) => {
                e.preventDefault();
                deleteAllMine.mutate(undefined, {
                  onSuccess: (n) => {
                    toast.success(`${n} pesan dihapus`);
                    setConfirmAllOpen(false);
                  },
                  onError: (err) =>
                    toast.error(err instanceof Error ? err.message : "Gagal menghapus"),
                });
              }}
            >
              {deleteAllMine.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Hapus semua
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {meta.data?.kind === "group" ? (
        <ManageGroupDialog
          open={manageOpen}
          onOpenChange={setManageOpen}
          conversationId={conversationId}
          currentTitle={meta.data.title}
          ownerUserId={meta.data.owner_user_id}
          onLeft={() => navigate({ to: "/chat" })}
        />
      ) : null}
    </div>
  );
}

// Keep a hint link in case the room URL is opened directly without context.
export const ChatRoomFallbackLink = () => <Link to="/chat">Kembali ke daftar chat</Link>;