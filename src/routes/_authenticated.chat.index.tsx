import { createFileRoute, Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import * as React from "react";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { VirtualizedList } from "@/components/VirtualizedList";
import {
  MessageCircle, Loader2, Link2, CheckCheck, Pin, Archive, BellOff, UserPlus, ArrowLeft,
  Search, MoreVertical, ArchiveRestore, BellRing, X, WifiOff, Check,
  Trash2, CheckSquare, Square,
} from "lucide-react";

import {
  useConversations, useChatSearch, usePinConversation, useArchiveConversation,
  useMuteConversation, useChatHeartbeat,
} from "@/lib/chat";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { confirm } from "@/lib/confirm";
import { usePendingIncomingCount } from "@/lib/friend-requests";
import { NewDmDialog } from "@/components/chat/NewDmDialog";
import { NewGroupDialog } from "@/components/chat/NewGroupDialog";
import { AddContactFab } from "@/components/chat/AddContactFab";
import { ChatBottomNav } from "@/components/chat/ChatBottomNav";
import { ChatOnboarding } from "@/components/chat/ChatOnboarding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useChatLists, useAllChatListMembers } from "@/lib/chat-lists";
import { ChatListIcon } from "@/lib/chat-list-icons";
import { CHAT_CATEGORY_LABEL_ID, type ChatCategory } from "@/lib/chat-category";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { previewText } from "@/lib/chat-cards";
import { DebtSyncBadge } from "@/components/chat/DebtSyncBadge";
import { goBackOr } from "@/lib/back-nav";
import { ChatListSkeleton } from "@/components/chat/ChatSkeletons";
import { useVisualViewportKeyboardInset } from "@/hooks/use-visual-viewport-inset";
import { DomRaceBoundary } from "@/components/DomRaceBoundary";
import { DomRaceRecoveryPanel } from "@/components/DomRaceRecoveryPanel";

export const Route = createFileRoute("/_authenticated/chat/")({
  head: () => ({
    meta: [
      { title: "Ace Chat · Daftar Percakapan" },
      {
        name: "description",
        content:
          "Daftar percakapan WA Chat: pesan, grup, panggilan, dan pembaruan pelanggan dalam satu layar.",
      },
      { property: "og:title", content: "Ace Chat · Daftar Percakapan" },
      {
        property: "og:description",
        content:
          "Kelola pesan dan grup pelanggan lewat Ace Chat, terhubung langsung dengan Ace Storage.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // Terima query `?filter=unread` sebagai deep-link dari tab Chat di bottom
  // nav — supaya mengetuk badge chat langsung memfokuskan daftar pesan
  // belum dibaca. Nilai lain diabaikan (fallback ke "all").
  validateSearch: (search: Record<string, unknown>) => {
    const raw = typeof search.filter === "string" ? search.filter : undefined;
    const out: { filter?: "unread" } = {};
    if (raw === "unread") out.filter = "unread";
    return out;
  },
  component: ChatListRoute,
});

/**
 * Daftar chat = list virtual + avatar + badge realtime yang sering
 * di-commit ulang; ini salah satu layar tersering memunculkan
 * `NotFoundError: removeChild` di Android WebView. Boundary retry
 * diam-diam supaya daftar percakapan tidak berubah jadi layar putih.
 */
function ChatListRoute() {
  return (
    <DomRaceBoundary
      label="chat-list"
      renderFallback={(error, reset, info) => (
        <DomRaceRecoveryPanel
          error={error}
          reset={reset}
          info={info}
          title="Daftar chat gagal ditampilkan"
        />
      )}
    >
      <ChatListPage />
    </DomRaceBoundary>
  );
}

function timeShort(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays < 7) return d.toLocaleDateString("id-ID", { weekday: "short" });
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit" });
}

function ChatListPage() {
  useChatHeartbeat();
  const { data: conversations, isLoading, isError, error, isFetching, refetch } = useConversations();
  const pendingRequests = usePendingIncomingCount();
  const [q, setQ] = useState("");
  const search = useChatSearch(q);
  const navigate = useNavigate();
  const router = useRouter();
  const routeSearch = Route.useSearch();
  const pin = usePinConversation();
  const archive = useArchiveConversation();
  const mute = useMuteConversation();
  const [grupOpen, setGrupOpen] = useState(false);
  // Filter chip aktif — preset WA + daftar custom (prefix `list:<id>`).
  const [filter, setFilter] = useState<string>(
    routeSearch.filter === "unread" ? "unread" : "all",
  );
  // Sinkron ulang bila user mengetuk tab Chat lagi dari tab lain dengan
  // unread — TanStack Router hanya mengganti search param tanpa remount.
  useEffect(() => {
    if (routeSearch.filter === "unread") setFilter("unread");
  }, [routeSearch.filter]);
  const { data: chatLists } = useChatLists();
  const { data: allListMembers } = useAllChatListMembers();
  // Mode seleksi multi-percakapan (tekan lama untuk aktif).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const qc = useQueryClient();
  const selecting = selectedIds.size > 0;
  const exitSelect = useCallback(() => setSelectedIds(new Set()), []);
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  // Handler stabil supaya baris daftar (memo) tidak ikut re-render tiap render induk.
  const handlePin = useCallback(
    (c: { id: string; pinned_at?: string | null }) =>
      pin.mutate(
        { conversationId: c.id, pin: !c.pinned_at },
        { onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal") },
      ),
    [pin],
  );
  const handleArchive = useCallback(
    (c: { id: string; archived_at?: string | null }) =>
      archive.mutate(
        { conversationId: c.id, archive: !c.archived_at },
        {
          onSuccess: () =>
            toast.success(c.archived_at ? "Percakapan dikembalikan" : "Percakapan diarsipkan"),
        },
      ),
    [archive],
  );
  const handleMute = useCallback(
    (c: { id: string }, until: Date | null) =>
      mute.mutate(
        { conversationId: c.id, until },
        {
          onSuccess: () =>
            toast.success(until ? "Notifikasi dibisukan" : "Bisukan dibatalkan"),
        },
      ),
    [mute],
  );
  /**
   * Hapus isi chat satu percakapan TANPA menghapus kontaknya.
   * Memakai RPC yang sama dengan hapus massal (`chat_clear_conversation_for_me`):
   * pesan hilang dari riwayat saya, baris percakapan & kontak tetap ada.
   */
  const handleClearChat = useCallback(
    async (c: { id: string; display_title: string }) => {
      const ok = await confirm({
        title: `Hapus chat dengan ${c.display_title}?`,
        description:
          "Semua pesan di percakapan ini dihapus dari riwayatmu. Kontaknya tetap tersimpan dan percakapan bisa dilanjutkan kapan saja.",
        confirmText: "Hapus chat",
        cancelText: "Batal",
        destructive: true,
      });
      if (!ok) return;
      setDeleting(true);
      try {
        const { data, error } = await supabase.rpc("chat_clear_conversation_for_me", {
          _conv: c.id,
        });
        if (error) throw error;
        const paths = ((data ?? []) as string[]).filter((p): p is string => !!p);
        if (paths.length > 0) {
          await supabase.storage
            .from("chat-attachments")
            .remove(paths)
            .catch(() => undefined);
        }
        qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
        qc.invalidateQueries({ queryKey: ["chat", "messages", c.id] });
        toast.success("Chat dihapus — kontak tetap tersimpan");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Gagal menghapus chat");
      } finally {
        setDeleting(false);
      }
    },
    [qc],
  );
  // Pantau path aktif untuk menandai item menu yang sedang dibuka.
  const currentPath = useRouterState({ select: (s) => s.location.pathname });
  const isPathActive = (to: string): boolean =>
    currentPath === to || currentPath.startsWith(`${to}/`);

  const { active, archived } = useMemo(() => {
    const list = conversations ?? [];
    const act = list.filter((c) => !c.archived_at);
    const arc = list.filter((c) => !!c.archived_at);
    // Sort active: pinned first, then last_at desc
    act.sort((a, b) => {
      if (!!a.pinned_at !== !!b.pinned_at) return a.pinned_at ? -1 : 1;
      const at = a.last_at ? new Date(a.last_at).getTime() : 0;
      const bt = b.last_at ? new Date(b.last_at).getTime() : 0;
      return bt - at;
    });
    return { active: act, archived: arc };
  }, [conversations]);

  /**
   * Slice D — kategori workflow (SSOT).
   * - Baris dengan `workflow_category='archived'` (dari auto-archive Slice C)
   *   ATAU per-user archive lama (`archived_at`) → masuk tab "Arsip".
   * - Sisanya dikelompokkan berdasarkan `workflow_category` dengan default
   *   'customer' untuk baris yang belum di-set.
   */
  const byCategory = useMemo(() => {
    const buckets: Record<ChatCategory, typeof active> = {
      customer: [],
      employee: [],
      internal: [],
      archived: [],
    };
    for (const c of active) {
      const cat: ChatCategory =
        c.workflow_category === "employee" ||
        c.workflow_category === "internal" ||
        c.workflow_category === "archived"
          ? (c.workflow_category as ChatCategory)
          : "customer";
      if (cat === "archived") buckets.archived.push(c);
      else buckets[cat].push(c);
    }
    // Auto-archived rows (workflow_category='archived') sudah masuk buckets.archived
    // via loop di atas — mereka lolos filter `!c.archived_at` karena archive di sini
    // adalah per-user (conversation_members), bukan workflow.
    for (const c of archived) buckets.archived.push(c);
    return buckets;
  }, [active, archived]);

  /** Untuk tab Pelanggan: kelompokkan per Order/Customer id. */
  const customerGroups = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; items: typeof active }>();
    const ungrouped: typeof active = [];
    for (const c of byCategory.customer) {
      const key =
        c.linked_request_prep_id
          ? `REQ-${c.linked_request_prep_id}`
          : c.linked_ecer_prep_id
            ? `ECER-${c.linked_ecer_prep_id}`
            : c.linked_customer_id
              ? `CUST-${c.linked_customer_id}`
              : "";
      if (!key) {
        ungrouped.push(c);
        continue;
      }
      const label = key
        .replace(/^REQ-/, "REQ-")
        .replace(/^ECER-/, "ECER-")
        .replace(/^CUST-/, "CUST-")
        .replace(/-([0-9a-f-]+)$/i, (_, id: string) => `-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`);
      const g = groups.get(key) ?? { key, label, items: [] };
      g.items.push(c);
      groups.set(key, g);
    }
    return { groups: Array.from(groups.values()), ungrouped };
  }, [byCategory.customer]);

  // Terapkan filter chip pada daftar aktif.
  const filteredActive = useMemo(() => {
    if (filter.startsWith("list:")) {
      const listId = filter.slice("list:".length);
      const ids = new Set(allListMembers?.[listId] ?? []);
      return active.filter((c) => ids.has(c.id));
    }
    switch (filter) {
      case "unread":
        return active.filter((c) => (c.unread ?? 0) > 0);
      case "group":
        return active.filter((c) => c.kind === "group");
      case "favorite":
        return active.filter((c) => !!c.pinned_at);
      default:
        return active;
    }
  }, [active, filter, allListMembers]);

  const currentVisibleIds = useMemo(() => {
    // Untuk aksi "Pilih semua" — pilih dari gabungan aktif+arsip yang tampil.
    return [...active, ...archived].map((c) => c.id);
  }, [active, archived]);

  // Hitungan per-chip untuk ditampilkan sebagai badge angka di samping label.
  const chipCounts = useMemo(() => {
    const all = active.length;
    const unread = active.reduce((n, c) => n + ((c.unread ?? 0) > 0 ? 1 : 0), 0);
    const group = active.reduce((n, c) => n + (c.kind === "group" ? 1 : 0), 0);
    const favorite = active.reduce((n, c) => n + (c.pinned_at ? 1 : 0), 0);
    const perList: Record<string, number> = {};
    for (const l of chatLists ?? []) {
      const ids = new Set(allListMembers?.[l.id] ?? []);
      perList[l.id] = active.reduce((n, c) => n + (ids.has(c.id) ? 1 : 0), 0);
    }
    return { all, unread, group, favorite, perList };
  }, [active, chatLists, allListMembers]);

  const allSelected =
    currentVisibleIds.length > 0 &&
    currentVisibleIds.every((id) => selectedIds.has(id));

  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const ok = await confirm({
      title: `Bersihkan ${ids.length} percakapan?`,
      description:
        "Semua pesan lama akan hilang dari daftar dan riwayatmu. Percakapan akan muncul lagi bila ada pesan baru.",
      confirmText: "Bersihkan",
      cancelText: "Batal",
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    let failed = 0;
    for (const convId of ids) {
      try {
        const { data, error } = await supabase.rpc("chat_clear_conversation_for_me", { _conv: convId });
        if (error) throw error;
        const paths = ((data ?? []) as string[]).filter((p): p is string => !!p);
        if (paths.length > 0) {
          await supabase.storage.from("chat-attachments").remove(paths).catch(() => undefined);
        }
      } catch {
        failed += 1;
      }
    }
    setDeleting(false);
    qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
    for (const convId of ids) {
      qc.invalidateQueries({ queryKey: ["chat", "messages", convId] });
    }
    exitSelect();
    if (failed === 0) {
      toast.success(`${ids.length} percakapan dibersihkan`);
    } else if (failed < ids.length) {
      toast.warning(`${ids.length - failed} berhasil, ${failed} gagal`);
    } else {
      toast.error("Gagal membersihkan pesan");
    }
  }, [selectedIds, qc, exitSelect]);

  // Saat soft-keyboard terbuka (fokus di Input "Cari percakapan…"),
  // kecilkan tinggi container agar search bar & daftar percakapan
  // ter-reposisi di atas keyboard alih-alih tertutup. `ChatBottomNav`
  // sengaja tetap `fixed` — nav tidak ikut naik.
  const kbInset = useVisualViewportKeyboardInset();
  return (
    <main
      data-industrial="chat"
      // `--chat-nav-h` didefinisikan di container ini supaya SEMUA sibling
      // (nav, FAB, konten) mewarisi nilai yang sama. Nilai sudah termasuk
      // `var(--app-safe-bottom,env(safe-area-inset-bottom,0px))`, jadi `pb-[var(--chat-nav-h)]`
      // otomatis menyediakan ruang untuk notch/home indicator iOS tanpa
      // menghitung safe-area dua kali.
      // `transition-[height,min-height]` menghaluskan reposisi search bar
      // & daftar percakapan saat soft-keyboard membuka/menutup. Durasi
      // 200ms mendekati kurva animasi keyboard Android/iOS tanpa
      // membuatnya terasa lambat. `motion-reduce:transition-none`
      // menghormati preferensi pengguna.
      className="mx-auto flex min-h-app-vh max-w-2xl flex-col wa-surface pb-[var(--chat-nav-h)] [--chat-nav-h:calc(var(--ms-tap)+1.25rem+var(--app-safe-bottom,env(safe-area-inset-bottom,0px)))] transition-[height,min-height] duration-200 ease-out motion-reduce:transition-none"
      style={
        kbInset > 0
          ? {
              minHeight: `calc(var(--app-vh, 100dvh) - ${kbInset}px)`,
              height: `calc(var(--app-vh, 100dvh) - ${kbInset}px)`,
            }
          : undefined
      }
    >
      {/* AppHeader disembunyikan pada rute ini (layar penuh), jadi blok atas
          dikunci langsung di puncak layar + safe-area notch supaya judul,
          pencarian, dan filter tidak terpotong maupun naik-turun saat
          daftar digulir. */}
      <div className="app-safe-top sticky top-0 z-20 wa-surface border-b border-[var(--wa-border)]">
      {selecting ? (
        <header
          className="flex items-center justify-between gap-ms-2 bg-primary px-ms-3 py-ms-3 text-primary-foreground shadow-sm"
          role="toolbar"
          aria-label="Mode pilih percakapan"
        >
          <div className="flex items-center gap-ms-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full text-primary-foreground hover:bg-white/15"
              onClick={exitSelect}
              aria-label="Batal pilih"
            >
              <X className="h-5 w-5" />
            </Button>
            <span className="text-ms-base font-semibold">{selectedIds.size} dipilih</span>
          </div>
          <div className="flex items-center gap-ms-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full text-primary-foreground hover:bg-white/15"
              onClick={() =>
                setSelectedIds(
                  allSelected ? new Set() : new Set(currentVisibleIds),
                )
              }
              aria-label={allSelected ? "Hapus semua pilihan" : "Pilih semua"}
              title={allSelected ? "Hapus semua pilihan" : "Pilih semua"}
            >
              {allSelected ? <Square className="h-5 w-5" /> : <CheckSquare className="h-5 w-5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full text-primary-foreground hover:bg-white/15"
              onClick={handleBulkDelete}
              disabled={deleting || selectedIds.size === 0}
              aria-label={`Hapus pesan di ${selectedIds.size} percakapan`}
            >
              {deleting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Trash2 className="h-5 w-5" />
              )}
            </Button>
          </div>
        </header>
      ) : (
      <header className="wa-header flex items-center justify-between gap-ms-2 px-ms-3 py-ms-2">
        <div className="flex min-w-0 items-center gap-ms-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0 rounded-full sm:h-9 sm:w-9"
            aria-label="Kembali ke Beranda"
            title="Beranda"
            onClick={() => goBackOr(router, { to: "/" })}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="truncate text-ms-lg font-semibold tracking-tight">Ace Chat</h1>
        </div>
        <div className="flex items-center gap-ms-1">
          <NewDmDialog />
          <NewGroupDialog open={grupOpen} onOpenChange={setGrupOpen} trigger={false} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 rounded-full data-[state=open]:bg-accent data-[state=open]:text-accent-foreground sm:h-9 sm:w-9"
                aria-label="Menu lainnya"
              >
                <MoreVertical className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {(() => {
                type Item =
                  | { label: string; to: string }
                  | { label: string; action: () => void };
                const items: Item[] = [
                  { label: "Kontak", to: "/kontak" },
                  { label: "Mapping kontak", to: "/kontak-mapping" },
                  { label: "Grup baru", action: () => setGrupOpen(true) },
                  { label: "Daftar", to: "/daftar" },
                  { label: "Perangkat tertaut", to: "/sesi" },
                  { label: "Order", to: "/chat-audit" },
                ];
                const settings: Item = { label: "Pengaturan", to: "/profil-chat" };
                const renderItem = (it: Item, key: string) => {
                  const active = "to" in it && isPathActive(it.to);
                  const cls = active
                    ? "bg-primary/10 font-medium text-primary focus:bg-primary/15 focus:text-primary"
                    : "";
                  const label = (
                    <>
                      <span className="truncate">{it.label}</span>
                      {active ? <Check className="h-4 w-4 shrink-0" aria-hidden /> : null}
                    </>
                  );
                  if ("to" in it) {
                    return (
                      <DropdownMenuItem
                        key={key}
                        asChild
                        aria-current={active ? "page" : undefined}
                        className={cls}
                      >
                        <Link to={it.to as "/sesi"}>{label}</Link>
                      </DropdownMenuItem>
                    );
                  }
                  return (
                    <DropdownMenuItem key={key} onSelect={it.action} className={cls}>
                      {it.label}
                    </DropdownMenuItem>
                  );
                };
                return (
                  <>
                    {items.map((it, i) => renderItem(it, `it-${i}`))}
                    <DropdownMenuSeparator />
                    {renderItem(settings, "settings")}
                  </>
                );
              })()}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      )}
      <div className="space-ms-2 px-ms-3 pb-ms-2 pt-ms-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--wa-text-muted)]" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari percakapan…"
          className="chat-input-contrast h-9 rounded-full border border-[var(--wa-field-border)] bg-transparent pl-9 pr-8 text-ms-sm shadow-none focus-visible:ring-1 focus-visible:ring-[var(--wa-green)]/40"
        />
        {q ? (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-0.5 top-1/2 h-8 w-8 -translate-y-1/2 text-[var(--wa-text-muted)]"
            onClick={() => setQ("")}
            aria-label="Bersihkan"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      {q.trim().length < 2 ? (
        <div
          role="tablist"
          aria-label="Filter cepat"
          className="-mx-1 flex items-center gap-ms-3 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {([
            { id: "all" as const, label: "Semua", n: chipCounts.all },
            { id: "unread" as const, label: "Belum dibaca", n: chipCounts.unread },
            { id: "group" as const, label: "Grup", n: chipCounts.group },
            { id: "favorite" as const, label: "Favorit", n: chipCounts.favorite },
          ]).map((chip) => {
            const isActive = filter === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setFilter(chip.id)}
                className={
                  "relative whitespace-nowrap text-ms-xs transition-colors " +
                  (isActive
                    ? "font-medium text-[var(--wa-text)]"
                    : "text-[var(--wa-text-muted)] hover:text-[var(--wa-text)]")
                }
              >
                {chip.label} <span className="opacity-60 tabular-nums">({chip.n})</span>
                {isActive ? (
                  <span
                    aria-hidden
                    className="absolute -bottom-1 left-0 right-0 h-0.5 rounded-full bg-[var(--wa-green)]"
                  />
                ) : null}
              </button>
            );
          })}
          {(chatLists ?? []).map((l) => {
            const chipId = `list:${l.id}`;
            const isActive = filter === chipId;
            const n = chipCounts.perList[l.id] ?? 0;
            return (
              <button
                key={chipId}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setFilter(chipId)}
                className={
                  "relative inline-flex items-center gap-ms-1 whitespace-nowrap text-ms-xs transition-colors " +
                  (isActive
                    ? "font-medium text-[var(--wa-text)]"
                    : "text-[var(--wa-text-muted)] hover:text-[var(--wa-text)]")
                }
                title={l.name}
              >
                <ChatListIcon name={l.icon} className="h-3 w-3" style={{ color: l.color }} />
                {l.name} <span className="opacity-60 tabular-nums">({n})</span>
                {isActive ? (
                  <span
                    aria-hidden
                    className="absolute -bottom-1 left-0 right-0 h-0.5 rounded-full bg-[var(--wa-green)]"
                  />
                ) : null}
              </button>
            );
          })}
          <Link
            to="/daftar"
            className="text-ms-xs text-[var(--wa-text-muted)] hover:text-[var(--wa-text)]"
            aria-label="Kelola daftar"
            title="Kelola daftar"
          >
            + Daftar
          </Link>
        </div>
      ) : null}
      </div>
      </div>

      <div className="flex-1 space-ms-3 px-ms-3 py-ms-3">
      {isError && (conversations?.length ?? 0) > 0 ? (
        <div className="flex items-start gap-ms-2 rounded-md border border-warning/40 bg-warning/10 px-ms-3 py-ms-2 text-ms-xs text-warning dark:text-warning">
          <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Menampilkan data offline</p>
            <p className="opacity-80">
              Tidak bisa menyegarkan daftar chat: {error instanceof Error ? error.message : "jaringan bermasalah"}.
            </p>
          </div>
          <Button size="sm" variant="outline" className="h-7 px-ms-2 text-ms-2xs" disabled={isFetching} onClick={() => refetch()}>
            {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : "Coba lagi"}
          </Button>
        </div>
      ) : null}

      {pendingRequests > 0 ? (
        <Link
          to={"/kontak/permintaan" as never}
          className="flex items-center gap-ms-2 rounded-lg border border-[var(--wa-border)] bg-[var(--wa-surface-2)]/50 px-ms-3 py-ms-2 text-ms-sm hover:bg-[var(--wa-surface-2)]"
          aria-label="Buka permintaan pertemanan"
        >
          <UserPlus className="h-4 w-4 shrink-0 text-[var(--wa-text-muted)]" />
          <div className="min-w-0 flex-1 truncate">
            <span className="font-medium">{pendingRequests} permintaan pertemanan</span>
            <span className="text-[var(--wa-text-muted)]"> — terima supaya bisa chat</span>
          </div>
          <span className="text-ms-xs text-[var(--wa-text-muted)]">›</span>
        </Link>
      ) : null}

      {q.trim().length >= 2 ? (
        <div className="rounded-lg border">
          {search.isLoading ? (
            <div className="flex items-center justify-center p-ms-6 text-ms-xs text-muted-foreground">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Mencari…
            </div>
          ) : (search.data ?? []).length === 0 ? (
            <div className="p-ms-6 text-center text-ms-xs text-muted-foreground">
              Tidak ada pesan yang cocok dengan "{q}".
            </div>
          ) : (
            <ul className="divide-y">
              {search.data!.map((m) => {
                const conv = (conversations ?? []).find((c) => c.id === m.conversation_id);
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => navigate({ to: "/chat/$conversationId", params: { conversationId: m.conversation_id } })}
                      className="flex w-full items-start gap-ms-3 px-ms-3 py-ms-3 text-left hover:bg-accent/50"
                    >
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                        <Search className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-ms-2">
                          <span className="truncate text-ms-sm font-medium">{conv?.display_title ?? "Percakapan"}</span>
                          <span className="shrink-0 text-ms-2xs text-muted-foreground">{timeShort(m.created_at)}</span>
                        </div>
                        <p className="line-clamp-2 text-ms-xs text-muted-foreground">{highlight(previewText(m.body) ?? "", q)}</p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <Tabs defaultValue="all">
          {/* Tab kategori ringkas — garis bawah aktif, tanpa latar/border berat. */}
          <TabsList
            className={
              "-mx-3 flex h-auto w-auto items-center justify-start gap-ms-4 " +
              "overflow-x-auto border-b border-[var(--wa-border)] bg-transparent px-3 pb-0 " +
              "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            }
          >
            {(
              [
                { value: "all", label: "Semua" },
                { value: "customer", label: CHAT_CATEGORY_LABEL_ID.customer },
                { value: "employee", label: CHAT_CATEGORY_LABEL_ID.employee },
                { value: "internal", label: CHAT_CATEGORY_LABEL_ID.internal },
                { value: "archived", label: "Arsip" },
              ] as const
            ).map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className={
                  "relative shrink-0 whitespace-nowrap rounded-none border-0 bg-transparent px-0 py-2 " +
                  "text-ms-xs font-medium text-[var(--wa-text-muted)] shadow-none transition-colors " +
                  "after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:rounded-full " +
                  "after:bg-[var(--wa-green)] after:opacity-0 after:transition-opacity " +
                  "hover:text-[var(--wa-text)] " +
                  "data-[state=active]:text-[var(--wa-text)] data-[state=active]:shadow-none data-[state=active]:after:opacity-100"
                }
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {!isLoading && active.length === 0 && archived.length === 0 ? (
            <div className="mt-3">
              <ChatOnboarding onNewGroup={() => setGrupOpen(true)} />
            </div>
          ) : null}
          <TabsContent value="all">
            <ConvList
              list={filteredActive}
              isLoading={isLoading}
              selecting={selecting}
              selectedIds={selectedIds}
              onLongPressStart={toggleSelect}
              onRowTap={toggleSelect}
              empty={
                <div className="space-ms-2 p-8 text-center">
                  <MessageCircle className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="text-ms-sm font-medium">Belum ada percakapan</p>
                  <p className="text-ms-xs text-muted-foreground">
                    Mulai chat dengan kontak yang akunnya sudah tertaut, atau buat grup baru.
                  </p>
                  <div className="pt-2">
                    <Button asChild size="sm" className="gap-ms-1.5">
                      <Link to="/kontak">
                        <Link2 className="h-4 w-4" /> Siapkan kontak chat
                      </Link>
                    </Button>
                  </div>
                </div>
              }
              onPin={handlePin}
              onArchive={handleArchive}
              onMute={handleMute}
              onClearChat={handleClearChat}
            />
          </TabsContent>
          <TabsContent value="customer">
            {customerGroups.groups.length === 0 && customerGroups.ungrouped.length === 0 ? (
              <div className="rounded-lg border p-ms-6 text-center text-ms-xs text-muted-foreground">
                Belum ada chat pelanggan.
              </div>
            ) : (
              <>
                {customerGroups.groups.length > 0 ? (
                  <Accordion type="multiple" className="mb-2">
                    {customerGroups.groups.map((g) => (
                      <AccordionItem key={g.key} value={g.key} className="border-b">
                        <AccordionTrigger className="px-1 py-ms-2 text-ms-xs font-medium">
                          <span className="truncate">
                            {g.label}{" "}
                            <span className="ml-1 text-muted-foreground">
                              ({g.items.length})
                            </span>
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="pb-0">
                          <ConvList
                            list={g.items}
                            isLoading={false}
                            selecting={selecting}
                            selectedIds={selectedIds}
                            onLongPressStart={toggleSelect}
                            onRowTap={toggleSelect}
                            empty={null}
                            onPin={handlePin}
                            onArchive={handleArchive}
                            onMute={handleMute}
                            onClearChat={handleClearChat}
                          />
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                ) : null}
                {customerGroups.ungrouped.length > 0 ? (
                  <div>
                    <div className="px-1 py-ms-2 text-ms-2xs font-medium uppercase tracking-wide text-muted-foreground">
                      Tanpa Order
                    </div>
                    <ConvList
                      list={customerGroups.ungrouped}
                      isLoading={false}
                      selecting={selecting}
                      selectedIds={selectedIds}
                      onLongPressStart={toggleSelect}
                      onRowTap={toggleSelect}
                      empty={null}
                      onPin={handlePin}
                      onArchive={handleArchive}
                      onMute={handleMute}
                      onClearChat={handleClearChat}
                    />
                  </div>
                ) : null}
              </>
            )}
          </TabsContent>
          <TabsContent value="employee">
            <ConvList
              list={byCategory.employee}
              isLoading={isLoading}
              selecting={selecting}
              selectedIds={selectedIds}
              onLongPressStart={toggleSelect}
              onRowTap={toggleSelect}
              empty={
                <div className="p-8 text-center text-ms-xs text-muted-foreground">
                  Belum ada chat karyawan.
                </div>
              }
              onPin={handlePin}
              onArchive={handleArchive}
              onMute={handleMute}
              onClearChat={handleClearChat}
            />
          </TabsContent>
          <TabsContent value="internal">
            <ConvList
              list={byCategory.internal}
              isLoading={isLoading}
              selecting={selecting}
              selectedIds={selectedIds}
              onLongPressStart={toggleSelect}
              onRowTap={toggleSelect}
              empty={
                <div className="p-8 text-center text-ms-xs text-muted-foreground">
                  Belum ada catatan internal.
                </div>
              }
              onPin={handlePin}
              onArchive={handleArchive}
              onMute={handleMute}
              onClearChat={handleClearChat}
            />
          </TabsContent>
          <TabsContent value="archived">
            <ConvList
              list={byCategory.archived}
              isLoading={isLoading}
              selecting={selecting}
              selectedIds={selectedIds}
              onLongPressStart={toggleSelect}
              onRowTap={toggleSelect}
              empty={
                <div className="p-8 text-center text-ms-xs text-muted-foreground">
                  Belum ada percakapan yang diarsipkan.
                </div>
              }
              archivedView
              onPin={() => undefined}
              onArchive={handleArchive}
              onMute={() => undefined}
              onClearChat={handleClearChat}
            />
          </TabsContent>
        </Tabs>
      )}
      </div>
      {selecting ? null : <AddContactFab />}
      <ChatBottomNav />
    </main>
  );
}

function highlight(text: string, q: string) {
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-primary/20 px-0.5 text-foreground">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

type ConvItem = ReturnType<typeof useConversations>["data"] extends Array<infer R> | undefined ? R : never;

function ConvList({
  list,
  isLoading,
  empty,
  archivedView,
  onPin,
  onArchive,
  onMute,
  onClearChat,
  selecting,
  selectedIds,
  onLongPressStart,
  onRowTap,
}: {
  list: ConvItem[];
  isLoading: boolean;
  empty: React.ReactNode;
  archivedView?: boolean;
  onPin: (c: ConvItem) => void;
  onArchive: (c: ConvItem) => void;
  onMute: (c: ConvItem, until: Date | null) => void;
  onClearChat: (c: ConvItem) => void;
  selecting: boolean;
  selectedIds: Set<string>;
  onLongPressStart: (id: string) => void;
  onRowTap: (id: string) => void;
}) {
  if (isLoading) {
    return <ChatListSkeleton rows={7} />;
  }
  if (list.length === 0) {
    return <div className="rounded-lg border border-[var(--wa-border)] p-6">{empty}</div>;
  }
  return (
    <div className="-mx-3 divide-y divide-[var(--wa-border)]/60">
      <VirtualizedList
        cacheKey="chat-list"
        items={list}
        getKey={(c) => c.id}
        estimateSize={76}
        gap={0}
        // Semua state visual eksternal yang dibaca renderItem — tanpa ini,
        // toggle pilihan tidak mengubah checkbox/highlight karena identitas
        // item tidak berubah.
        rowVersion={`${archivedView ? 1 : 0}|${selecting ? 1 : 0}|${Array.from(selectedIds).sort().join(",")}`}
        renderItem={(c) => (
          <ConvListItem
            c={c}
            archivedView={archivedView}
            selecting={selecting}
            isSelected={selectedIds.has(c.id)}
            onPin={onPin}
            onArchive={onArchive}
            onMute={onMute}
            onClearChat={onClearChat}
            onLongPressStart={onLongPressStart}
            onRowTap={onRowTap}
          />
        )}
      />
    </div>
  );
}

const ConvListItem = React.memo(function ConvListItem({
  c,
  archivedView,
  selecting,
  isSelected,
  onPin,
  onArchive,
  onMute,
  onClearChat,
  onLongPressStart,
  onRowTap,
}: {
  c: ConvItem;
  archivedView?: boolean;
  selecting: boolean;
  isSelected: boolean;
  onPin: (c: ConvItem) => void;
  onArchive: (c: ConvItem) => void;
  onMute: (c: ConvItem, until: Date | null) => void;
  onClearChat: (c: ConvItem) => void;
  onLongPressStart: (id: string) => void;
  onRowTap: (id: string) => void;
}) {
  const mutedUntil = c.muted_until ? new Date(c.muted_until) : null;
  const isMuted = !!(mutedUntil && mutedUntil.getTime() > Date.now());
  return (
    <div className={`relative ${isSelected ? "bg-primary/10" : ""}`}>
              <ConvRow
                conv={c}
                isMuted={!!isMuted}
                selecting={selecting}
                isSelected={isSelected}
                onLongPress={() => onLongPressStart(c.id)}
                onTapWhileSelecting={() => onRowTap(c.id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-ms-2">
                    <span className="flex min-w-0 items-center gap-ms-1 truncate text-ms-sm font-semibold tracking-tight text-[var(--wa-text)]">
                      {c.pinned_at ? <Pin className="h-3 w-3 shrink-0 text-[var(--wa-text-muted)]" /> : null}
                      <span className="truncate">{c.display_title}</span>
                      {isMuted ? <BellOff className="h-3 w-3 shrink-0 text-[var(--wa-text-muted)]" /> : null}
                    </span>
                    <span className={`shrink-0 text-ms-2xs ${c.unread > 0 ? "text-[var(--wa-green)]" : "text-[var(--wa-text-muted)]"}`}>{timeShort(c.last_at)}</span>
                  </div>
                  {/* Chip saldo dipindah sebaris dengan preview supaya baris
                      chat tetap 2 baris (ritme WhatsApp) dan tidak ragged. */}
                  <div className="mt-0.5 flex items-center justify-between gap-ms-2">
                    <span className="flex min-w-0 items-center gap-ms-1 truncate text-ms-xs text-[var(--wa-text-muted)]">
                      {c.last_body ? (
                        <>
                          {c.last_mine ? (
                            c.last_read ? (
                              <CheckCheck className="h-3 w-3 shrink-0 text-[var(--wa-check)]" aria-label="Dibaca" />
                            ) : c.last_delivered ? (
                              <CheckCheck className="h-3 w-3 shrink-0 text-[var(--wa-text)]" aria-label="Sampai di perangkat lawan" />
                            ) : (
                              <Check className="h-3 w-3 shrink-0 text-[var(--wa-text-muted)]" aria-label="Terkirim" />
                            )
                          ) : null}
                          <span className="truncate">{previewText(c.last_body) ?? ""}</span>
                        </>
                      ) : (
                        <em className="text-[var(--wa-text-muted)]/70">Belum ada pesan</em>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-ms-1">
                      <DebtSyncBadge title={c.display_title} />
                      {c.unread > 0 ? (
                      <span className="ml-2 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--wa-green)] px-1 text-ms-2xs font-semibold text-[var(--wa-surface)]">
                        {c.unread > 99 ? "99+" : c.unread}
                      </span>
                      ) : null}
                    </span>
                  </div>
                </div>
              </ConvRow>
              {selecting ? null : (
              <div className="absolute right-0 top-1/2 -translate-y-1/2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-[var(--wa-text-muted)] hover:text-[var(--wa-text)]"
                      aria-label="Opsi"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    {!archivedView ? (
                      <>
                        <DropdownMenuItem onSelect={() => onPin(c)}>
                          <Pin className="mr-2 h-4 w-4" />
                          {c.pinned_at ? "Lepas pin" : "Pin ke atas"}
                        </DropdownMenuItem>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            {isMuted ? (
                              <BellOff className="mr-2 h-4 w-4" />
                            ) : (
                              <BellRing className="mr-2 h-4 w-4" />
                            )}
                            {isMuted ? "Berhenti membisukan" : "Bisukan notifikasi"}
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            <DropdownMenuItem onSelect={() => onMute(c, addMin(60))}>
                              1 jam
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onMute(c, addMin(60 * 8))}>
                              8 jam
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onMute(c, addMin(60 * 24 * 7))}>
                              1 minggu
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onMute(c, new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 10))}>
                              Selamanya
                            </DropdownMenuItem>
                            {isMuted ? (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={() => onMute(c, null)}>
                                  Bunyikan lagi
                                </DropdownMenuItem>
                              </>
                            ) : null}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuSeparator />
                      </>
                    ) : null}
                    <DropdownMenuItem onSelect={() => onArchive(c)}>
                      {archivedView ? (
                        <>
                          <ArchiveRestore className="mr-2 h-4 w-4" /> Kembalikan ke Aktif
                        </>
                      ) : (
                        <>
                          <Archive className="mr-2 h-4 w-4" /> Arsipkan
                        </>
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => onClearChat(c)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Hapus chat (kontak tetap)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              )}
    </div>
  );
});

/**
 * Baris satu percakapan dengan dukungan tekan lama (long-press) untuk masuk
 * mode seleksi. Saat mode seleksi aktif, tap tunggal memilih/lepas, tanpa
 * navigasi. Long-press ~450ms memicu haptic + masuk mode seleksi.
 */
function ConvRow({
  conv,
  selecting,
  isSelected,
  onLongPress,
  onTapWhileSelecting,
  children,
}: {
  conv: ConvItem;
  isMuted: boolean;
  selecting: boolean;
  isSelected: boolean;
  onLongPress: () => void;
  onTapWhileSelecting: () => void;
  children: React.ReactNode;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggered = useRef(false);
  const startXY = useRef<{ x: number; y: number } | null>(null);

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const onPointerDown = (e: React.PointerEvent) => {
    triggered.current = false;
    startXY.current = { x: e.clientX, y: e.clientY };
    clear();
    timer.current = setTimeout(() => {
      triggered.current = true;
      try {
        (navigator as Navigator & { vibrate?: (p: number) => void }).vibrate?.(35);
      } catch { /* noop */ }
      onLongPress();
    }, 450);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!startXY.current) return;
    const dx = e.clientX - startXY.current.x;
    const dy = e.clientY - startXY.current.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clear();
  };
  const onPointerUp = () => clear();
  const onPointerCancel = () => clear();
  const onContextMenu = (e: React.MouseEvent) => {
    // Web/desktop: klik kanan = long-press setara.
    e.preventDefault();
    triggered.current = true;
    onLongPress();
  };

  const checkbox = (
    <div
      aria-hidden
      className={
        "grid h-6 w-6 shrink-0 place-items-center rounded-md border transition " +
        (isSelected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-[var(--wa-border)] bg-transparent")
      }
    >
      {isSelected ? <Check className="h-4 w-4" /> : null}
    </div>
  );

  const avatar = (
    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--wa-surface-2)] text-[var(--wa-text-muted)] text-ms-xs font-semibold uppercase">
      {(conv.display_title ?? "?").trim().charAt(0) || "?"}
    </div>
  );

  const inner = (
    <>
      {selecting ? checkbox : null}
      {avatar}
      {children}
    </>
  );

  const rowClass =
    "flex items-center gap-ms-3 px-ms-3 py-ms-2 pr-10 hover:bg-[var(--wa-surface-2)]/50 " +
    (selecting ? "cursor-pointer select-none" : "");

  if (selecting) {
    return (
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={onContextMenu}
        onClick={(e) => {
          if (triggered.current) {
            e.preventDefault();
            triggered.current = false;
            return;
          }
          onTapWhileSelecting();
        }}
        className={`${rowClass} w-full text-left`}
        aria-pressed={isSelected}
      >
        {inner}
      </button>
    );
  }

  return (
    <Link
      to="/chat/$conversationId"
      params={{ conversationId: conv.id }}
      className={rowClass}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={onContextMenu}
      onClick={(e) => {
        if (triggered.current) {
          // Cegah navigasi setelah long-press.
          e.preventDefault();
          triggered.current = false;
        }
      }}
    >
      {inner}
    </Link>
  );
}

function addMin(m: number) {
  return new Date(Date.now() + m * 60 * 1000);
}