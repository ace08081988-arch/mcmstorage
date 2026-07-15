import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  MessageCircle, Loader2, Link2, CheckCheck, Pin, Archive, BellOff, UserPlus,
  Search, MoreVertical, ArchiveRestore, BellRing, X, WifiOff, Check, Camera,
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
import { StatusBadge } from "@/components/StatusBadge";
import { CHAT_CATEGORY_LABEL_ID, type ChatCategory } from "@/lib/chat-category";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { previewText } from "@/lib/chat-cards";

export const Route = createFileRoute("/_authenticated/chat/")({
  // Terima query `?filter=unread` sebagai deep-link dari tab Chat di bottom
  // nav — supaya mengetuk badge chat langsung memfokuskan daftar pesan
  // belum dibaca. Nilai lain diabaikan (fallback ke "all").
  validateSearch: (search: Record<string, unknown>) => {
    const raw = typeof search.filter === "string" ? search.filter : undefined;
    return { filter: raw === "unread" ? ("unread" as const) : undefined };
  },
  component: ChatListPage,
});

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
  const unreadCount = useMemo(
    () => active.reduce((n, c) => n + ((c.unread ?? 0) > 0 ? 1 : 0), 0),
    [active],
  );
  const groupCount = useMemo(
    () => active.reduce((n, c) => n + (c.kind === "group" ? 1 : 0), 0),
    [active],
  );
  const favCount = useMemo(
    () => active.reduce((n, c) => n + (c.pinned_at ? 1 : 0), 0),
    [active],
  );

  const currentVisibleIds = useMemo(() => {
    // Untuk aksi "Pilih semua" — pilih dari gabungan aktif+arsip yang tampil.
    return [...active, ...archived].map((c) => c.id);
  }, [active, archived]);

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

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col wa-surface">
      {selecting ? (
        <header
          className="sticky top-0 z-20 flex items-center justify-between gap-ms-2 border-b bg-primary px-ms-3 py-ms-3 text-primary-foreground shadow-sm"
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
      <header className="wa-header sticky top-0 z-10 flex items-center justify-between gap-ms-2 border-b px-ms-4 py-ms-3">
        <div className="flex items-center gap-ms-2">
          <span
            aria-hidden
            className="grid h-8 w-8 place-items-center rounded-lg text-ms-sm font-bold text-white shadow-sm"
            style={{ backgroundColor: "var(--mcm-brand)" }}
          >
            M
          </span>
          <h1 className="text-ms-2xl font-bold tracking-tight">MCM</h1>
        </div>
        <div className="flex items-center gap-ms-1">
          <Button asChild variant="ghost" size="icon" className="h-9 w-9 rounded-full" aria-label="Siapkan kontak">
            <Link to="/kontak"><Camera className="h-5 w-5" /></Link>
          </Button>
          <NewDmDialog />
          <NewGroupDialog open={grupOpen} onOpenChange={setGrupOpen} trigger={false} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={
                  "h-9 w-9 rounded-full data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
                }
                aria-label="Menu lainnya"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {(() => {
                type Item =
                  | { label: string; to: string }
                  | { label: string; action: () => void };
                const items: Item[] = [
                  { label: "Pasang iklan", action: () => toast.info("Pasang iklan — segera hadir.") },
                  { label: "Grup baru", action: () => setGrupOpen(true) },
                  { label: "Komunitas", action: () => toast.info("Komunitas — segera hadir.") },
                  { label: "Daftar", to: "/daftar" },
                  { label: "Perangkat tertaut", to: "/sesi" },
                  { label: "Berbintang", action: () => toast.info("Berbintang — segera hadir.") },
                  { label: "Order", to: "/chat-audit" },
                ];
                const settings: Item = { label: "Pengaturan", to: "/profil-chat" };
                const renderItem = (it: Item, key: string) => {
                  const active = "to" in it && isPathActive(it.to);
                  const cls =
                    "flex items-center justify-between gap-ms-2 " +
                    (active
                      ? "bg-primary/10 font-medium text-primary focus:bg-primary/15 focus:text-primary"
                      : "");
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
                    <DropdownMenuItem key={key} onSelect={it.action}>
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

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 wa-muted" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari…"
          className="wa-search h-10 rounded-full border-0 pl-10 pr-9 shadow-none focus-visible:ring-1 focus-visible:ring-[var(--wa-green)]/50"
        />
        {q ? (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-0.5 top-1/2 h-8 w-8 -translate-y-1/2"
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
          aria-label="Filter percakapan"
          className="-mx-1 flex items-center gap-ms-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {([
            { id: "all" as const, label: "Semua" },
            { id: "unread" as const, label: "Belum dibaca", count: unreadCount, dot: "bg-[var(--wa-green)]" },
            { id: "group" as const, label: "Grup", count: groupCount, dot: "bg-rose-500" },
            { id: "favorite" as const, label: "Favorit", count: favCount },
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
                  "wa-chip whitespace-nowrap " +
                  (isActive ? "wa-chip-active font-medium" : "")
                }
              >
                {chip.dot ? (
                  <span className={`inline-block h-2 w-2 rounded-full ${chip.dot}`} />
                ) : null}
                {chip.label}
                {"count" in chip && chip.count ? (
                  <span className="ml-1 opacity-80">{chip.count}</span>
                ) : null}
              </button>
            );
          })}
          {(chatLists ?? []).map((l) => {
            const chipId = `list:${l.id}`;
            const isActive = filter === chipId;
            const count = (allListMembers?.[l.id] ?? []).length;
            return (
              <button
                key={chipId}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setFilter(chipId)}
                className={
                  "wa-chip whitespace-nowrap inline-flex items-center gap-ms-1.5 " +
                  (isActive ? "wa-chip-active font-medium" : "")
                }
                title={l.name}
              >
                <ChatListIcon name={l.icon} className="h-3.5 w-3.5" style={{ color: l.color }} />
                {l.name}
                {count ? <span className="ml-1 opacity-80">{count}</span> : null}
              </button>
            );
          })}
          <Link
            to="/daftar"
            className="wa-chip whitespace-nowrap inline-flex items-center gap-ms-1"
            aria-label="Kelola daftar"
            title="Kelola daftar"
          >
            <span className="text-ms-base leading-none">+</span> Daftar
          </Link>
        </div>
      ) : null}

      {pendingRequests > 0 ? (
        <Link
          to={"/kontak/permintaan" as never}
          className="mt-2 flex items-center gap-ms-3 rounded-2xl border border-primary/30 bg-primary/5 px-ms-3 py-ms-2 text-ms-sm hover:bg-primary/10"
          aria-label="Buka permintaan pertemanan"
        >
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
            <UserPlus className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">
              {pendingRequests} permintaan pertemanan baru
            </div>
            <div className="truncate text-ms-xs text-muted-foreground">
              Terima dulu supaya bisa chat & panggilan.
            </div>
          </div>
          <span className="inline-flex items-center rounded-full bg-primary px-ms-2 py-0.5 text-ms-xs font-semibold text-primary-foreground">
            {pendingRequests}
          </span>
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
          {/* Horizontal-scroll pill row — hindari grid-cols-5 yang memotong label di 390/411px */}
          <TabsList
            className={
              "-mx-1 flex h-auto w-auto items-center justify-start gap-ms-1.5 " +
              "overflow-x-auto rounded-none bg-transparent p-1 " +
              "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            }
          >
            {(
              [
                { value: "all", label: "Semua", count: active.length },
                { value: "customer", label: CHAT_CATEGORY_LABEL_ID.customer, count: byCategory.customer.length },
                { value: "employee", label: CHAT_CATEGORY_LABEL_ID.employee, count: byCategory.employee.length },
                { value: "internal", label: CHAT_CATEGORY_LABEL_ID.internal, count: byCategory.internal.length },
                { value: "archived", label: "Arsip", count: byCategory.archived.length },
              ] as const
            ).map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className={
                  "shrink-0 whitespace-nowrap rounded-full border border-transparent " +
                  "px-ms-3 py-1 text-ms-xs font-medium text-muted-foreground shadow-none " +
                  "hover:bg-accent/40 hover:text-foreground " +
                  "data-[state=active]:border-[color:color-mix(in_oklab,var(--wa-green)_55%,transparent)] " +
                  "data-[state=active]:bg-[color:color-mix(in_oklab,var(--wa-green)_22%,var(--wa-surface-2))] " +
                  "data-[state=active]:text-foreground data-[state=active]:shadow-none"
                }
              >
                {t.label}
                {t.count ? (
                  <span className="ml-1 opacity-70">({t.count})</span>
                ) : null}
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
              onPin={(c) =>
                pin.mutate(
                  { conversationId: c.id, pin: !c.pinned_at },
                  { onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal") },
                )
              }
              onArchive={(c) =>
                archive.mutate(
                  { conversationId: c.id, archive: true },
                  { onSuccess: () => toast.success("Percakapan diarsipkan") },
                )
              }
              onMute={(c, until) =>
                mute.mutate(
                  { conversationId: c.id, until },
                  {
                    onSuccess: () =>
                      toast.success(until ? "Notifikasi dibisukan" : "Bisukan dibatalkan"),
                  },
                )
              }
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
                            onPin={(c) =>
                              pin.mutate(
                                { conversationId: c.id, pin: !c.pinned_at },
                                { onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal") },
                              )
                            }
                            onArchive={(c) =>
                              archive.mutate(
                                { conversationId: c.id, archive: true },
                                { onSuccess: () => toast.success("Percakapan diarsipkan") },
                              )
                            }
                            onMute={(c, until) =>
                              mute.mutate(
                                { conversationId: c.id, until },
                                {
                                  onSuccess: () =>
                                    toast.success(until ? "Notifikasi dibisukan" : "Bisukan dibatalkan"),
                                },
                              )
                            }
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
                      onPin={(c) =>
                        pin.mutate(
                          { conversationId: c.id, pin: !c.pinned_at },
                          { onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal") },
                        )
                      }
                      onArchive={(c) =>
                        archive.mutate(
                          { conversationId: c.id, archive: true },
                          { onSuccess: () => toast.success("Percakapan diarsipkan") },
                        )
                      }
                      onMute={(c, until) =>
                        mute.mutate(
                          { conversationId: c.id, until },
                          {
                            onSuccess: () =>
                              toast.success(until ? "Notifikasi dibisukan" : "Bisukan dibatalkan"),
                          },
                        )
                      }
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
              onPin={(c) =>
                pin.mutate(
                  { conversationId: c.id, pin: !c.pinned_at },
                  { onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal") },
                )
              }
              onArchive={(c) =>
                archive.mutate(
                  { conversationId: c.id, archive: true },
                  { onSuccess: () => toast.success("Percakapan diarsipkan") },
                )
              }
              onMute={(c, until) =>
                mute.mutate(
                  { conversationId: c.id, until },
                  {
                    onSuccess: () =>
                      toast.success(until ? "Notifikasi dibisukan" : "Bisukan dibatalkan"),
                  },
                )
              }
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
              onPin={(c) =>
                pin.mutate(
                  { conversationId: c.id, pin: !c.pinned_at },
                  { onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal") },
                )
              }
              onArchive={(c) =>
                archive.mutate(
                  { conversationId: c.id, archive: true },
                  { onSuccess: () => toast.success("Percakapan diarsipkan") },
                )
              }
              onMute={(c, until) =>
                mute.mutate(
                  { conversationId: c.id, until },
                  {
                    onSuccess: () =>
                      toast.success(until ? "Notifikasi dibisukan" : "Bisukan dibatalkan"),
                  },
                )
              }
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
              onArchive={(c) =>
                archive.mutate(
                  { conversationId: c.id, archive: false },
                  { onSuccess: () => toast.success("Dipulihkan ke Aktif") },
                )
              }
              onMute={() => undefined}
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
  selecting: boolean;
  selectedIds: Set<string>;
  onLongPressStart: (id: string) => void;
  onRowTap: (id: string) => void;
}) {
  if (isLoading) {
    return (
      <div className="rounded-lg border">
        <div className="flex items-center justify-center p-8 text-ms-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Memuat…
        </div>
      </div>
    );
  }
  if (list.length === 0) {
    return <div className="rounded-lg border">{empty}</div>;
  }
  return (
    <div className="-mx-3 border-y border-[var(--wa-border)]">
      <ul className="divide-y divide-[var(--wa-border)]">
        {list.map((c) => {
          const mutedUntil = c.muted_until ? new Date(c.muted_until) : null;
          const isMuted = mutedUntil && mutedUntil.getTime() > Date.now();
          const isSelected = selectedIds.has(c.id);
          return (
            <li
              key={c.id}
              className={`relative ${isSelected ? "bg-primary/10" : ""}`}
            >
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
                    <span className="flex min-w-0 items-center gap-ms-1 truncate text-ms-base font-medium">
                      {c.pinned_at ? <Pin className="h-3 w-3 shrink-0 wa-muted" /> : null}
                      <span className="truncate">{c.display_title}</span>
                      {isMuted ? <BellOff className="h-3 w-3 shrink-0 wa-muted" /> : null}
                      {c.workflow_category === "archived" || c.workflow_archived_at ? (
                        <StatusBadge lifecycle="archived" className="shrink-0" />
                      ) : null}
                    </span>
                    <span className={`shrink-0 text-ms-2xs ${c.unread > 0 ? "text-[var(--wa-green)] font-medium" : "wa-muted"}`}>{timeShort(c.last_at)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-ms-2">
                    <span className="flex min-w-0 items-center gap-ms-1 truncate text-ms-sm wa-muted">
                      {c.last_body ? (
                        <>
                          {c.last_delivered ? (
                            c.last_read ? (
                              <CheckCheck className="h-3.5 w-3.5 shrink-0 wa-check" aria-label="Dibaca" />
                            ) : (
                              <CheckCheck className="h-3.5 w-3.5 shrink-0 wa-muted opacity-70" aria-label="Terkirim" />
                            )
                          ) : null}
                          <span className="truncate">{previewText(c.last_body) ?? ""}</span>
                        </>
                      ) : (
                        <em className="text-muted-foreground/70">Belum ada pesan</em>
                      )}
                    </span>
                    {c.unread > 0 ? (
                      <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full wa-badge px-1.5 text-ms-2xs font-semibold">
                        {c.unread > 99 ? "99+" : c.unread}
                      </span>
                    ) : null}
                  </div>
                </div>
              </ConvRow>
              {selecting ? null : (
              <div className="absolute right-1 top-1.5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Opsi">
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
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

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
    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[var(--wa-surface-2)] text-[var(--wa-text-muted)] text-ms-sm font-semibold uppercase">
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
    "flex items-center gap-ms-3 px-ms-4 py-ms-2.5 pr-12 hover:bg-[var(--wa-surface-2)] " +
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