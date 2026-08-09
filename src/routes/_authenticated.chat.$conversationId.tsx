import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { scheduleUndo } from "@/lib/undo-action";
import { confirm } from "@/lib/confirm";
import { logChatDelete } from "@/lib/chat-delete-audit";
import { optimisticDeleteMessages } from "@/lib/chat-optimistic-delete";
import { describeChatError } from "@/lib/chat-error";
import { Linkify, UrlPreviewList } from "@/lib/linkify";
import {
  ArrowLeft, Send, Loader2, MessageCircle, MoreVertical, Trash2, Share2, Copy, Users,
  RefreshCw, WifiOff, Reply, Pencil, EyeOff, Smile, X, Ban, Star, Pin,
  History as HistoryIcon,
  Sticker as StickerIcon,
  Search as SearchIcon, Image as ImageIcon, BellOff, BellRing,
  Archive, ShoppingCart, UserPlus, MailWarning, MessageSquarePlus, Package,
  Minus, Plus, MapPin, ChevronUp, ChevronDown,
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
import { fmtBase } from "@/lib/stock-format";
import { parseWeightToGrams, parsePlainQty } from "@/lib/weight-parse";

// Batas rentang qty yang diizinkan sebelum disimpan. Nilai di luar rentang
// biasanya artefak salah ketik (mis. tanpa satuan) atau overflow yang tidak
// masuk akal untuk skala toko retail — clamp agar localStorage tidak
// pernah menyimpan angka korup.
const QTY_STEP_G = 100;    // gram: satu ons
const QTY_STEP_PCS = 1;
const QTY_MIN_G = 1;
const QTY_MIN_PCS = 1;
const QTY_MAX_G = 10_000_000;   // 10 000 kg
const QTY_MAX_PCS = 1_000_000;  // 1 juta pcs

/** Batas [min, max] dan step sesuai base unit. */
export function qtyBounds(baseUnit: "g" | "pcs" | null | undefined) {
  if (baseUnit === "g") {
    return { min: QTY_MIN_G, max: QTY_MAX_G, step: QTY_STEP_G };
  }
  return { min: QTY_MIN_PCS, max: QTY_MAX_PCS, step: QTY_STEP_PCS };
}

/** Clamp qty ke rentang yang diizinkan; kembalikan null bila tidak valid. */
export function clampQty(
  n: number | null | undefined,
  baseUnit: "g" | "pcs" | null | undefined,
): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const { min, max } = qtyBounds(baseUnit);
  if (n < min) return min;
  if (n > max) return max;
  // Bulatkan gram ke 0.001 dan pcs ke integer agar stabil di localStorage.
  return baseUnit === "g" ? Math.round(n * 1000) / 1000 : Math.round(n);
}

/**
 * Parse input mentah dari user (prompt / ketik) sesuai base unit.
 * - Untuk `g`: menerima "1 kg", "500 gr", "2 ons", "500 mg", atau angka.
 * - Untuk `pcs`: hanya angka positif (koma id-ID diterima).
 * Return `null` bila tidak valid.
 */
export function parseQtyInput(
  raw: string,
  baseUnit: "g" | "pcs" | null | undefined,
): number | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  const n = baseUnit === "g" ? parseWeightToGrams(s) : parsePlainQty(s);
  return clampQty(n, baseUnit);
}
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
import { uploadChatFile } from "@/lib/chat-attachments";
import { shareToWhatsApp, notifyShareResult } from "@/lib/share-wa";
import { ManageGroupDialog } from "@/components/chat/ManageGroupDialog";
import { EditContactNameDialog } from "@/components/chat/EditContactNameDialog";
import { PeerProfileDialog } from "@/components/chat/PeerProfileDialog";
import { EmojiPickerPopover } from "@/components/chat/EmojiPickerPopover";
import { VoiceRecorderButton } from "@/components/chat/VoiceRecorderButton";
import { Phone, Video as VideoIcon } from "lucide-react";
import { createCallRow } from "@/lib/calls";
import { ringUser } from "@/lib/webrtc";
import { dispatchStartCall } from "@/components/chat/CallHost";
import { usePeerAlias } from "@/lib/contact-alias";
import { AttachMenu } from "@/components/chat/AttachMenu";
import { MessageAttachment, CardBlock, UnknownCardBlock, decodeCard } from "@/components/chat/MessageAttachment";
import { MessageStatusIcon, messageStatusLabel } from "@/components/chat/MessageStatusIcon";
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
import { ProductSharePopover, sendProductRow, type PickedProductRow } from "@/components/chat/ProductSharePopover";

/**
 * Validasi & rapikan array PickedProductRow yang dibaca dari localStorage.
 *
 * Menerima dua bentuk storage:
 *  1. Format baru: `{ v: 2, items: PickedProductRow[] }`
 *  2. Format lama (v1): array `PickedProductRow[]` langsung — masih dibaca
 *     agar chip yang tersimpan sebelum upgrade tidak hilang.
 *
 * Mengembalikan:
 *  - `valid`: baris yang lolos schema (id/source/bucket/productName wajib
 *    ada, photoPaths berupa array string, source ∈ ready|self|catalog).
 *  - `dropped`: jumlah baris yang dibuang karena tidak lengkap.
 *  - `migrated`: jumlah baris yang perlu dinormalisasi (mis. `photoPath`
 *    tunggal → `photoPaths[]`, `qty` string → number, field baru diisi
 *    default `null`). Digunakan untuk memberi tahu user bahwa data lama
 *    sudah dirapikan.
 *  - `malformed`: `true` kalau root value bukan array maupun envelope
 *    yang dikenali.
 *  - `fromLegacy`: `true` kalau data dibaca dari format v1 (array polos).
 *    Setelah hydrate, penyimpan akan menulis ulang ke format v2.
 */
