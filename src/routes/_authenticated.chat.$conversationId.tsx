import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { scheduleUndo } from "@/lib/undo-action";
import { confirm } from "@/lib/confirm";
import { logChatDelete } from "@/lib/chat-delete-audit";
import { optimisticDeleteMessages } from "@/lib/chat-optimistic-delete";
import { Linkify, UrlPreviewList } from "@/lib/linkify";
import {
  ArrowLeft, Send, Loader2, MessageCircle, MoreVertical, Trash2, Share2, Copy, Users,
  Check, CheckCheck, AlertCircle, RefreshCw, WifiOff, Reply, Pencil, EyeOff, Smile, X, Ban, Star, Pin,
  History as HistoryIcon,
  Sticker as StickerIcon,
  Search as SearchIcon, Image as ImageIcon, BellOff, BellRing,
  Archive, ShoppingCart, UserPlus, MailWarning, MessageSquarePlus,
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
import { formatInviteCode } from "@/lib/invite";
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
import { EditContactNameDialog } from "@/components/chat/EditContactNameDialog";
import { usePeerAlias } from "@/lib/contact-alias";
import { AttachMenu } from "@/components/chat/AttachMenu";
import { MessageAttachment, CardBlock, decodeCard } from "@/components/chat/MessageAttachment";
import { previewText } from "@/lib/chat-cards";
import { SelectionToolbar } from "@/components/chat/SelectionToolbar";
import { PinnedBanner } from "@/components/chat/PinnedBanner";
import { MessageInfoDialog } from "@/components/chat/MessageInfoDialog";
import { SecurityCodeDialog } from "@/components/chat/SecurityCodeDialog";
import { TranslateDialog } from "@/components/chat/TranslateDialog";
import { SaveAsNoteDialog } from "@/components/chat/SaveAsNoteDialog";
import { SaveAsQuickReplyDialog } from "@/components/chat/SaveAsQuickReplyDialog";
import { QuickReplyPopover } from "@/components/chat/QuickReplyPopover";
import { StickerPickerDialog, parseStickerFromBody } from "@/components/chat/StickerPickerDialog";
import {
  ConversationSearchDialog,
  MediaLinksDialog,
  MuteDialog,
} from "@/components/chat/ConversationExtrasDialogs";
import { useConvPrefs, setConvPrefs } from "@/lib/conversation-prefs";
import { usePinMessage, useStarMessage } from "@/lib/chat-extras";
import {
  DELETED_PLACEHOLDER,
  MessagePreview,
  messagePreviewText,
} from "@/lib/chat-deleted";

const safePreview = messagePreviewText;

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
  const qc = useQueryClient();
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
  // Selection mode + extra dialogs
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [translateSource, setTranslateSource] = useState<string | null>(null);
  const [editStickerMsg, setEditStickerMsg] = useState<{ id: string; body: string } | null>(null);
  const [noteSource, setNoteSource] = useState<MessageRow | null>(null);
  const [qrSource, setQrSource] = useState<string | null>(null);
  const starMut = useStarMessage(conversationId);
  const pinMut = usePinMessage(conversationId);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [muteOpen, setMuteOpen] = useState(false);
  const { prefs: convPrefs, mutedNow } = useConvPrefs(myId ?? undefined, conversationId);

  // Toast saat pin/mute/arsip berubah dari tab/perangkat lain.
  // Beberapa perubahan yang datang beruntun (mis. pin + mute dalam <500ms)
  // digabung jadi satu toast ringkas agar tidak terasa spam.
  useEffect(() => {
    const COALESCE_MS = 500;
    // Rate-limit: setelah satu toast tampil, tahan toast berikutnya sampai
    // cooldown ini lewat. Perubahan yang masuk selama cooldown tetap dibuffer
    // dan ditampilkan sebagai satu toast gabungan begitu cooldown berakhir.
    const RATE_LIMIT_MS = 4000;
    let buffer: string[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastShownAt = 0;
    const flush = () => {
      timer = null;
      if (!buffer.length) return;
      const now = Date.now();
      const wait = lastShownAt + RATE_LIMIT_MS - now;
      if (wait > 0) {
        // Masih dalam cooldown — jadwalkan ulang, biarkan buffer terus tumbuh.
        timer = setTimeout(flush, wait);
        return;
      }
      // Dedupe berurutan (mis. dua kali "disematkan") sambil pertahankan urutan
      const seen = new Set<string>();
      const uniq = buffer.filter((c) => (seen.has(c) ? false : (seen.add(c), true)));
      buffer = [];
      const msg =
        uniq.length <= 2
          ? uniq.join(", ")
          : `${uniq.length} perubahan (${uniq.slice(0, 2).join(", ")}, …)`;
      toast.success(`Disinkronkan dari perangkat lain: ${msg}`);
      lastShownAt = now;
    };
    const onRemote = (e: Event) => {
      const d = (e as CustomEvent).detail as { cid?: string; changes?: string[] } | undefined;
      if (!d || d.cid !== conversationId) return;
      const changes = d.changes ?? [];
      if (!changes.length) return;
      buffer.push(...changes);
      // Jangan reset timer yang sudah menunggu cooldown — cukup pastikan
      // ada satu timer aktif untuk flush berikutnya.
      if (!timer) timer = setTimeout(flush, COALESCE_MS);
    };
    window.addEventListener("mcm:conv-prefs-remote", onRemote);
    return () => {
      window.removeEventListener("mcm:conv-prefs-remote", onRemote);
      if (timer) {
        clearTimeout(timer);
        flush();
      }
    };
  }, [conversationId]);

  const toggleSelect = useCallback((m: MessageRow) => {
    if (m.deleted_at) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(m.id)) next.delete(m.id);
      else next.add(m.id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
  const selectionMode = selectedIds.size > 0;

  // Jump-to-message helper (used by pinned banner)
  const jumpToMessage = useCallback((id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-amber-400");
    setTimeout(() => el.classList.remove("ring-2", "ring-amber-400"), 1500);
  }, []);

  // Quick reply popover state (driven by `/shortcut` in composer)
  const [qrQuery, setQrQuery] = useState<string | null>(null);

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
      // Long-press now enters selection mode and selects this message.
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.add(m.id);
        return next;
      });
    }, 500);
  }, []);
  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);
  const chatBlocked = false;

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
          invite_code: string | null;
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
      return p?.display_name
        || (p?.invite_code ? `PIN ${formatInviteCode(p.invite_code)}` : null)
        || "Kontak";
    }
    return meta.data.title || (meta.data.kind === "order" ? "Diskusi pesanan" : "Grup");
  }, [meta.data, profiles.data, members.data, myId]);

  // === Edit nama kontak (alias) untuk DM, tersinkron ke address_book ===
  const dmPeer = useMemo(() => {
    if (!meta.data || meta.data.kind !== "dm" || !myId) return null;
    const other = (members.data ?? []).find((u) => u !== myId);
    if (!other) return null;
    const p = profiles.data?.get(other) ?? null;
    return {
      peerUserId: other,
      peerPhone: p?.phone ?? null,
      peerEmail: p?.email ?? null,
      fallbackName:
        p?.display_name
        || (p?.invite_code ? `PIN ${formatInviteCode(p.invite_code)}` : null)
        || "Kontak",
    };
  }, [meta.data, members.data, profiles.data, myId]);

  const peerAlias = usePeerAlias({
    peerUserId: dmPeer?.peerUserId ?? null,
    peerPhone: dmPeer?.peerPhone ?? null,
    peerEmail: dmPeer?.peerEmail ?? null,
  });
  const displayedPeerName = peerAlias.data?.name?.trim() || dmPeer?.fallbackName || "Kontak";
  const [editNameOpen, setEditNameOpen] = useState(false);

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
      const name =
        p?.display_name
        || (p?.invite_code ? `PIN ${formatInviteCode(p.invite_code)}` : null)
        || "Seseorang";
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

  // Pinned messages (sorted by pinned_at desc, max 3)
  const pinnedMessages = useMemo(() => {
    return (visibleMessages ?? [])
      .filter((m) => !!m.pinned_at && !m.deleted_at)
      .sort((a, b) => (b.pinned_at ?? "").localeCompare(a.pinned_at ?? ""))
      .slice(0, 3);
  }, [visibleMessages]);

  const selectedMessages = useMemo(
    () => (messages ?? []).filter((m) => selectedIds.has(m.id)),
    [messages, selectedIds],
  );
  const oneSelected = selectedMessages.length === 1;
  const onlyOne = oneSelected ? selectedMessages[0] : null;
  const allMineSelected = selectedMessages.length > 0 && selectedMessages.every((m) => m.sender_id === myId);

  // Re-scroll when outbox changes too.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [outbox.length]);

  return (
    <div className="mx-auto flex h-[100dvh] max-w-2xl flex-col wa-surface">
      {!meta.isPending && !meta.data ? (
        <div
          role="alert"
          data-testid="chat-not-found"
          className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
        >
          <div className="text-[15px] font-semibold">Percakapan tidak ditemukan</div>
          <div className="text-[13px] leading-snug text-muted-foreground">
            Tautan ini mungkin sudah kedaluwarsa atau kamu tidak punya akses ke percakapan ini.
          </div>
          <Button variant="secondary" onClick={() => navigate({ to: "/chat" })}>
            Kembali ke daftar chat
          </Button>
        </div>
      ) : (
      <>
      {selectionMode ? (
        <SelectionToolbar
          count={selectedIds.size}
          oneSelected={oneSelected}
          allMine={allMineSelected}
          onClose={clearSelection}
          onReply={() => {
            if (onlyOne) {
              setReplyTo(onlyOne);
              setEditing(null);
            }
            clearSelection();
          }}
          onInfo={() => {
            if (onlyOne) setInfoOpen(true);
          }}
          onDelete={() => setBulkDeleteOpen(true)}
          onCopy={() => {
            const text = selectedMessages
              .map((m) => safePreview(m))
              .filter(Boolean)
              .join("\n\n");
            navigator.clipboard?.writeText(text).then(
              () => toast.success(`${selectedMessages.length} pesan disalin`),
              () => toast.error("Gagal menyalin"),
            );
            clearSelection();
          }}
          onForward={async () => {
            const text = selectedMessages
              .map((m) => {
                const sp = profiles.data?.get(m.sender_id);
                const name =
                  sp?.display_name
                  || (sp?.invite_code ? `PIN ${formatInviteCode(sp.invite_code)}` : null)
                  || "Pengguna";
                return `${name}: ${safePreview(m)}`;
              })
              .join("\n");
            const res = await shareToWhatsApp({ text });
            notifyShareResult(res);
            clearSelection();
          }}
          onSecurityCode={() => setSecurityOpen(true)}
          onStar={() => {
            const turnOn = selectedMessages.some((m) => !(m.starred_by ?? []).includes(myId ?? ""));
            selectedMessages.forEach((m) => {
              starMut.mutate({ messageId: m.id, on: turnOn });
            });
            toast.success(turnOn ? "Diberi bintang" : "Bintang dilepas");
            clearSelection();
          }}
          onPin={() => {
            if (!onlyOne) return;
            const turnOn = !onlyOne.pinned_at;
            pinMut.mutate(
              { messageId: onlyOne.id, on: turnOn },
              {
                onSuccess: () => toast.success(turnOn ? "Pesan disematkan" : "Pin dilepas"),
                onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal"),
              },
            );
            clearSelection();
          }}
          onSaveNote={() => {
            if (onlyOne) setNoteSource(onlyOne);
          }}
          onSaveQuickReply={() => {
            if (onlyOne) setQrSource(onlyOne.deleted_at ? "" : (previewText(onlyOne.body) ?? ""));
          }}
          onTranslate={() => {
            if (onlyOne) setTranslateSource(onlyOne.deleted_at ? "" : (previewText(onlyOne.body) ?? ""));
          }}
        />
      ) : (
      <header className="wa-header sticky top-0 z-10 flex items-center gap-2 border-b px-2 py-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate({ to: "/chat" })}
          aria-label="Kembali"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="grid h-10 w-10 place-items-center rounded-full bg-[var(--wa-surface-2)] text-[var(--wa-text-muted)] text-sm font-semibold uppercase">
          {(meta.data?.kind === "dm" ? displayedPeerName : headerTitle || "?").trim().charAt(0) || "?"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <div className="truncate text-[15px] font-semibold">
              {meta.data?.kind === "dm" ? displayedPeerName : headerTitle}
            </div>
            {meta.data?.kind === "dm" && dmPeer ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="Edit nama kontak"
                onClick={() => setEditNameOpen(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
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
            <DropdownMenuItem onSelect={() => setSearchOpen(true)}>
              <SearchIcon className="mr-2 h-4 w-4" /> Cari di percakapan
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setMediaOpen(true)}>
              <ImageIcon className="mr-2 h-4 w-4" /> Media, tautan, dan dok
            </DropdownMenuItem>
            {meta.data?.kind === "dm" && dmPeer?.peerPhone ? (
              <DropdownMenuItem
                onSelect={() => {
                  try {
                    sessionStorage.setItem(
                      "mcm.buku-alamat.prefill",
                      JSON.stringify({
                        phone: dmPeer.peerPhone ?? "",
                        name: displayedPeerName,
                      }),
                    );
                  } catch {
                    /* ignore */
                  }
                  navigate({ to: "/buku-alamat" });
                }}
              >
                <UserPlus className="mr-2 h-4 w-4" /> Tambah ke daftar kontak
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              onSelect={() => {
                setConvPrefs(myId ?? undefined, conversationId, { pinned: !convPrefs.pinned });
                toast.success(convPrefs.pinned ? "Chat dilepas dari sematan" : "Chat disematkan di atas");
              }}
            >
              <Pin className="mr-2 h-4 w-4" /> {convPrefs.pinned ? "Lepas sematan" : "Tetapkan chat"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (mutedNow) {
                  setConvPrefs(myId ?? undefined, conversationId, { mutedUntil: null });
                  toast.success("Notifikasi diaktifkan kembali");
                } else {
                  setMuteOpen(true);
                }
              }}
            >
              {mutedNow ? (
                <>
                  <BellRing className="mr-2 h-4 w-4" /> Bunyikan notifikasi
                </>
              ) : (
                <>
                  <BellOff className="mr-2 h-4 w-4" /> Senyapkan notifikasi
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setConvPrefs(myId ?? undefined, conversationId, {
                  archived: !convPrefs.archived,
                });
                toast.success(convPrefs.archived ? "Dikeluarkan dari arsip" : "Dipindah ke arsip");
              }}
            >
              <Archive className="mr-2 h-4 w-4" /> {convPrefs.archived ? "Batalkan arsip" : "Arsipkan chat"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setConvPrefs(myId ?? undefined, conversationId, {
                  markedUnread: !convPrefs.markedUnread,
                });
                toast.success(convPrefs.markedUnread ? "Ditandai sudah dibaca" : "Ditandai belum dibaca");
              }}
            >
              <MailWarning className="mr-2 h-4 w-4" />
              {convPrefs.markedUnread ? "Tandai sudah dibaca" : "Tandai belum dibaca"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => navigate({ to: "/ecer" })}
            >
              <ShoppingCart className="mr-2 h-4 w-4" /> Buat pesanan
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => navigate({ to: "/chat" })}
            >
              <MessageSquarePlus className="mr-2 h-4 w-4" /> Chat baru
            </DropdownMenuItem>
            {meta.data?.kind === "group" ? (
              <DropdownMenuItem onSelect={() => setManageOpen(true)}>
                <Users className="mr-2 h-4 w-4" /> Kelola grup &amp; anggota
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              onSelect={() =>
                navigate({ to: "/chat-audit", search: { c: conversationId } })
              }
            >
              <HistoryIcon className="mr-2 h-4 w-4" /> Log hapus pesan
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setConfirmAllOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Hapus semua pesan saya
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      )}

      <PinnedBanner
        conversationId={conversationId}
        pinned={pinnedMessages}
        onJump={jumpToMessage}
        canUnpin
      />

      <div ref={scrollerRef} className="wa-chat-bg flex-1 space-y-3 overflow-y-auto p-3">
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
                <span className="rounded-md bg-[var(--wa-header)] px-2.5 py-1 text-[11px] font-medium wa-muted shadow-sm">{g.day}</span>
              </div>
              {g.items.map((m) => {
                const mine = m.sender_id === myId;
                const senderProfile = profiles.data?.get(m.sender_id);
                const senderName =
                  senderProfile?.display_name
                  || (senderProfile?.invite_code ? `PIN ${formatInviteCode(senderProfile.invite_code)}` : null)
                  || "Pengguna";
                const showSender = !mine && (meta.data?.kind !== "dm");
                const replyMsg = m.reply_to_id ? messageById.get(m.reply_to_id) : null;
                const replySender = replyMsg ? profiles.data?.get(replyMsg.sender_id) : null;
                const replySenderName =
                  replySender?.display_name
                  || (replySender?.invite_code ? `PIN ${formatInviteCode(replySender.invite_code)}` : null)
                  || "Pengguna";
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
                  <div
                    key={m.id}
                    id={`msg-${m.id}`}
                    className={`flex transition-colors duration-200 ${mine ? "justify-end" : "justify-start"} ${selectedIds.has(m.id) ? "bg-primary/10 rounded-md" : ""}`}
                  >
                    <div className={`group relative flex max-w-[80%] items-start gap-1 ${mine ? "flex-row-reverse" : "flex-row"}`}>
                      <div
                        className={`rounded-2xl px-3 py-1.5 text-sm leading-snug shadow-sm transition-[transform,box-shadow,background-color,ring] duration-200 ease-out active:scale-[0.985] [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] ${
                          m.deleted_at
                            ? `${mine ? "rounded-br-sm" : "rounded-bl-sm"} bg-muted/60 text-muted-foreground border border-dashed border-border`
                            : mine
                              ? "rounded-br-sm wa-bubble-out"
                              : "rounded-bl-sm wa-bubble-in"
                        } select-none touch-manipulation ${selectedIds.has(m.id) ? "ring-2 ring-primary" : ""}`}
                        onPointerDown={(e) => {
                          if (e.pointerType === "mouse" && e.button !== 0) return;
                          startLongPress(m);
                        }}
                        onPointerUp={cancelLongPress}
                        onPointerLeave={cancelLongPress}
                        onPointerCancel={cancelLongPress}
                        onClick={() => {
                          if (selectionMode) toggleSelect(m);
                        }}
                        onContextMenu={(e) => {
                          if (m.deleted_at) return;
                          e.preventDefault();
                          toggleSelect(m);
                        }}
                      >
                        {showSender ? (
                          <div className="mb-0.5 text-[10px] font-semibold opacity-80">{senderName}</div>
                        ) : null}
                        {m.pinned_at && !m.deleted_at ? (
                          <div className={`mb-0.5 inline-flex items-center gap-1 text-[10px] ${mine ? "text-primary-foreground/80" : "text-amber-600"}`}>
                            <Pin className="h-3 w-3" /> Disematkan
                          </div>
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
                              <MessagePreview message={replyMsg} />
                            </div>
                          </div>
                        ) : null}
                        {m.deleted_at ? (
                          (() => {
                            const hadAttachment = !!(m.attachment_path || m.attachment_mime || m.attachment_name);
                            const label = mine ? "Anda menghapus pesan ini" : "Pesan ini telah dihapus";
                            return (
                              <div
                                className="flex flex-col gap-0.5 italic text-muted-foreground"
                                aria-label={label}
                                title={`Dihapus ${new Date(m.deleted_at).toLocaleString("id-ID")}`}
                              >
                                <div className="flex items-center gap-1.5">
                                  <Ban className="h-3.5 w-3.5 shrink-0 opacity-80" />
                                  <span>{label}</span>
                                </div>
                                {hadAttachment ? (
                                  <div className="ml-5 text-[11px] not-italic opacity-80">
                                    Lampiran ikut dihapus
                                  </div>
                                ) : null}
                              </div>
                            );
                          })()
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
                                  <div className="whitespace-pre-wrap break-words">
                                    <Linkify text={m.body} />
                                  </div>
                                ) : null}
                                {!card && m.body ? (
                                  <UrlPreviewList text={m.body} mine={mine} />
                                ) : null}
                              </div>
                            );
                          })()
                        )}
                        <div
                          className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${
                            m.deleted_at
                              ? "text-muted-foreground/80"
                              : mine
                                ? "text-primary-foreground/70"
                                : "text-muted-foreground"
                          }`}
                          title={
                            m.deleted_at
                              ? `Dikirim ${new Date(m.created_at).toLocaleString("id-ID")} · Dihapus ${new Date(m.deleted_at).toLocaleString("id-ID")}`
                              : new Date(m.created_at).toLocaleString("id-ID")
                          }
                        >
                          {m.edited_at && !m.deleted_at ? <span className="italic">diedit</span> : null}
                          {(m.starred_by ?? []).length > 0 && !m.deleted_at ? (
                            <Star className="h-3 w-3 fill-current text-amber-400" aria-label="Berbintang" />
                          ) : null}
                          <span>{fmtTime(m.deleted_at ?? m.created_at)}</span>
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
                                const text = `${senderName}: ${safePreview(m)}`;
                                const res = await shareToWhatsApp({ text });
                                notifyShareResult(res);
                              }}
                            >
                              <Share2 className="mr-2 h-4 w-4" />
                              Teruskan via MCM
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => {
                                const text = m.deleted_at ? DELETED_PLACEHOLDER : (m.body ?? "");
                                navigator.clipboard?.writeText(text).then(
                                  () => toast.success("Teks pesan disalin"),
                                  () => toast.error("Gagal menyalin"),
                                );
                              }}
                            >
                              <Copy className="mr-2 h-4 w-4" />
                              Salin teks
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={async () => {
                                const ok = await confirm({
                                  title: "Hapus untuk saya?",
                                  description:
                                    "Pesan ini akan disembunyikan di perangkat Anda. Lawan chat masih bisa melihatnya.",
                                  confirmText: "Hapus",
                                  cancelText: "Batal",
                                  destructive: true,
                                });
                                if (!ok) return;
                                scheduleUndo({
                                  label: "Pesan akan disembunyikan",
                                  onCommit: () =>
                                    hideMsg.mutate(m.id, {
                                      onSuccess: () => {
                                        toast.success("Pesan disembunyikan untuk Anda");
                                        void logChatDelete({ conversationId, action: "for_me", messageId: m.id });
                                      },
                                      onError: (err) => toast.error(err instanceof Error ? err.message : "Gagal"),
                                    }),
                                });
                              }}
                            >
                              <EyeOff className="mr-2 h-4 w-4" />
                              Hapus untuk saya
                            </DropdownMenuItem>
                            {mine && m.body ? (
                              (() => {
                                const ageMin = (Date.now() - new Date(m.created_at).getTime()) / 60_000;
                                if (ageMin > 24 * 60) return null;
                                const sticker = parseStickerFromBody(m.body);
                                if (sticker) {
                                  return (
                                    <DropdownMenuItem
                                      onSelect={() => setEditStickerMsg({ id: m.id, body: m.body ?? "" })}
                                    >
                                      <StickerIcon className="mr-2 h-4 w-4" />
                                      Edit stiker
                                    </DropdownMenuItem>
                                  );
                                }
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
                                onSelect={async () => {
                                  const ok = await confirm({
                                    title: "Hapus untuk semua orang?",
                                    description:
                                      "Pesan akan dihapus dari sisi Anda dan lawan chat. Tindakan ini tidak bisa dibatalkan setelah beberapa detik.",
                                    confirmText: "Hapus untuk semua",
                                    cancelText: "Batal",
                                    destructive: true,
                                  });
                                  if (!ok) return;
                                  const restore = optimisticDeleteMessages(qc, conversationId, [m.id]);
                                  scheduleUndo({
                                    label: "Pesan akan dihapus untuk semua",
                                    onCancel: restore,
                                    onCommit: () =>
                                      deleteMsg.mutate(
                                        { id: m.id, attachment_path: m.attachment_path },
                                        {
                                          onSuccess: () => {
                                            toast.success("Pesan dihapus untuk semua");
                                            void logChatDelete({ conversationId, action: "for_all", messageId: m.id });
                                          },
                                          onError: (e) => {
                                            restore();
                                            toast.error(e instanceof Error ? e.message : "Gagal menghapus");
                                          },
                                        },
                                      ),
                                  });
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
                    <div className="whitespace-pre-wrap break-words">
                      <Linkify text={o.body} />
                    </div>
                    <UrlPreviewList text={o.body} mine />
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
                <MessagePreview message={replyTo} />
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
        <div className="relative flex items-end gap-2">
          {qrQuery !== null ? (
            <QuickReplyPopover
              query={qrQuery}
              onClose={() => setQrQuery(null)}
              onPick={(qr) => {
                setBody((prev) => {
                  const re = /\/(\w*)$/;
                  const m = re.exec(prev);
                  if (!m) return prev + qr.body;
                  return prev.slice(0, prev.length - m[0].length) + qr.body;
                });
                setQrQuery(null);
              }}
            />
          ) : null}
          <AttachMenu conversationId={conversationId} disabled={chatBlocked} onSent={() => { void othersRead.refetch(); }} />
          <Textarea
            value={body}
            onChange={(e) => {
              const v = e.target.value;
              setBody(v);
              if (v.length > 0) emitTyping();
              const m = /\/(\w*)$/.exec(v);
              setQrQuery(m ? m[1] : null);
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
                setConfirmAllOpen(false);
                scheduleUndo({
                  label: "Semua pesan Anda akan dihapus",
                  onCommit: () =>
                    deleteAllMine.mutate(undefined, {
                      onSuccess: (n) => {
                        toast.success(`${n} pesan dihapus`);
                        void logChatDelete({ conversationId, action: "all_mine", count: n });
                      },
                      onError: (err) =>
                        toast.error(err instanceof Error ? err.message : "Gagal menghapus"),
                    }),
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

      <AlertDialog open={!!longPressMsg} onOpenChange={(v) => { if (!v) setLongPressMsg(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus pesan?</AlertDialogTitle>
            <AlertDialogDescription>
              {longPressMsg?.sender_id === myId
                ? "Pilih cara menghapus pesan ini. \"Hapus untuk semua orang\" akan menghapus pesan dari sisi lawan chat juga."
                : "Pesan ini bukan milik Anda, jadi hanya bisa disembunyikan di perangkat Anda."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full justify-start"
              disabled={hideMsg.isPending}
              aria-busy={hideMsg.isPending}
              onClick={() => {
                const target = longPressMsg;
                if (!target) return;
                setLongPressMsg(null);
                scheduleUndo({
                  label: "Pesan akan disembunyikan",
                  onCommit: () =>
                    hideMsg.mutate(target.id, {
                      onSuccess: () => {
                        toast.success("Pesan disembunyikan untuk Anda");
                        void logChatDelete({ conversationId, action: "for_me", messageId: target.id });
                      },
                      onError: (err) => toast.error(err instanceof Error ? err.message : "Gagal"),
                    }),
                });
              }}
            >
              {hideMsg.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <EyeOff className="mr-2 h-4 w-4" />
              )}
              {hideMsg.isPending ? "Menghapus…" : "Hapus untuk saya"}
            </Button>
            {longPressMsg?.sender_id === myId ? (
              <Button
                variant="destructive"
                className="w-full justify-start"
                disabled={deleteMsg.isPending}
                aria-busy={deleteMsg.isPending}
                onClick={() => {
                  const target = longPressMsg;
                  if (!target) return;
                  setLongPressMsg(null);
                  const restore = optimisticDeleteMessages(qc, conversationId, [target.id]);
                  scheduleUndo({
                    label: "Pesan akan dihapus untuk semua",
                    onCancel: restore,
                    onCommit: () =>
                      deleteMsg.mutate(
                        { id: target.id, attachment_path: target.attachment_path },
                        {
                          onSuccess: () => {
                            toast.success("Pesan dihapus untuk semua");
                            void logChatDelete({ conversationId, action: "for_all", messageId: target.id });
                          },
                          onError: (e) => {
                            restore();
                            toast.error(e instanceof Error ? e.message : "Gagal menghapus");
                          },
                        },
                      ),
                  });
                }}
              >
                {deleteMsg.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                {deleteMsg.isPending ? "Menghapus…" : "Hapus untuk semua orang"}
              </Button>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
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

      {dmPeer ? (
        <EditContactNameDialog
          open={editNameOpen}
          onOpenChange={setEditNameOpen}
          peerKey={{
            peerUserId: dmPeer.peerUserId,
            peerPhone: dmPeer.peerPhone,
            peerEmail: dmPeer.peerEmail,
          }}
          initialName={displayedPeerName}
          fromAlias={!!peerAlias.data?.name}
        />
      ) : null}

      <ConversationSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        messages={visibleMessages}
        onJump={jumpToMessage}
      />
      <MediaLinksDialog
        open={mediaOpen}
        onOpenChange={setMediaOpen}
        messages={visibleMessages}
      />
      <MuteDialog
        open={muteOpen}
        onOpenChange={setMuteOpen}
        onPick={(until) => {
          setConvPrefs(myId ?? undefined, conversationId, { mutedUntil: until });
          toast.success("Notifikasi disenyapkan");
        }}
      />

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus {selectedMessages.length} pesan?</AlertDialogTitle>
            <AlertDialogDescription>
              Pilih cara penghapusan. “Hapus untuk semua orang” hanya berlaku untuk pesan yang Anda kirim.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full justify-start"
              disabled={hideMsg.isPending}
              onClick={async () => {
                const items = [...selectedMessages];
                setBulkDeleteOpen(false);
                clearSelection();
                scheduleUndo({
                  label: `${items.length} pesan akan disembunyikan`,
                  onCommit: async () => {
                    for (const m of items) {
                      await new Promise<void>((resolve) =>
                        hideMsg.mutate(m.id, { onSuccess: () => resolve(), onError: () => resolve() }),
                      );
                    }
                    toast.success(`${items.length} pesan disembunyikan`);
                    void logChatDelete({
                      conversationId,
                      action: "for_me_bulk",
                      messageIds: items.map((m) => m.id),
                    });
                  },
                });
              }}
            >
              <EyeOff className="mr-2 h-4 w-4" /> Hapus untuk saya
            </Button>
            {allMineSelected ? (
              <Button
                variant="destructive"
                className="w-full justify-start"
                disabled={deleteMsg.isPending}
                onClick={async () => {
                  const items = [...selectedMessages];
                  setBulkDeleteOpen(false);
                  clearSelection();
                  const restore = optimisticDeleteMessages(
                    qc,
                    conversationId,
                    items.map((m) => m.id),
                  );
                  scheduleUndo({
                    label: `${items.length} pesan akan dihapus untuk semua`,
                    onCancel: restore,
                    onCommit: async () => {
                      // Track per-item success. Failed items must be restored
                      // individually so the ones that succeeded stay marked
                      // deleted; a blanket restore was making the whole batch
                      // reappear after the "N pesan dihapus" toast.
                      const failedItems: typeof items = [];
                      let firstError: unknown = null;
                      for (const m of items) {
                        await new Promise<void>((resolve) =>
                          deleteMsg.mutate(
                            { id: m.id, attachment_path: m.attachment_path },
                            {
                              onSuccess: () => resolve(),
                              onError: (e) => {
                                failedItems.push(m);
                                if (!firstError) firstError = e;
                                resolve();
                              },
                            },
                          ),
                        );
                      }
                      if (failedItems.length > 0) {
                        // Restore snapshot then re-apply optimistic delete
                        // only for the IDs that actually succeeded, so failed
                        // rows revert while successes stay marked as deleted.
                        restore();
                        const okIds = items
                          .filter((it) => !failedItems.some((f) => f.id === it.id))
                          .map((it) => it.id);
                        if (okIds.length) optimisticDeleteMessages(qc, conversationId, okIds);
                      }
                      const ok = items.length - failedItems.length;
                      if (ok > 0) {
                        toast.success(
                          failedItems.length === 0
                            ? `${ok} pesan dihapus`
                            : `${ok} pesan dihapus, ${failedItems.length} gagal`,
                        );
                        void logChatDelete({
                          conversationId,
                          action: "for_all_bulk",
                          messageIds: items
                            .filter((it) => !failedItems.some((f) => f.id === it.id))
                            .map((m) => m.id),
                        });
                      } else {
                        toast.error(
                          firstError instanceof Error
                            ? `Gagal menghapus: ${firstError.message}`
                            : "Gagal menghapus pesan",
                        );
                      }
                      // Refresh from server so tombstones/failures are authoritative.
                      qc.invalidateQueries({ queryKey: ["chat", "messages", conversationId] });
                    },
                  });
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Hapus untuk semua orang
              </Button>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MessageInfoDialog
        open={infoOpen}
        onOpenChange={setInfoOpen}
        message={onlyOne}
        senderName={(() => {
          if (!onlyOne) return "";
          const sp = profiles.data?.get(onlyOne.sender_id);
          return onlyOne.sender_id === myId
            ? "Anda"
            : (
                sp?.display_name
                || (sp?.invite_code ? `PIN ${formatInviteCode(sp.invite_code)}` : null)
                || "Pengguna"
              );
        })()}
        readAtMs={othersRead.data}
      />

      <SecurityCodeDialog
        open={securityOpen}
        onOpenChange={setSecurityOpen}
        conversationId={conversationId}
        memberIds={members.data ?? []}
      />

      <TranslateDialog
        open={translateSource !== null}
        onOpenChange={(v) => { if (!v) setTranslateSource(null); }}
        source={translateSource ?? ""}
      />

      <SaveAsNoteDialog
        open={noteSource !== null}
        onOpenChange={(v) => { if (!v) setNoteSource(null); }}
        defaultBody={noteSource?.deleted_at ? DELETED_PLACEHOLDER : (previewText(noteSource?.body ?? null) ?? "")}
        conversationId={conversationId}
        sourceMessageId={noteSource?.id}
      />

      <SaveAsQuickReplyDialog
        open={qrSource !== null}
        onOpenChange={(v) => { if (!v) setQrSource(null); }}
        defaultBody={qrSource ?? ""}
      />

      <StickerPickerDialog
        conversationId={conversationId}
        open={editStickerMsg !== null}
        onOpenChange={(v) => { if (!v) setEditStickerMsg(null); }}
        initial={editStickerMsg ? parseStickerFromBody(editStickerMsg.body) : null}
        mode={
          editStickerMsg
            ? {
                kind: "edit",
                messageId: editStickerMsg.id,
                onCommit: async (newBody) => {
                  await editMsg.mutateAsync({ messageId: editStickerMsg.id, body: newBody });
                },
              }
            : { kind: "create" }
        }
      />
      </>
      )}
    </div>
  );
}

// Keep a hint link in case the room URL is opened directly without context.
export const ChatRoomFallbackLink = () => <Link to="/chat">Kembali ke daftar chat</Link>;