// Konstanta versi envelope diekspor ulang dari modul kecil supaya
// harness / spec e2e bisa mengimpor value yang persis sama tanpa
// perlu me-load seluruh route file. Local import di bawah tetap
// dibutuhkan karena file ini juga memakainya di banyak tempat.
import { PENDING_PRODUCTS_VERSION } from "@/lib/chat-queue-schema";
export { PENDING_PRODUCTS_VERSION };
function sanitizePendingProducts(
  raw: unknown,
): {
  valid: PickedProductRow[];
  dropped: number;
  migrated: number;
  malformed: boolean;
  fromLegacy: boolean;
} {
  let items: unknown;
  let fromLegacy = false;
  if (Array.isArray(raw)) {
    items = raw;
    fromLegacy = true;
  } else if (raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items)) {
    items = (raw as { items: unknown[] }).items;
    const v = (raw as { v?: unknown }).v;
    if (typeof v !== "number" || v !== PENDING_PRODUCTS_VERSION) {
      // Envelope dikenali tapi versi berbeda — perlakukan seperti legacy
      // supaya penyimpan menulis ulang ke versi saat ini.
      fromLegacy = true;
    }
  } else {
    return { valid: [], dropped: 0, migrated: 0, malformed: true, fromLegacy: false };
  }
  const allowedSource = new Set(["ready", "self", "catalog"]);
  const allowedBucket = new Set(["ready-packages", "self-prep-photos", "item-photos"]);
  const allowedUnit = new Set(["g", "pcs"]);
  const valid: PickedProductRow[] = [];
  let dropped = 0;
  let migrated = 0;
  for (const item of items as unknown[]) {
    if (!item || typeof item !== "object") { dropped++; continue; }
    const r = item as Record<string, unknown>;
    // ── photoPaths ──
    // Legacy hanya menyimpan `photoPath` tunggal; hidupkan sebagai array
    // 1-elemen supaya UI baru tetap merender thumbnail.
    const hasPhotoPathsArr = Array.isArray(r.photoPaths);
    let needsMigration = false;
    const photoPaths = hasPhotoPathsArr
      ? ((r.photoPaths as unknown[]).filter((p): p is string => typeof p === "string"))
      : typeof r.photoPath === "string" && r.photoPath
        ? (needsMigration = true, [r.photoPath])
        : [];
    if (
      typeof r.id !== "string" || !r.id ||
      typeof r.source !== "string" || !allowedSource.has(r.source) ||
      typeof r.bucket !== "string" || !allowedBucket.has(r.bucket) ||
      typeof r.productName !== "string" || !r.productName
    ) { dropped++; continue; }
    // ── baseUnit ──
    let baseUnit: PickedProductRow["baseUnit"] = null;
    if (r.baseUnit === null) {
      baseUnit = null;
    } else if (typeof r.baseUnit === "string" && allowedUnit.has(r.baseUnit)) {
      baseUnit = r.baseUnit as PickedProductRow["baseUnit"];
    } else if (r.baseUnit !== undefined) {
      needsMigration = true;
    } else {
      needsMigration = true;
    }
    // ── qty ── (izinkan string angka legacy)
    let qty: number | null = null;
    if (typeof r.qty === "number" && Number.isFinite(r.qty)) {
      qty = r.qty;
    } else if (typeof r.qty === "string" && r.qty.trim() !== "") {
      const n = Number(r.qty);
      if (Number.isFinite(n)) { qty = n; needsMigration = true; }
    } else if (r.qty === undefined) {
      needsMigration = true;
    }
    // Clamp ke rentang yang diizinkan; nilai di luar batas dianggap
    // korupsi dan dinormalisasi (mis. hasil edit manual localStorage).
    if (qty !== null) {
      const clamped = clampQty(qty, baseUnit);
      if (clamped !== qty) needsMigration = true;
      qty = clamped;
    }
    // ── variant / locationUrl ── (opsional, default null)
    const variant = typeof r.variant === "string" ? r.variant : null;
    if (r.variant === undefined) needsMigration = true;
    const locationUrl = typeof r.locationUrl === "string" ? r.locationUrl : null;
    if (r.locationUrl === undefined) needsMigration = true;
    if (!hasPhotoPathsArr) needsMigration = true;
    if (needsMigration) migrated++;
    valid.push({
      id: r.id,
      source: r.source as PickedProductRow["source"],
      bucket: r.bucket as PickedProductRow["bucket"],
      productName: r.productName,
      baseUnit,
      qty,
      variant,
      photoPath: typeof r.photoPath === "string" ? r.photoPath : (photoPaths[0] ?? null),
      photoPaths,
      locationUrl,
    });
  }
  return { valid, dropped, migrated, malformed: false, fromLegacy };
}
import { CartComposer } from "@/components/chat/CartComposer";
import {
  ConversationSearchDialog,
  MediaLinksDialog,
  MuteDialog,
} from "@/components/chat/ConversationExtrasDialogs";
import { useConvPrefs, setConvPrefs } from "@/lib/conversation-prefs";
import { ChatHeaderDebtControls } from "@/components/chat/ChatHeaderDebtControls";
import { OrderSummaryCard } from "@/components/chat/OrderSummaryCard";
import { useVisualViewportKeyboardInset } from "@/hooks/use-visual-viewport-inset";
import { StatusBadge } from "@/components/StatusBadge";
import { usePinMessage, useStarMessage } from "@/lib/chat-extras";
import { isCardBody } from "@/lib/chat-cards";
import { goBackOr } from "@/lib/back-nav";
import { ChatMessagesSkeleton } from "@/components/chat/ChatSkeletons";
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
  const router = useRouter();
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
  const [startingCall, setStartingCall] = useState(false);
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

  // ---- Windowing daftar pesan -------------------------------------------
  // Percakapan memuat sampai 500 pesan, tapi merender semuanya membuat tiap
  // re-render (ketik, presence, realtime) menyentuh ratusan node — inilah
  // penyebab utama scroll tersendat di HP. Kita hanya merender N pesan
  // terakhir dan menambah jendela saat pengguna minta pesan lama.
  const RENDER_STEP = 60;
  const [renderCount, setRenderCount] = useState(RENDER_STEP);
  const visibleRef = useRef<MessageRow[]>([]);
  useEffect(() => { setRenderCount(RENDER_STEP); }, [conversationId]);

  // Jump-to-message helper (used by pinned banner)
  const jumpToMessage = useCallback((id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) {
      // Pesan berada di luar jendela render → lebarkan jendela dulu,
      // lalu coba lompat lagi setelah DOM ter-update.
      const list = visibleRef.current;
      const i = list.findIndex((m) => m.id === id);
      if (i < 0) return;
      const needed = list.length - i + 10;
      setRenderCount((prev) => (needed > prev ? needed : prev));
      requestAnimationFrame(() => {
        const again = document.getElementById(`msg-${id}`);
        if (!again) return;
        again.scrollIntoView({ behavior: "smooth", block: "center" });
        again.classList.add("ring-2", "ring-warning");
        setTimeout(() => again.classList.remove("ring-2", "ring-warning"), 1500);
      });
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-warning");
    setTimeout(() => el.classList.remove("ring-2", "ring-warning"), 1500);
  }, []);

  // ---- Pencarian cepat di dalam percakapan -------------------------------
  // Bilah tipis di bawah header: mencari pada pesan yang sudah dimuat,
  // menyorot semua kecocokan, dan menyediakan navigasi hasil ↑/↓.
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState("");
  // Filter pengirim untuk pencarian cepat: semua / hanya saya / hanya lawan bicara.
  const [quickFrom, setQuickFrom] = useState<"all" | "me" | "them">("all");
  const [quickIdx, setQuickIdx] = useState(0);

  // Quick reply popover state (driven by `/shortcut` in composer)
  const [qrQuery, setQrQuery] = useState<string | null>(null);

  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);
  // Menelan event `click` berikutnya di capture-phase setelah long-press
  // terpicu. Tanpa ini, browser tetap mem-dispatch `click` saat jari
  // diangkat — tidak hanya di bubble sumber, tapi bisa juga di elemen
  // lain jika jari sudah bergeser. Guard di onClick lokal saja tidak
  // cukup untuk menutup semua jalur.
  const swallowNextClick = useCallback(() => {
    const handler = (ev: MouseEvent) => {
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      ev.preventDefault();
      window.removeEventListener("click", handler, true);
    };
    window.addEventListener("click", handler, true);
    // Safety: jika `click` tidak pernah datang (mis. pointercancel),
    // lepas listener setelah satu frame agar tidak menelan klik nyata.
    window.setTimeout(() => {
      window.removeEventListener("click", handler, true);
    }, 350);
  }, []);
  const startLongPress = useCallback((m: MessageRow) => {
    if (m.deleted_at) return;
    longPressFired.current = false;
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      swallowNextClick();
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
  }, [swallowNextClick]);
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

  // Izin "hapus untuk semua" harus sama persis dengan RPC
  // `message_delete_for_all`: pengirim pesan ATAU pemilik percakapan (admin
  // grup). Sebelumnya UI hanya memakai `mine`, jadi admin grup tidak pernah
  // melihat opsi itu walau server mengizinkan.
  const iAmConvOwner = !!myId && meta.data?.owner_user_id === myId;
  const canDeleteForAll = (senderId: string | null | undefined) =>
    (!!myId && senderId === myId) || iAmConvOwner;
  // Kegagalan hapus WAJIB terlihat: tampilkan alasan (offline / izin / sesi)
  // bukan hanya mengembalikan UI diam-diam.
  const notifyDeleteError = (e: unknown, action = "menghapus pesan") => {
    const info = describeChatError(e, action);
    toast.error(info.title, { description: info.description, duration: 8000 });
  };

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
      peerEmail: null,
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
  const [peerProfileOpen, setPeerProfileOpen] = useState(false);

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
        .select("user_id, last_read_at, last_delivered_at")
        .eq("conversation_id", conversationId);
      if (error) throw error;
      let minRead: number | null = null;
      let minDelivered: number | null = null;
      for (const r of data ?? []) {
        if (r.user_id === myId) continue;
        const t = r.last_read_at ? new Date(r.last_read_at).getTime() : 0;
        if (minRead === null || t < minRead) minRead = t;
        const d = r.last_delivered_at ? new Date(r.last_delivered_at).getTime() : 0;
        // Membuka chat = pasti sudah sampai; ambil yang paling baru.
        const dd = Math.max(d, t);
        if (minDelivered === null || dd < minDelivered) minDelivered = dd;
      }
      return { read: minRead, delivered: minDelivered };
    },
    // H13: rely on the postgres_changes subscription below instead of polling.
  });

  // H13: realtime read-receipt updates for other members.
  useEffect(() => {
    if (!myId) return;
    const ch = supabase
      .channel(`chat-members-read:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversation_members",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          qc.invalidateQueries({
            queryKey: ["chat", "conv-others-read", conversationId, myId],
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [conversationId, myId, qc]);

  // Typing indicator via Realtime broadcast
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // H12: reference profiles.data via a ref so the typing channel isn't
  // torn down and recreated every time the profiles query refetches.
  const profilesRef = useRef(profiles.data);
  useEffect(() => {
    profilesRef.current = profiles.data;
  }, [profiles.data]);
  useEffect(() => {
    if (!myId) return;
    const ch = supabase.channel(`chat-typing:${conversationId}`, {
      config: { broadcast: { self: false } },
    });
    ch.on("broadcast", { event: "typing" }, (msg) => {
      const uid = (msg.payload as { userId?: string } | undefined)?.userId;
      if (!uid || uid === myId) return;
      const p = profilesRef.current?.get(uid);
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
  }, [conversationId, myId]);

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
  const isNearBottomRef = useRef(true);
  const [hasNewBelow, setHasNewBelow] = useState(false);
  const NEAR_BOTTOM_PX = 120;
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    isNearBottomRef.current = true;
    setHasNewBelow(false);
  }, []);
  const onScrollerScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distance <= NEAR_BOTTOM_PX;
    isNearBottomRef.current = near;
    if (near) setHasNewBelow(false);
  }, []);
  // Initial land at bottom whenever we switch conversation. Media (images,
  // stickers, link previews) load async and grow the scroller AFTER we mount,
  // sehingga scroll tunggal terlalu awal sering meninggalkan user di tengah
  // riwayat. Solusinya: reset saat pindah conversation, lalu paksa scroll di
  // beberapa titik waktu (setelah messages siap, setelah 2× rAF, dan sekali
  // lagi setelah 250ms untuk menampung gambar yang baru selesai layout).
  const didInitialScrollRef = useRef(false);
  useEffect(() => {
    didInitialScrollRef.current = false;
    isNearBottomRef.current = true;
    setHasNewBelow(false);
  }, [conversationId]);
  useEffect(() => {
    if (didInitialScrollRef.current) return;
    const count = messages?.length ?? 0;
    if (count === 0) return;
    didInitialScrollRef.current = true;
    const el = scrollerRef.current;
    if (!el) return;
    const stick = () => {
      const s = scrollerRef.current;
      if (!s) return;
      s.scrollTop = s.scrollHeight;
    };
    stick();
    const r1 = requestAnimationFrame(() => {
      stick();
      const r2 = requestAnimationFrame(stick);
      (el as HTMLElement & { __r2?: number }).__r2 = r2;
    });
    const t1 = window.setTimeout(stick, 120);
    const t2 = window.setTimeout(stick, 400);
    // Setelah gambar/thumbnail yang belum ter-load selesai, geser lagi ke bawah
    // agar tidak terlihat "ngambang" di tengah.
    const imgs = Array.from(el.querySelectorAll("img")) as HTMLImageElement[];
    const onImg = () => stick();
    imgs.forEach((img) => {
      if (!img.complete) img.addEventListener("load", onImg, { once: true });
    });
    return () => {
      cancelAnimationFrame(r1);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      imgs.forEach((img) => img.removeEventListener("load", onImg));
    };
  }, [conversationId, messages?.length]);
  // On new messages, only stick if user is near bottom; else surface a
  // "pesan baru" pill so the user can jump on demand.
  const prevMsgCountRef = useRef(0);
  useEffect(() => {
    const count = messages?.length ?? 0;
    const grew = count > prevMsgCountRef.current;
    prevMsgCountRef.current = count;
    if (!grew) return;
    if (isNearBottomRef.current) {
      const el = scrollerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    } else {
      setHasNewBelow(true);
    }
  }, [messages?.length]);

  const [body, setBody] = useState("");
  // Antrian produk yang dipilih dari popover 📦. Tampil sebagai chip preview
  // di atas textarea; baru terkirim saat user menekan tombol Kirim.
  const [pendingProducts, setPendingProducts] = useState<PickedProductRow[]>([]);

  // Antrian lampiran (foto/video/dokumen) yang di-stage dari AttachMenu.
  // Tidak dipersist — cukup sesi aktif; baru diunggah + terkirim saat user
  // menekan tombol Kirim. Textarea otomatis menjadi caption pada lampiran
  // pertama (mirip WhatsApp).
  type PendingAttachment = { id: string; file: File; previewUrl: string | null };
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentSendStatuses, setAttachmentSendStatuses] = useState<
    Record<string, "pending" | "sending" | "failed">
  >({});
  const nextAttachmentId = useCallback(() => {
    try {
      const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
      if (c?.randomUUID) return c.randomUUID();
    } catch { /* ignore */ }
    return `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }, []);
  const stageAttachments = useCallback((files: File[]) => {
    setPendingAttachments((prev) => {
      const add: PendingAttachment[] = files.map((f) => ({
        id: nextAttachmentId(),
        file: f,
        previewUrl:
          f.type.startsWith("image/") || f.type.startsWith("video/")
            ? URL.createObjectURL(f)
            : null,
      }));
      return [...prev, ...add];
    });
  }, [nextAttachmentId]);
  const removeAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => {
      const found = prev.find((p) => p.id === id);
      if (found?.previewUrl) { try { URL.revokeObjectURL(found.previewUrl); } catch { /* ignore */ } }
      return prev.filter((p) => p.id !== id);
    });
    setAttachmentSendStatuses((prev) => {
      if (!prev[id]) return prev;
      const { [id]: _drop, ...rest } = prev;
      return rest;
    });
  }, []);
  const clearAttachments = useCallback(() => {
    setPendingAttachments((prev) => {
      prev.forEach((p) => {
        if (p.previewUrl) { try { URL.revokeObjectURL(p.previewUrl); } catch { /* ignore */ } }
      });
      return [];
    });
    setAttachmentSendStatuses({});
  }, []);
  // Bersihkan object URL saat unmount.
  useEffect(() => {
    return () => {
      setPendingAttachments((prev) => {
        prev.forEach((p) => {
          if (p.previewUrl) { try { URL.revokeObjectURL(p.previewUrl); } catch { /* ignore */ } }
        });
        return prev;
      });
    };
  }, []);

  // Persist chip pratinjau produk per-percakapan supaya tetap ada setelah
  // refresh atau navigasi keluar-masuk chat. Baru dibersihkan setelah user
  // menekan Kirim (atau menghapus chip manual).
  const pendingProductsKey = conversationId
    ? `mcm.chat.pendingProducts.${conversationId}`
    : null;
  // Status singkat yang muncul setelah localStorage tertulis sinkron. Tidak
  // menggantikan toast migrasi/error — hanya memberi jaminan visual bahwa
  // perubahan qty/hapus chip sudah aman di penyimpanan lokal.
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashSaved = useCallback(() => {
    setSaveStatus("saved");
    if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
    saveStatusTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
  }, []);
  // Tulis nilai `pendingProducts` ke localStorage SEKARANG (tidak menunggu
  // effect). Dipakai oleh handler +/− dan prompt qty supaya perubahan tetap
  // aman walau tab langsung ditutup sebelum React sempat menjalankan effect
  // penyimpan. StrictMode boleh memanggil setter dua kali di dev — tulisan
  // idempoten sehingga aman.
  // Jalankan kembali sanitizer melalui envelope versi saat ini. Ini
  // menjamin: (a) row rusak yang entah bagaimana masuk state tidak ikut
  // ditulis, (b) qty/baseUnit/variant/locationUrl tetap sesuai kontrak,
  // (c) envelope yang ditulis selalu bernomor versi terkini — jadi
  // refresh berulang tidak bisa "menua" ke bentuk legacy.
  const normalizePending = useCallback((next: PickedProductRow[]): PickedProductRow[] => {
    const { valid } = sanitizePendingProducts({ v: PENDING_PRODUCTS_VERSION, items: next });
    return valid;
  }, []);
  const persistPendingRef = useRef<(next: PickedProductRow[]) => void>(() => {});
  persistPendingRef.current = (next: PickedProductRow[]) => {
    if (!pendingProductsKey) return;
    if (typeof window === "undefined") return;
    try {
      if (next.length === 0) {
        window.localStorage.removeItem(pendingProductsKey);
      } else {
        window.localStorage.setItem(
          pendingProductsKey,
          JSON.stringify({ v: PENDING_PRODUCTS_VERSION, items: next }),
        );
      }
      flashSaved();
    } catch { /* ignore quota */ }
  };
  // Wrapper untuk update+persist dalam satu langkah. Menerima nilai baru
  // atau updater fungsional; menormalkan hasilnya lewat sanitizer sebelum
  // ditulis ke localStorage — jadi tiap perubahan qty menulis ulang
  // envelope versi terbaru yang bersih.
  const updatePendingProducts = useCallback(
    (next: PickedProductRow[] | ((prev: PickedProductRow[]) => PickedProductRow[])) => {
      setPendingProducts((prev) => {
        const computed = typeof next === "function"
          ? (next as (p: PickedProductRow[]) => PickedProductRow[])(prev)
          : next;
        const normalized = normalizePending(computed);
        persistPendingRef.current(normalized);
        return normalized;
      });
    },
    [normalizePending],
  );
  const pendingHydratedRef = useRef(false);
  useEffect(() => () => {
    if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
  }, []);
  useEffect(() => {
    pendingHydratedRef.current = false;
    if (!pendingProductsKey) return;
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(pendingProductsKey);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        const { valid, dropped, migrated, malformed, fromLegacy } =
          sanitizePendingProducts(parsed);
        setPendingProducts(valid);
        if (malformed) {
          toast.error("Pratinjau produk rusak — daftar dikosongkan.", {
            id: `pending-corrupt-${pendingProductsKey}`,
            description: "Data tersimpan tidak dikenali dan sudah dibersihkan.",
          });
          try { window.localStorage.removeItem(pendingProductsKey); } catch { /* ignore */ }
        } else if (dropped > 0) {
          toast.warning(
            `${dropped} pratinjau produk dilewati karena datanya tidak lengkap.`,
            {
              id: `pending-dropped-${pendingProductsKey}`,
              description: "Silakan pilih ulang produk yang hilang dari 📦.",
            },
          );
        }
        if (!malformed && (migrated > 0 || fromLegacy)) {
          // Tulis ulang segera ke format v2 supaya kunjungan berikutnya
          // tidak perlu migrasi lagi. Effect penyimpan juga akan menulis,
          // tetapi menulis di sini menjamin envelope terbaru walau user
          // langsung menutup tab.
          try {
            if (valid.length === 0) {
              window.localStorage.removeItem(pendingProductsKey);
            } else {
              window.localStorage.setItem(
                pendingProductsKey,
                JSON.stringify({ v: PENDING_PRODUCTS_VERSION, items: valid }),
              );
            }
          } catch { /* ignore quota */ }
          if (migrated > 0) {
            toast.info(
              `${migrated} pratinjau produk diperbarui ke format baru.`,
              {
                id: `pending-migrated-${pendingProductsKey}`,
                description: "Jumlah, unit, varian, dan lokasi kini ditampilkan bila tersedia.",
              },
            );
          }
        }
      } else {
        setPendingProducts([]);
      }
    } catch {
      setPendingProducts([]);
      if (pendingProductsKey) {
        toast.error("Pratinjau produk rusak — daftar dikosongkan.", {
          id: `pending-parse-${pendingProductsKey}`,
          description: "File pratinjau tidak bisa dibaca.",
        });
        try { window.localStorage.removeItem(pendingProductsKey); } catch { /* ignore */ }
      }
    }
    pendingHydratedRef.current = true;
  }, [pendingProductsKey]);
  useEffect(() => {
    if (!pendingProductsKey) return;
    if (!pendingHydratedRef.current) return;
    if (typeof window === "undefined") return;
    try {
      if (pendingProducts.length === 0) {
        window.localStorage.removeItem(pendingProductsKey);
      } else {
        window.localStorage.setItem(
          pendingProductsKey,
          JSON.stringify({ v: PENDING_PRODUCTS_VERSION, items: pendingProducts }),
        );
      }
    } catch { /* ignore quota */ }
  }, [pendingProductsKey, pendingProducts]);

  // Prefill komposer dari flow lain (mis. Penyiapan Request → Buka Chat Ace).
  // Handoff via localStorage key `mcm.chat.prefill.<convId>` supaya bisa
  // dipakai dari navigate tanpa mengubah tipe search params rute.
  useEffect(() => {
    if (!conversationId) return;
    if (typeof window === "undefined") return;
    const key = `mcm.chat.prefill.${conversationId}`;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw && raw.trim()) {
        setBody((prev) => (prev && prev.trim() ? prev : raw));
        window.localStorage.removeItem(key);
      }
    } catch { /* ignore */ }
  }, [conversationId]);

  // ---- Outbox (optimistic send + retry on failure / reconnect) ----
  type OutboxItem = {
    tempId: string;
    body: string;
    status: "queued" | "sending" | "failed";
    error?: string;
    /** Berapa kali percobaan kirim sudah dilakukan (untuk backoff & UI). */
    attempts?: number;
    createdAt: string;
    replyToId?: string;
  };
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  // Ref bayangan supaya timer retry tidak mengirim ulang item yang sudah
  // dibuang user (setTimeout memegang salinan lama dari state).
  const outboxRef = useRef<OutboxItem[]>([]);
  useEffect(() => { outboxRef.current = outbox; }, [outbox]);
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
      // Offline: jangan buang percobaan — tandai "menunggu koneksi" dan
      // biarkan effect reconnect yang melanjutkan.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setOutbox((prev) =>
          prev.map((o) => (o.tempId === item.tempId ? { ...o, status: "queued", error: undefined } : o)),
        );
        return;
      }
      setOutbox((prev) =>
        prev.map((o) =>
          o.tempId === item.tempId
            ? { ...o, status: "sending", error: undefined, attempts: (o.attempts ?? 0) + 1 }
            : o,
        ),
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
        toast.error(`Pesan gagal terkirim: ${msg}`);
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

  const sendingLockRef = useRef(false);
  const [isSending, setIsSending] = useState(false);
  const [productSendProgress, setProductSendProgress] = useState<{
    current: number;
    total: number;
    name: string;
    done: number;
    failed: number;
  } | null>(null);
  // Status kirim per-produk (keyed oleh row.id) supaya owner tahu kartu
  // mana yang menunggu, sedang mengirim, atau gagal — item sukses langsung
  // dibuang dari pratinjau, jadi tidak perlu state "success" persist.
  const [productSendStatuses, setProductSendStatuses] = useState<
    Record<string, "pending" | "sending" | "failed">
  >({});
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = body.trim();
    if (!t && pendingProducts.length === 0 && pendingAttachments.length === 0) return;
    if (sendingLockRef.current) return;
    sendingLockRef.current = true;
    setIsSending(true);
    // Buka kunci pada frame berikutnya — cegah double-submit dari tap ganda
    // atau Enter beruntun, tanpa mem-block antrian kirim beruntun yang sah.
    setTimeout(() => {
      sendingLockRef.current = false;
      setIsSending(false);
    }, 300);
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
    const replyId = replyTo?.id ?? null;
    const hasAttachments = pendingAttachments.length > 0;
    // Kirim teks (kalau ada) via jalur outbox biasa — kecuali ada lampiran,
    // maka teks akan dipakai sebagai caption pada lampiran pertama.
    if (t && !hasAttachments) {
      const item: OutboxItem = {
        tempId: `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        body: t,
        status: "sending",
        createdAt: new Date().toISOString(),
      };
      setOutbox((prev) => [...prev, item]);
      void doSendWith(item, replyId);
    }
    // Unggah + kirim lampiran (foto/video/dokumen) yang di-stage dari
    // AttachMenu. Caption dari textarea otomatis menempel pada lampiran
    // pertama saja (perilaku ala WhatsApp).
    if (hasAttachments) {
      const queue = pendingAttachments.slice();
      const captionForFirst = t;
      setAttachmentSendStatuses(() => {
        const next: Record<string, "pending" | "sending" | "failed"> = {};
        for (const a of queue) next[a.id] = "pending";
        return next;
      });
      const progressToast = toast.loading(`Mengirim 0 dari ${queue.length} lampiran…`);
      void (async () => {
        let done = 0;
        let failed = 0;
        for (let i = 0; i < queue.length; i++) {
          const a = queue[i];
          setAttachmentSendStatuses((prev) => ({ ...prev, [a.id]: "sending" }));
          toast.loading(`Mengirim ${i + 1}/${queue.length}: ${a.file.name}…`, { id: progressToast });
          try {
            const up = await uploadChatFile({ conversationId, file: a.file });
            await sendMessage({
              data: {
                conversationId,
                attachmentPath: up.path,
                attachmentMime: up.mime,
                attachmentName: up.name,
                attachmentSize: up.size,
                ...(i === 0 && captionForFirst ? { body: captionForFirst } : {}),
              },
            });
            done++;
            // Buang dari pratinjau segera setelah sukses.
            setPendingAttachments((prev) => {
              const found = prev.find((p) => p.id === a.id);
              if (found?.previewUrl) { try { URL.revokeObjectURL(found.previewUrl); } catch { /* ignore */ } }
              return prev.filter((p) => p.id !== a.id);
            });
            setAttachmentSendStatuses((prev) => {
              const { [a.id]: _drop, ...rest } = prev;
              return rest;
            });
          } catch (err) {
            failed++;
            setAttachmentSendStatuses((prev) => ({ ...prev, [a.id]: "failed" }));
            toast.error((err as Error)?.message || `Gagal mengirim: ${a.file.name}`);
          }
        }
        toast.dismiss(progressToast);
        if (failed === 0) {
          toast.success(queue.length > 1 ? `${done} lampiran terkirim` : `Lampiran terkirim`);
        } else if (done === 0) {
          toast.error(`Semua ${queue.length} lampiran gagal — tekan Kirim untuk coba lagi`);
        } else {
          toast.warning(`${done} terkirim, ${failed} gagal — item gagal masih di composer`);
        }
        void othersRead.refetch();
      })();
    }
    // Kirim produk-produk yang di-queue secara berurutan supaya urutan
    // pesan konsisten dan status/riwayat paket ter-update satu-satu.
    if (pendingProducts.length > 0) {
      const queue = pendingProducts.slice();
      setProductSendProgress({ current: 0, total: queue.length, name: "", done: 0, failed: 0 });
      // Reset status per-item: semua "menunggu" sebelum loop mulai.
      setProductSendStatuses(() => {
        const next: Record<string, "pending" | "sending" | "failed"> = {};
        for (const r of queue) next[r.id] = "pending";
        return next;
      });
      const progressToast = toast.loading(`Mengirim 0 dari ${queue.length} produk…`);
      void (async () => {
        let done = 0;
        let failed = 0;
        const sentIds: string[] = [];
        for (let i = 0; i < queue.length; i++) {
          const row = queue[i];
          setProductSendProgress({ current: i + 1, total: queue.length, name: row.productName, done, failed });
          setProductSendStatuses((prev) => ({ ...prev, [row.id]: "sending" }));
          toast.loading(`Mengirim ${i + 1}/${queue.length}: ${row.productName}…`, { id: progressToast });
          try {
            const ok = await sendProductRow(row, {
              conversationId,
              peerName: displayedPeerName,
              silent: true,
            });
            if (ok) {
              done++;
              sentIds.push(row.id);
              // Buang dari daftar pratinjau segera setelah sukses, supaya
              // yang tersisa di composer hanya item yang belum/gagal terkirim
              // dan owner bisa langsung retry tanpa menyusun ulang.
              updatePendingProducts((prev) => prev.filter((p) => p.id !== row.id));
              setProductSendStatuses((prev) => {
                const { [row.id]: _drop, ...rest } = prev;
                return rest;
              });
              toast.success(`Terkirim: ${row.productName}`, { id: `prod-ok-${row.id}-${i}` });
            } else {
              failed++;
              setProductSendStatuses((prev) => ({ ...prev, [row.id]: "failed" }));
              toast.error(`Gagal mengirim: ${row.productName}`, { id: `prod-err-${row.id}-${i}` });
            }
          } catch (err) {
            failed++;
            setProductSendStatuses((prev) => ({ ...prev, [row.id]: "failed" }));
            toast.error((err as Error)?.message || `Gagal mengirim: ${row.productName}`, { id: `prod-err-${row.id}-${i}` });
          }
          setProductSendProgress((prev) => (prev ? { ...prev, done, failed } : prev));
        }
        toast.dismiss(progressToast);
        if (failed === 0) {
          toast.success(`${done} produk berhasil dikirim`);
        } else if (done === 0) {
          toast.error(`Semua ${queue.length} produk gagal dikirim — masih di composer, tekan Kirim untuk coba lagi`);
        } else {
          toast.warning(`${done} terkirim, ${failed} gagal — item gagal masih di composer, tekan Kirim untuk coba lagi`);
        }
        setProductSendProgress(null);
        void othersRead.refetch();
      })();
    }
    setBody("");
    setReplyTo(null);
  };

  // Auto-retry: (1) langsung saat koneksi kembali, (2) backoff bertingkat
  // 2s → 4s → 8s untuk maksimal 3 percobaan otomatis. Setelah itu pesan
  // berhenti di status "gagal" dan menunggu keputusan pengguna, supaya
  // tidak ada pengiriman berulang tanpa henti di jaringan buruk.
  const MAX_AUTO_ATTEMPTS = 3;
  const retryTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => {
    const timers = retryTimers.current;
    return () => { timers.forEach((t) => clearTimeout(t)); timers.clear(); };
  }, []);
  const prevOnlineRef = useRef(online);
  useEffect(() => {
    const backOnline = !prevOnlineRef.current && online;
    prevOnlineRef.current = online;
    if (!online) return;
    for (const o of outbox) {
      const attempts = o.attempts ?? 0;
      const isQueued = o.status === "queued";
      const retryable = isQueued || (o.status === "failed" && attempts < MAX_AUTO_ATTEMPTS);
      if (!retryable) continue;
      if (retryTimers.current.has(o.tempId)) continue;
      const delay = backOnline || isQueued ? 0 : Math.min(8000, 2000 * 2 ** (attempts - 1));
      const t = setTimeout(() => {
        retryTimers.current.delete(o.tempId);
        const live = outboxRef.current.find((x) => x.tempId === o.tempId);
        if (live && live.status !== "sending") void doSend(live);
      }, delay);
      retryTimers.current.set(o.tempId, t);
    }
  }, [online, outbox, doSend]);

  const failedCount = outbox.filter((o) => o.status === "failed").length;
  /** Kirim ulang manual: reset hitungan percobaan supaya backoff mulai dari awal. */
  const manualRetry = useCallback(
    (item: OutboxItem) => {
      setOutbox((prev) => prev.map((o) => (o.tempId === item.tempId ? { ...o, attempts: 0 } : o)));
      void doSend(item);
    },
    [doSend],
  );
  const retryAllFailed = useCallback(() => {
    outboxRef.current.filter((o) => o.status === "failed").forEach(manualRetry);
  }, [manualRetry]);

  // Group messages by day
  const grouped = useMemo(() => {
    const out: { day: string; items: MessageRow[] }[] = [];
    const list =
      visibleMessages.length > renderCount
        ? visibleMessages.slice(visibleMessages.length - renderCount)
        : visibleMessages;
    for (const m of list) {
      const day = fmtDay(m.created_at);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(m);
      else out.push({ day, items: [m] });
    }
    return out;
  }, [visibleMessages, renderCount]);
  visibleRef.current = visibleMessages;
  const hiddenOlderCount = Math.max(0, visibleMessages.length - renderCount);

  // Pinned messages (sorted by pinned_at desc, max 3)
  const pinnedMessages = useMemo(() => {

    return (visibleMessages ?? [])
      .filter((m) => !!m.pinned_at && !m.deleted_at)
      .sort((a, b) => (b.pinned_at ?? "").localeCompare(a.pinned_at ?? ""))
      .slice(0, 3);
  }, [visibleMessages]);

  // Hasil pencarian cepat: id pesan (urut kronologis) yang body-nya memuat
  // kata kunci. Hanya pesan yang sudah dimuat di memori — sama seperti
  // dialog "Cari di percakapan", tanpa round-trip tambahan.
  const quickNeedle = quickQuery.trim().toLowerCase();
  const quickHits = useMemo(() => {
    if (!quickNeedle) return [] as string[];
    return (visibleMessages ?? [])
      .filter((m) => {
        if (m.deleted_at) return false;
        if (!(m.body ?? "").toLowerCase().includes(quickNeedle)) return false;
        // Filter pengirim: "me" = hanya pesan saya, "them" = hanya lawan bicara.
        if (quickFrom === "me") return m.sender_id === myId;
        if (quickFrom === "them") return m.sender_id !== myId;
        return true;
      })
      .map((m) => m.id);
  }, [visibleMessages, quickNeedle, quickFrom, myId]);
  const quickHitSet = useMemo(() => new Set(quickHits), [quickHits]);
  // Reset posisi kursor tiap kata kunci berubah, lalu lompat ke hasil
  // terbaru (paling bawah) supaya alur baca tetap natural.
  useEffect(() => {
    if (quickHits.length === 0) return;
    const last = quickHits.length - 1;
    setQuickIdx(last);
    jumpToMessage(quickHits[last]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickNeedle, quickFrom]);
  const activeHitId = quickHits[quickIdx] ?? null;
  // Konteks percakapan di sekitar hasil aktif: 2 pesan sebelum & 2 sesudah,
  // supaya alur obrolan langsung terbaca tanpa harus melompat dulu.
  const quickContext = useMemo(() => {
    if (!activeHitId) return [] as MessageRow[];
    const list = visibleMessages ?? [];
    const i = list.findIndex((m) => m.id === activeHitId);
    if (i < 0) return [] as MessageRow[];
    return list.slice(Math.max(0, i - 2), Math.min(list.length, i + 3));
  }, [activeHitId, visibleMessages]);
  const gotoHit = useCallback(
    (dir: 1 | -1) => {
      if (quickHits.length === 0) return;
      const next = (quickIdx + dir + quickHits.length) % quickHits.length;
      setQuickIdx(next);
      jumpToMessage(quickHits[next]);
    },
    [quickHits, quickIdx, jumpToMessage],
  );
  const closeQuickSearch = useCallback(() => {
    setQuickSearchOpen(false);
    setQuickQuery("");
    setQuickIdx(0);
  }, []);

  const selectedMessages = useMemo(
    () => (messages ?? []).filter((m) => selectedIds.has(m.id)),
    [messages, selectedIds],
  );
  const oneSelected = selectedMessages.length === 1;
  const onlyOne = oneSelected ? selectedMessages[0] : null;
  // "Hapus untuk semua" tersedia bila semua pesan terpilih boleh dihapus
  // menurut aturan server (pengirim sendiri, atau pemilik percakapan).
  const allMineSelected =
    selectedMessages.length > 0 && selectedMessages.every((m) => canDeleteForAll(m.sender_id));

  // Outbox = pesan yang baru saja kita kirim → selalu turun ke bawah.
  const prevOutboxCountRef = useRef(0);
  useEffect(() => {
    const grew = outbox.length > prevOutboxCountRef.current;
    prevOutboxCountRef.current = outbox.length;
    if (!grew) return;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    isNearBottomRef.current = true;
    setHasNewBelow(false);
  }, [outbox.length]);

  const kbInset = useVisualViewportKeyboardInset();
  return (
    <div
      // `transition-[height]` menghaluskan pergeseran viewport chat saat
      // soft-keyboard muncul/tertutup — daftar pesan & composer bergerak
      // ke posisi baru dengan easing 200ms, bukan snap. Dihormati
      // preferensi reduce-motion pengguna.
      className="mx-auto flex h-app-vh max-h-app-vh w-full max-w-2xl flex-col overflow-hidden wa-surface transition-[height] duration-200 ease-out motion-reduce:transition-none"
      style={
        kbInset > 0
          ? { height: `calc(var(--app-vh, 100dvh) - ${kbInset}px)` }
          : undefined
      }
    >
      {!meta.isPending && !meta.data ? (
        <div
          role="alert"
          data-testid="chat-not-found"
          className="flex h-full flex-col items-center justify-center gap-ms-3 p-ms-6 text-center"
        >
          <div className="text-ms-base font-semibold">Percakapan tidak ditemukan</div>
          <div className="text-ms-sm leading-snug text-muted-foreground">
            Tautan ini mungkin sudah kedaluwarsa atau kamu tidak punya akses ke percakapan ini.
          </div>
          <Button variant="secondary" onClick={() => goBackOr(router, { to: "/chat" })}>
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
      <header
        className="wa-header z-20 flex shrink-0 items-center gap-ms-1 border-b px-1.5 py-1 shadow-[0_1px_0_0_color-mix(in_oklab,var(--foreground)_8%,transparent)] sm:gap-ms-2 sm:px-ms-2 sm:py-ms-2"
        style={{ paddingTop: "max(env(safe-area-inset-top), 0.25rem)" }}
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={() => goBackOr(router, { to: "/chat" })}
          aria-label="Kembali"
          className="h-10 w-10 shrink-0"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        {meta.data?.kind === "dm" && dmPeer?.peerUserId ? (
          <button
            type="button"
            aria-label={`Lihat profil ${displayedPeerName}`}
            onClick={() => setPeerProfileOpen(true)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--wa-surface-2)] text-[var(--wa-text-muted)] text-ms-sm font-semibold uppercase transition hover:opacity-80 active:scale-95 sm:h-10 sm:w-10"
          >
            {displayedPeerName.trim().charAt(0) || "?"}
          </button>
        ) : (
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--wa-surface-2)] text-[var(--wa-text-muted)] text-ms-sm font-semibold uppercase sm:h-10 sm:w-10">
            {(meta.data?.kind === "dm" ? displayedPeerName : headerTitle || "?").trim().charAt(0) || "?"}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-ms-1">
            <div className="truncate text-ms-base font-semibold">
              {meta.data?.kind === "dm" ? displayedPeerName : headerTitle}
            </div>
            {meta.data?.category === "archived" || meta.data?.archived_at ? (
              <StatusBadge lifecycle="archived" className="shrink-0" />
            ) : null}
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
          <div className="truncate text-ms-2xs text-muted-foreground">
            {typingNames.length > 0 ? (
              <span className="italic text-primary">
                {meta.data?.kind === "dm"
                  ? "sedang menulis pesan…"
                  : `${typingNames.join(", ")} sedang menulis…`}
              </span>
            ) : !online ? (
              <span className="inline-flex items-center gap-ms-1 text-warning dark:text-warning">
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
          {meta.data?.kind === "dm" && myId ? (
            <div className="mt-0.5 flex min-w-0 max-w-full items-center sm:hidden">
              <ChatHeaderDebtControls
                myId={myId}
                peerUserId={dmPeer?.peerUserId ?? null}
                peerPhone={dmPeer?.peerPhone ?? null}
                peerName={displayedPeerName}
                conversationId={conversationId}
              />
            </div>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 sm:h-10 sm:w-10"
          aria-label="Cari pesan di percakapan"
          onClick={() => setQuickSearchOpen((v) => !v)}
        >
          <SearchIcon className="h-5 w-5" />
        </Button>
        {meta.data?.kind === "dm" && myId ? (
          <>
            <div className="hidden sm:flex">
              <ChatHeaderDebtControls
                myId={myId}
                peerUserId={dmPeer?.peerUserId ?? null}
                peerPhone={dmPeer?.peerPhone ?? null}
                peerName={displayedPeerName}
                conversationId={conversationId}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 sm:h-10 sm:w-10"
              aria-label="Panggilan suara"
              aria-busy={startingCall}
              disabled={!online || startingCall}
              onClick={async () => {
                if (!dmPeer?.peerUserId || !myId) return;
                setStartingCall(true);
                try {
                  const row = await createCallRow({
                    conversationId,
                    callerId: myId,
                    calleeId: dmPeer.peerUserId,
                    kind: "audio",
                  });
                  dispatchStartCall({ callId: row.id, kind: "audio", peerName: displayedPeerName });
                  void ringUser({
                    calleeId: dmPeer.peerUserId,
                    callId: row.id,
                    callerId: myId,
                    kind: "audio",
                    conversationId,
                    callerName: displayedPeerName,
                  }).catch(() => { /* ring gagal — UI tetap jalan */ });
                } catch (e) {
                  const { describeCallError } = await import("@/lib/call-errors");
                  const info = describeCallError(e, "audio");
                  toast.error(info.title, { description: info.hint, duration: 8000 });
                } finally {
                  setStartingCall(false);
                }
              }}
            >
              {startingCall ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Phone className="h-5 w-5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 sm:h-10 sm:w-10"
              aria-label="Panggilan video"
              aria-busy={startingCall}
              disabled={!online || startingCall}
              onClick={async () => {
                if (!dmPeer?.peerUserId || !myId) return;
                setStartingCall(true);
                try {
                  const row = await createCallRow({
                    conversationId,
                    callerId: myId,
                    calleeId: dmPeer.peerUserId,
                    kind: "video",
                  });
                  dispatchStartCall({ callId: row.id, kind: "video", peerName: displayedPeerName });
                  void ringUser({
                    calleeId: dmPeer.peerUserId,
                    callId: row.id,
                    callerId: myId,
                    kind: "video",
                    conversationId,
                    callerName: displayedPeerName,
                  }).catch(() => { /* ring gagal — UI tetap jalan */ });
                } catch (e) {
                  const { describeCallError } = await import("@/lib/call-errors");
                  const info = describeCallError(e, "video");
                  toast.error(info.title, { description: info.hint, duration: 8000 });
                } finally {
                  setStartingCall(false);
                }
              }}
            >
              {startingCall ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <VideoIcon className="h-5 w-5" />
              )}
            </Button>
          </>
        ) : null}
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
              onSelect={() => navigate({ to: "/ecer", search: { item: undefined, title: undefined, highlight: undefined, send: undefined } })}
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

      {quickSearchOpen ? (
        <div className="z-10 shrink-0 border-b bg-background/95 px-ms-2 py-1.5 backdrop-blur">
        <div className="flex items-center gap-ms-2">
          <SearchIcon className="ml-1 h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={quickQuery}
            onChange={(e) => setQuickQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); gotoHit(e.shiftKey ? -1 : 1); }
              if (e.key === "Escape") { e.preventDefault(); closeQuickSearch(); }
            }}
            placeholder="Cari pesan di percakapan ini…"
            className="min-w-0 flex-1 bg-transparent text-ms-sm outline-none placeholder:text-muted-foreground"
            aria-label="Kata kunci pencarian pesan"
          />
          <span className="shrink-0 tabular-nums text-ms-2xs text-muted-foreground">
            {quickNeedle ? (quickHits.length ? `${quickIdx + 1}/${quickHits.length}` : "0 hasil") : ""}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label="Hasil sebelumnya"
            disabled={quickHits.length === 0}
            onClick={() => gotoHit(-1)}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label="Hasil berikutnya"
            disabled={quickHits.length === 0}
            onClick={() => gotoHit(1)}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label="Tutup pencarian"
            onClick={closeQuickSearch}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div
          role="group"
          aria-label="Filter pengirim"
          className="mt-1.5 flex items-center gap-ms-1 overflow-x-auto pb-0.5 pl-6"
        >
          {([
            { key: "all", label: "Semua" },
            { key: "me", label: "Dari saya" },
            { key: "them", label: dmPeer ? "Dari lawan bicara" : "Dari anggota lain" },
          ] as const).map((opt) => (
            <button
              key={opt.key}
              type="button"
              aria-pressed={quickFrom === opt.key}
              onClick={() => setQuickFrom(opt.key)}
              className={`shrink-0 rounded-full border px-ms-2 py-0.5 text-ms-2xs transition-colors ${
                quickFrom === opt.key
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {quickContext.length > 0 ? (
          <div className="mt-1.5 rounded-lg border bg-muted/40 p-1.5">
            <div className="mb-1 px-1 text-ms-2xs font-medium uppercase tracking-wide text-muted-foreground">
              Konteks percakapan
            </div>
            <ul className="space-y-0.5">
              {quickContext.map((cm) => {
                const isHit = cm.id === activeHitId;
                const p = profiles.data?.get(cm.sender_id);
                const nm =
                  cm.sender_id === myId
                    ? "Saya"
                    : p?.display_name
                      || (p?.invite_code ? `PIN ${formatInviteCode(p.invite_code)}` : null)
                      || "Pengguna";
                return (
                  <li key={cm.id}>
                    <button
                      type="button"
                      onClick={() => jumpToMessage(cm.id)}
                      className={`flex w-full items-start gap-ms-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent ${
                        isHit ? "bg-primary/10 ring-1 ring-primary/40" : ""
                      }`}
                    >
                      <span className="shrink-0 tabular-nums text-ms-2xs text-muted-foreground">
                        {fmtTime(cm.created_at)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-ms-2xs">
                        <span className={isHit ? "font-semibold text-primary" : "font-medium"}>{nm}: </span>
                        <span className={isHit ? "text-foreground" : "text-muted-foreground"}>
                          {safePreview(cm)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        </div>
      ) : null}

      <PinnedBanner
        conversationId={conversationId}
        pinned={pinnedMessages}
        onJump={jumpToMessage}
        canUnpin
      />

      {meta.data ? (
        <OrderSummaryCard
          links={{
            linked_customer_id: meta.data.linked_customer_id ?? null,
            linked_request_prep_id: meta.data.linked_request_prep_id ?? null,
            linked_ecer_prep_id: meta.data.linked_ecer_prep_id ?? null,
            linked_task_id: meta.data.linked_task_id ?? null,
            linked_product_id: meta.data.linked_product_id ?? null,
          }}
        />
      ) : null}

      <div ref={scrollerRef} onScroll={onScrollerScroll} className="wa-chat-bg relative flex-1 overflow-y-auto px-ms-2 py-ms-3 sm:px-ms-4">
        {isLoading ? (
          <ChatMessagesSkeleton bubbles={6} />
        ) : (messages ?? []).length === 0 ? (
          <div className="grid place-items-center p-12 text-center text-ms-xs text-muted-foreground">
            Belum ada pesan. Sapa dulu yuk.
          </div>
        ) : (
          <>
          {hiddenOlderCount > 0 ? (
            <div className="mb-2 flex justify-center">
              <button
                type="button"
                onClick={() => setRenderCount((p) => p + 60)}
                className="rounded-full bg-[var(--wa-header)]/95 px-ms-3 py-1.5 text-ms-2xs font-medium wa-muted ring-1 ring-[var(--wa-border)]"
              >
                Muat {Math.min(60, hiddenOlderCount)} pesan lama ({hiddenOlderCount} tersisa)
              </button>
            </div>
          ) : null}
          {grouped.map((g) => (
            <div key={g.day} className="chat-day-group flex flex-col gap-1.5">
              <div className="my-2.5 flex justify-center">
                <span className="rounded-full bg-[var(--wa-header)]/95 px-ms-3 py-1 text-ms-2xs font-medium uppercase tracking-wide wa-muted shadow-sm ring-1 ring-[var(--wa-border)]">{g.day}</span>
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
                    className={`flex ${mine ? "justify-end" : "justify-start"} ${selectedIds.has(m.id) ? "bg-primary/10 rounded-md" : ""}`}
                  >
                     <div className={`group relative flex min-w-0 max-w-[86%] items-start gap-ms-1 sm:max-w-[72%] lg:max-w-[60ch] ${mine ? "flex-row-reverse" : "flex-row"}`}>
                      <div
                        className={`min-w-0 max-w-full overflow-hidden rounded-2xl px-ms-3 py-ms-2 text-ms-sm leading-relaxed [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] ${
                          m.deleted_at
                            ? `${mine ? "rounded-br-md" : "rounded-bl-md"} bg-muted/60 text-muted-foreground border border-dashed border-border`
                            : mine
                              ? "rounded-br-md wa-bubble-out"
                              : "rounded-bl-md wa-bubble-in"
                        } select-none touch-manipulation ${selectedIds.has(m.id) ? "ring-2 ring-primary" : ""} ${
                          activeHitId === m.id
                            ? "ring-2 ring-warning"
                            : quickHitSet.has(m.id)
                              ? "ring-1 ring-warning/50"
                              : ""
                        }`}
                        onPointerDown={(e) => {
                          if (e.pointerType === "mouse" && e.button !== 0) return;
                          startLongPress(m);
                        }}
                        onPointerUp={cancelLongPress}
                        onPointerLeave={cancelLongPress}
                        onPointerCancel={cancelLongPress}
                        onClick={() => {
                          // Jika long-press baru saja terpicu, telan click
                          // yang di-dispatch browser saat jari diangkat.
                          // Tanpa ini, onClick men-toggle seleksi yang baru
                          // dibuat → highlight/toolbar seleksi langsung hilang.
                          if (longPressFired.current) {
                            longPressFired.current = false;
                            return;
                          }
                          if (selectionMode) toggleSelect(m);
                        }}
                        onContextMenu={(e) => {
                          if (m.deleted_at) return;
                          e.preventDefault();
                          toggleSelect(m);
                        }}
                      >
                        {showSender ? (
                          <div className="mb-1 truncate text-ms-2xs font-semibold tracking-wide text-[color-mix(in_oklab,currentColor_70%,transparent)]">{senderName}</div>
                        ) : null}
                        {m.pinned_at && !m.deleted_at ? (
                          <div className={`mb-0.5 inline-flex items-center gap-ms-1 text-ms-2xs ${mine ? "text-primary-foreground/80" : "text-warning dark:text-warning"}`}>
                            <Pin className="h-3 w-3" /> Disematkan
                          </div>
                        ) : null}
                        {replyMsg ? (
                          <div
                            className={`mb-1 rounded-md border-l-2 px-ms-2 py-1 text-ms-2xs ${
                              mine
                                ? "border-primary-foreground/60 bg-primary-foreground/10"
                                : "border-primary/60 bg-background/60"
                            }`}
                          >
                            <div className="truncate font-semibold opacity-80">
                              {replyMsg.sender_id === myId ? "Anda" : replySenderName}
                            </div>
                            <div className="line-clamp-2 break-words opacity-80">
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
                                <div className="flex items-center gap-ms-1.5">
                                  <Ban className="h-3.5 w-3.5 shrink-0 opacity-80" />
                                  <span>{label}</span>
                                </div>
                                {hadAttachment ? (
                                  <div className="ml-5 text-ms-2xs not-italic opacity-80">
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
                              <div className="space-y-1.5">
                                {m.attachment_path ? (
                                  <MessageAttachment
                                    path={m.attachment_path}
                                    mime={m.attachment_mime}
                                    name={m.attachment_name}
                                    size={m.attachment_size}
                                    mine={mine}
                                    durationSec={m.attachment_duration_sec ?? null}
                                  />
                                ) : null}
                                {card ? <CardBlock card={card} mine={mine} /> : null}
                                {!card && isCardBody(m.body) ? (
                                  <UnknownCardBlock mine={mine} />
                                ) : null}
                                {!card && !isCardBody(m.body) && m.body ? (
                                  <div className="wa-message-text">
                                    <Linkify text={m.body} highlight={quickSearchOpen ? quickNeedle : undefined} />
                                  </div>
                                ) : null}
                                {!card && !isCardBody(m.body) && m.body ? (
                                  <UrlPreviewList text={m.body} mine={mine} />
                                ) : null}
                              </div>
                            );
                          })()
                        )}
                        <div
                          className={`mt-1 flex items-center justify-end gap-ms-1 text-ms-2xs tabular-nums ${
                            m.deleted_at
                              ? "text-muted-foreground/80"
                              : mine
                                ? "wa-meta-out"
                                : "wa-meta-in"
                          }`}
                          title={
                            m.deleted_at
                              ? `Dikirim ${new Date(m.created_at).toLocaleString("id-ID")} · Dihapus ${new Date(m.deleted_at).toLocaleString("id-ID")}`
                              : new Date(m.created_at).toLocaleString("id-ID")
                          }
                        >
                          {m.edited_at && !m.deleted_at ? <span className="italic">diedit</span> : null}
                          {(m.starred_by ?? []).length > 0 && !m.deleted_at ? (
                            <Star className="h-3 w-3 fill-current text-warning" aria-label="Berbintang" />
                          ) : null}
                          <span>{fmtTime(m.deleted_at ?? m.created_at)}</span>
                          {mine && !m.deleted_at ? (
                            (() => {
                              const sentMs = new Date(m.created_at).getTime();
                              const rd = othersRead.data?.read ?? null;
                              const dl = othersRead.data?.delivered ?? null;
                              const status = rd !== null && rd >= sentMs
                                ? "read"
                                : dl !== null && dl >= sentMs
                                  ? "delivered"
                                  : "sent";
                              return <MessageStatusIcon status={status} />;
                            })()
                          ) : null}
                        </div>
                        {reactionEntries.length > 0 ? (
                          <div className={`mt-1.5 flex flex-wrap gap-ms-1 ${mine ? "justify-end" : "justify-start"}`}>
                            {reactionEntries.map((r) => (
                              <button
                                key={r.emoji}
                                type="button"
                                onClick={() =>
                                  react.mutate({ messageId: m.id, emoji: r.emoji, on: !r.mine })
                                }
                                className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-ms-2xs leading-none transition ${
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
                        <div className="flex items-center gap-ms-1 self-center opacity-0 transition-opacity group-hover:opacity-100 data-[open=true]:opacity-100">
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
                          <PopoverContent className="w-auto p-ms-1" align={mine ? "end" : "start"}>
                            <div className="flex gap-ms-1">
                              {REACTION_SET.map((e) => (
                                <button
                                  key={e}
                                  type="button"
                                  className={`grid h-8 w-8 place-items-center rounded-md text-ms-lg hover:bg-accent ${
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
                              Teruskan via WhatsApp
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => {
                                const text = m.deleted_at
                                  ? DELETED_PLACEHOLDER
                                  : (safePreview(m) ?? "");
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
                                      onError: (err) => notifyDeleteError(err, "menyembunyikan pesan"),
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
                                // Card non-sticker (lokasi/kontak/produk/keranjang) tidak boleh
                                // dibuka di composer teks — payload mentahnya akan bocor sebagai
                                // JSON. Untuk sekarang, sembunyikan menu "Edit" pada card semacam
                                // itu; editor khusus per-jenis kartu adalah pekerjaan iterasi
                                // berikutnya.
                                if (isCardBody(m.body)) return null;
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
                            {canDeleteForAll(m.sender_id) ? (
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                disabled={deleteMsg.isPending}
                                onSelect={async () => {
                                  const ok = await confirm({
                                    title: "Hapus untuk semua orang?",
                                    description: mine
                                      ? "Pesan akan dihapus dari sisi Anda dan lawan chat. Tindakan ini tidak bisa dibatalkan setelah beberapa detik."
                                      : "Sebagai pemilik grup, Anda menghapus pesan anggota ini untuk semua orang. Tindakan ini tidak bisa dibatalkan setelah beberapa detik.",
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
                                            notifyDeleteError(e, "menghapus pesan untuk semua");
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
          ))}
          </>
        )}

        {outbox.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {outbox.map((o) => (
              <div key={o.tempId} className="flex justify-end">
                <div className="flex min-w-0 max-w-[86%] flex-row-reverse items-start gap-ms-1 sm:max-w-[72%] lg:max-w-[60ch]">
                  <div
                    className={`rounded-2xl rounded-br-md px-ms-3 py-ms-2 text-ms-sm leading-relaxed ${
                      o.status === "failed"
                        ? "bg-destructive/15 text-foreground ring-1 ring-destructive/40"
                        : `wa-bubble-out ${o.status === "queued" ? "opacity-70" : "opacity-85"}`
                    }`}
                  >
                    {(() => {
                      const outCard = decodeCard(o.body);
                      if (outCard) return <CardBlock card={outCard} mine={true} />;
                      if (isCardBody(o.body)) return <UnknownCardBlock mine={true} />;
                      return (
                        <>
                          <div className="wa-message-text">
                            <Linkify text={o.body} />
                          </div>
                          <UrlPreviewList text={o.body} mine />
                        </>
                      );
                    })()}
                    <div className="mt-1 flex items-center justify-end gap-ms-1 text-ms-2xs tabular-nums opacity-80">
                      <span>{fmtTime(o.createdAt)}</span>
                      <span
                        className={`inline-flex items-center gap-ms-1 ${o.status === "failed" ? "text-destructive" : ""}`}
                        title={o.error ?? messageStatusLabel(o.status)}
                      >
                        <MessageStatusIcon status={o.status} />
                        {o.status !== "sending" ? messageStatusLabel(o.status) : null}
                      </span>
                    </div>
                    {o.status === "failed" && o.error ? (
                      <div className="mt-0.5 max-w-[18rem] break-words text-right text-ms-2xs text-destructive/90">
                        {o.error}
                        {(o.attempts ?? 0) > 1 ? ` · ${o.attempts}× dicoba` : ""}
                      </div>
                    ) : null}
                  </div>
                  {o.status === "failed" ? (
                    <div className="flex flex-col gap-ms-1 self-center">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        aria-label="Kirim ulang"
                        onClick={() => manualRetry(o)}
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

      {hasNewBelow ? (
        <div className="pointer-events-none relative z-30 -mt-12 mb-2 flex justify-center px-ms-2">
          <button
            type="button"
            onClick={() => scrollToBottom("smooth")}
            className="pointer-events-auto inline-flex items-center gap-ms-1 rounded-full bg-primary px-ms-3.5 py-1.5 text-ms-xs font-semibold text-primary-foreground shadow-lg ring-1 ring-primary/40 backdrop-blur hover:opacity-95 active:scale-95"
            aria-label="Lompat ke pesan terbaru"
          >
            ↓ Pesan baru
          </button>
        </div>
      ) : null}
      {failedCount > 0 ? (
        <div className="z-10 flex shrink-0 items-center gap-ms-2 border-t border-destructive/30 bg-destructive/10 px-ms-3 py-1.5 text-ms-xs">
          <span className="min-w-0 flex-1 truncate text-destructive">
            {failedCount} pesan gagal terkirim
            {!online ? " · menunggu koneksi" : ""}
          </span>
          <Button type="button" size="sm" variant="outline" className="h-7 shrink-0 gap-ms-1" onClick={retryAllFailed}>
            <RefreshCw className="h-3.5 w-3.5" /> Kirim ulang semua
          </Button>
        </div>
      ) : null}
      <form
        onSubmit={onSubmit}
        className="chat-field-scope z-10 shrink-0 border-t bg-background/95 p-ms-2 backdrop-blur"
        style={{ paddingBottom: `max(env(safe-area-inset-bottom), 0.5rem)` }}
      >
        {editing ? (
          <div className="chat-preview-panel-primary mb-2 flex items-start gap-ms-2 rounded-md border border-primary/40 bg-primary/5 px-ms-2 py-1 text-ms-xs">
            <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-primary">Edit pesan</div>
              <div className="chat-preview-text line-clamp-2 break-words">
                {previewText(editing.body) || "(kosong)"}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
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
          <div className="chat-preview-panel mb-2 flex items-start gap-ms-2 rounded-md border-l-2 border-primary bg-muted/60 px-ms-2 py-1 text-ms-xs">
            <Reply className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="chat-preview-label truncate font-semibold">
                Balas {replyTo.sender_id === myId ? "Anda" : (profiles.data?.get(replyTo.sender_id)?.display_name || "Pengguna")}
              </div>
              <div className="chat-preview-text line-clamp-2 break-words">
                <MessagePreview message={replyTo} />
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              aria-label="Batal balas"
              onClick={() => setReplyTo(null)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : null}
        {pendingAttachments.length > 0 ? (
          <div className="mb-2 rounded-md border border-primary/30 bg-primary/5 px-ms-2 py-1.5">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-ms-xs font-semibold text-primary">
                Lampiran siap dikirim ({pendingAttachments.length})
              </span>
              <button
                type="button"
                className="text-ms-2xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={clearAttachments}
              >
                Bersihkan
              </button>
            </div>
            <ul className="flex gap-ms-1.5 overflow-x-auto pb-0.5">
              {pendingAttachments.map((a) => {
                const isImage = a.file.type.startsWith("image/");
                const isVideo = a.file.type.startsWith("video/");
                const status = attachmentSendStatuses[a.id];
                const kb = a.file.size < 1024
                  ? `${a.file.size} B`
                  : a.file.size < 1024 * 1024
                    ? `${(a.file.size / 1024).toFixed(0)} KB`
                    : `${(a.file.size / (1024 * 1024)).toFixed(1)} MB`;
                return (
                  <li
                    key={a.id}
                    className="relative flex h-16 w-16 shrink-0 flex-col items-center justify-center overflow-hidden rounded-md border bg-background"
                    title={`${a.file.name} · ${kb}`}
                  >
                    {isImage && a.previewUrl ? (
                      <img src={a.previewUrl} alt={a.file.name} className="h-full w-full object-cover" />
                    ) : isVideo && a.previewUrl ? (
                      <video src={a.previewUrl} className="h-full w-full object-cover" muted />
                    ) : (
                      <>
                        <Package className="h-5 w-5 text-muted-foreground" aria-hidden />
                        <span className="mt-0.5 max-w-full truncate px-1 text-[9px] leading-tight text-muted-foreground">
                          {a.file.name}
                        </span>
                      </>
                    )}
                    {status === "sending" ? (
                      <span className="absolute inset-0 flex items-center justify-center bg-background/70">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      </span>
                    ) : null}
                    {status === "failed" ? (
                      <span className="absolute inset-x-0 bottom-0 bg-destructive/90 text-center text-[9px] font-semibold uppercase text-destructive-foreground">
                        gagal
                      </span>
                    ) : null}
                    <button
                      type="button"
                      aria-label={`Hapus lampiran ${a.file.name}`}
                      onClick={() => removeAttachment(a.id)}
                      disabled={status === "sending"}
                      className="absolute right-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-background/90 text-foreground shadow ring-1 ring-border hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
            {body.trim() ? (
              <p className="mt-1 text-ms-2xs text-muted-foreground">
                Teks di atas akan menjadi caption pada lampiran pertama.
              </p>
            ) : null}
          </div>
        ) : null}
        {pendingProducts.length > 0 ? (
          <div className="mb-2 space-y-1 rounded-md border border-primary/30 bg-primary/5 px-ms-2 py-1.5 text-ms-xs">
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-ms-1.5">
                <span className="font-semibold text-primary">
                  Produk siap dikirim ({pendingProducts.length})
                </span>
                {saveStatus === "saved" ? (
                  <span className="inline-flex shrink-0 items-center rounded bg-success/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-success dark:text-success">
                    tersimpan
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                className="text-ms-2xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => updatePendingProducts([])}
              >
                Bersihkan
              </button>
            </div>
            <ul className="grid grid-cols-1 gap-ms-1.5 sm:grid-cols-2 xl:grid-cols-3">
              {pendingProducts.map((p, idx) => {
                const sendStatus = productSendStatuses[p.id];
                // Catalog = referensi stok gudang (tidak boleh diedit dari
                // chip). Untuk ready/self dengan qty numerik + baseUnit,
                // tampilkan tombol − / + dengan step sesuai unit.
                const editable =
                  p.source !== "catalog" && p.qty !== null && p.baseUnit !== null;
                const bounds = qtyBounds(p.baseUnit);
                const step = bounds.step;
                const adjustQty = (delta: number) => {
                  updatePendingProducts((prev) =>
                    prev.map((row, i) => {
                      if (i !== idx) return row;
                      if (row.qty === null) return row;
                      const raw = row.qty + delta;
                      const next = clampQty(raw, row.baseUnit);
                      if (next === null) return row;
                      return { ...row, qty: next };
                    }),
                  );
                };
                const promptQty = () => {
                  if (!editable || p.qty === null || !p.baseUnit) return;
                  const unitLabel = p.baseUnit === "g" ? "gram (mis. 1 kg, 500 gr, 2 ons)" : "pcs";
                  const input = window.prompt(
                    `Ubah jumlah ${p.productName} (${unitLabel}):`,
                    String(p.qty),
                  );
                  if (input === null) return;
                  const n = parseQtyInput(input, p.baseUnit);
                  if (n === null) {
                    toast.error(
                      p.baseUnit === "g"
                        ? "Jumlah tidak valid. Contoh: 1 kg, 500 gr, 2 ons."
                        : "Jumlah harus angka positif.",
                    );
                    return;
                  }
                  if (n < bounds.min) {
                    toast.error(`Jumlah minimal ${bounds.min} ${p.baseUnit === "g" ? "gr" : "pcs"}.`);
                    return;
                  }
                  if (n >= bounds.max) {
                    toast.warning(
                      `Jumlah dibatasi maksimum ${bounds.max.toLocaleString("id-ID")} ${p.baseUnit === "g" ? "gr" : "pcs"}.`,
                    );
                  }
                  updatePendingProducts((prev) =>
                    prev.map((row, i) => (i === idx ? { ...row, qty: n } : row)),
                  );
                };
                return (
                  <li
                    key={`${p.source}:${p.id}:${idx}`}
                    className="relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-ms-2 rounded-md border bg-background p-ms-1.5"
                  >
                    <button
                      type="button"
                      aria-label={`Hapus ${p.productName} dari daftar kirim`}
                      disabled={sendStatus === "sending"}
                      onClick={() =>
                        updatePendingProducts((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-background text-muted-foreground shadow ring-1 ring-border hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    <PendingProductThumb path={p.photoPath} bucket={p.bucket} />
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-ms-1.5">
                        <span
                          className="min-w-0 flex-1 truncate text-ms-xs font-medium leading-tight text-foreground"
                          title={p.productName}
                        >
                          {p.productName}
                        </span>
                        {p.source === "catalog" ? (
                          <span className="shrink-0 rounded bg-primary/10 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-primary">
                            katalog
                          </span>
                        ) : null}
                        {sendStatus === "sending" ? (
                          <span
                            className="inline-flex shrink-0 items-center gap-0.5 rounded bg-primary/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-primary"
                            aria-label="Sedang mengirim"
                          >
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                            mengirim
                          </span>
                        ) : sendStatus === "failed" ? (
                          <span
                            className="shrink-0 rounded bg-destructive/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-destructive"
                            aria-label="Gagal terkirim — tekan Kirim untuk coba lagi"
                            title="Gagal terkirim — tekan Kirim untuk coba lagi"
                          >
                            gagal
                          </span>
                        ) : sendStatus === "pending" ? (
                          <span
                            className="shrink-0 rounded bg-warning/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-warning dark:text-warning"
                            aria-label="Menunggu antrean kirim"
                          >
                            menunggu
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 text-ms-2xs leading-tight text-muted-foreground">
                        {editable ? (
                          <span className="inline-flex shrink-0 items-center gap-0.5">
                            <button
                              type="button"
                              aria-label={`Kurangi jumlah ${p.productName}`}
                              className="inline-flex h-6 w-6 items-center justify-center rounded border bg-background text-foreground hover:bg-accent active:scale-95 disabled:opacity-40"
                              disabled={(p.qty ?? 0) <= step}
                              onClick={() => adjustQty(-step)}
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Ubah jumlah ${p.productName}`}
                              onClick={promptQty}
                              className="min-w-[56px] rounded px-1 py-0.5 text-center text-ms-2xs font-semibold tabular-nums text-foreground hover:bg-accent"
                            >
                              {fmtBase(p.qty!, p.baseUnit!)}
                            </button>
                            <button
                              type="button"
                              aria-label={`Tambah jumlah ${p.productName}`}
                              className="inline-flex h-6 w-6 items-center justify-center rounded border bg-background text-foreground hover:bg-accent active:scale-95"
                              onClick={() => adjustQty(step)}
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </span>
                        ) : p.qty !== null && p.baseUnit ? (
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-ms-2xs font-semibold tabular-nums text-foreground">
                            {fmtBase(p.qty, p.baseUnit)}
                          </span>
                        ) : (
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-ms-2xs font-medium uppercase tracking-wide">
                            sendiri
                          </span>
                        )}
                        <div className="flex min-w-0 items-center gap-ms-1.5">
                          {p.variant ? (
                            <span
                              className="min-w-0 flex-1 truncate text-ms-2xs"
                              title={p.variant}
                            >
                              {p.variant}
                            </span>
                          ) : (
                            <span className="min-w-0 flex-1" />
                          )}
                          {p.locationUrl ? (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-muted/70 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide">
                              <MapPin className="h-2.5 w-2.5" /> lokasi
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Buang ${p.productName}`}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={() =>
                        updatePendingProducts((prev) => prev.filter((_, i) => i !== idx))
                      }
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {productSendProgress ? (
          <div className="mb-2 rounded-md border border-primary/30 bg-primary/5 px-ms-2 py-1.5 text-ms-xs">
            <div className="flex items-center gap-ms-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span className="flex-1 font-medium text-primary">
                Mengirim {productSendProgress.current}/{productSendProgress.total}: {productSendProgress.name}
              </span>
              <span className="text-ms-2xs text-muted-foreground">
                {productSendProgress.done} ok · {productSendProgress.failed} gagal
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-background">
              <div
                className="h-full bg-primary transition-all"
                style={{
                  width: `${Math.max(5, Math.round((productSendProgress.current / productSendProgress.total) * 100))}%`,
                }}
              />
            </div>
          </div>
        ) : null}
        <div className="relative flex flex-col gap-ms-1.5">
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
          {/* Baris atas: textarea + tombol Kirim, lebar penuh */}
          <div className="flex items-end gap-ms-2">
            <div className="flex-1 min-w-0">
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
                className="chat-input-contrast max-h-32 min-h-10 w-full resize-none bg-card"
                disabled={chatBlocked}
              />
            </div>
            <Button
              type="submit"
              size="icon"
              disabled={(!body.trim() && pendingProducts.length === 0 && pendingAttachments.length === 0) || chatBlocked || isSending || !!productSendProgress}
              aria-label="Kirim"
              aria-busy={isSending || !!productSendProgress}
              className="h-10 w-10 shrink-0"
            >
              {isSending || !!productSendProgress ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          {/* Baris bawah: strip alat sekunder */}
          <div className="flex items-center gap-ms-1">
            <AttachMenu
              conversationId={conversationId}
              disabled={chatBlocked}
              onSent={() => { void othersRead.refetch(); }}
              onStageFiles={stageAttachments}
            />
            <EmojiPickerPopover
              disabled={chatBlocked}
              onPick={(ch) => {
                setBody((prev) => prev + ch);
                emitTyping();
              }}
            />
            <ProductSharePopover
              conversationId={conversationId}
              disabled={chatBlocked}
              peerName={displayedPeerName}
              onSent={() => { void othersRead.refetch(); }}
              onQueue={(row) => updatePendingProducts((prev) => [...prev, row])}
            />
            <CartComposer
              conversationId={conversationId}
              disabled={chatBlocked}
              onSent={() => { void othersRead.refetch(); }}
            />
            <div className="ml-auto">
              {!body.trim() && pendingProducts.length === 0 && pendingAttachments.length === 0 ? (
                <VoiceRecorderButton
                  conversationId={conversationId}
                  disabled={chatBlocked}
                  onSent={() => { void othersRead.refetch(); }}
                />
              ) : (
                <div aria-hidden className="h-9 w-9" />
              )}
            </div>
          </div>
        </div>
        <p className="mt-1 hidden px-1 text-ms-2xs text-muted-foreground sm:block">
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
                      onError: (err) => notifyDeleteError(err, "menghapus semua pesan Anda"),
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
              {canDeleteForAll(longPressMsg?.sender_id)
                ? "Pilih cara menghapus pesan ini. \"Hapus untuk semua orang\" akan menghapus pesan dari sisi lawan chat juga."
                : "Pesan ini bukan milik Anda, jadi hanya bisa disembunyikan di perangkat Anda."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-ms-2">
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
                      onError: (err) => notifyDeleteError(err, "menyembunyikan pesan"),
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
            {canDeleteForAll(longPressMsg?.sender_id) ? (
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
                            notifyDeleteError(e, "menghapus pesan untuk semua");
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

      {dmPeer?.peerUserId ? (
        <PeerProfileDialog
          open={peerProfileOpen}
          onOpenChange={setPeerProfileOpen}
          peerUserId={dmPeer?.peerUserId ?? null}
          displayName={displayedPeerName}
          peerPhone={dmPeer.peerPhone}
          peerInviteCode={
            profiles.data?.get(dmPeer.peerUserId)?.invite_code ?? null
          }
          onEditName={() => setEditNameOpen(true)}
          onOpenAddressBook={() => {
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
          <div className="space-ms-2">
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
                    const hideFailed: string[] = [];
                    let firstHideError: unknown = null;
                    for (const m of items) {
                      await new Promise<void>((resolve) =>
                        hideMsg.mutate(m.id, {
                          onSuccess: () => resolve(),
                          onError: (e) => {
                            hideFailed.push(m.id);
                            if (!firstHideError) firstHideError = e;
                            resolve();
                          },
                        }),
                      );
                    }
                    const okHidden = items.length - hideFailed.length;
                    if (okHidden > 0) toast.success(`${okHidden} pesan disembunyikan`);
                    if (hideFailed.length > 0) {
                      notifyDeleteError(firstHideError, `menyembunyikan ${hideFailed.length} pesan`);
                    }
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
                        if (failedItems.length > 0) notifyDeleteError(firstError, `menghapus ${failedItems.length} pesan`);
                        void logChatDelete({
                          conversationId,
                          action: "for_all_bulk",
                          messageIds: items
                            .filter((it) => !failedItems.some((f) => f.id === it.id))
                            .map((m) => m.id),
                        });
                      } else {
                        notifyDeleteError(firstError, "menghapus pesan untuk semua");
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
        readAtMs={othersRead.data?.read ?? null}
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

const pendingThumbCache = new Map<string, { url: string; exp: number }>();

function PendingProductThumb({
  path,
  bucket,
}: {
  path: string | null;
  bucket: "ready-packages" | "self-prep-photos" | "item-photos";
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    const key = `${bucket}:${path}`;
    const c = pendingThumbCache.get(key);
    if (c && c.exp > Date.now()) {
      setUrl(c.url);
      return;
    }
    let alive = true;
    supabase.storage
      .from(bucket)
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (!alive || !data?.signedUrl) return;
        pendingThumbCache.set(key, { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 });
        setUrl(data.signedUrl);
      });
    return () => {
      alive = false;
    };
  }, [path, bucket]);
  if (!path) {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-dashed text-muted-foreground">
        <Package className="h-3.5 w-3.5" />
      </div>
    );
  }
  return (
    <div className="h-9 w-9 shrink-0 overflow-hidden rounded border bg-muted">
      {url ? <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
    </div>
  );
}