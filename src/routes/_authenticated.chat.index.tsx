import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMemo, useRef, useState, useCallback } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/chat/")({
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
  const pin = usePinConversation();
  const archive = useArchiveConversation();
  const mute = useMuteConversation();
  const [grupOpen, setGrupOpen] = useState(false);
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
      title: `Hapus pesan di ${ids.length} percakapan?`,
      description:
        "Pesan akan dihapus hanya di perangkatmu. Percakapan tetap ada, kamu bisa mulai chat lagi kapan saja.",
      confirmText: "Hapus",
      cancelText: "Batal",
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    let failed = 0;
    for (const convId of ids) {
      try {
        const { data, error } = await supabase.rpc("message_delete_all_mine", { _conv: convId });
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
          className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b bg-primary px-3 py-3 text-primary-foreground shadow-sm"
          role="toolbar"
          aria-label="Mode pilih percakapan"
        >
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full text-primary-foreground hover:bg-white/15"
              onClick={exitSelect}
              aria-label="Batal pilih"
            >
              <X className="h-5 w-5" />
            </Button>
            <span className="text-base font-semibold">{selectedIds.size} dipilih</span>
          </div>
          <div className="flex items-center gap-1">
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
      <header className="wa-header sticky top-0 z-10 flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="grid h-8 w-8 place-items-center rounded-lg text-[13px] font-bold text-white shadow-sm"
            style={{ backgroundColor: "var(--mcm-brand)" }}
          >
            M
          </span>
          <h1 className="text-2xl font-bold tracking-tight">MCM</h1>
        </div>
        <div className="flex items-center gap-1">
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
                  { label: "Daftar", to: "/buku-alamat" },
                  { label: "Perangkat tertaut", to: "/sesi" },
                  { label: "Berbintang", action: () => toast.info("Berbintang — segera hadir.") },
                  { label: "Order", to: "/chat-audit" },
                ];
                const settings: Item = { label: "Pengaturan", to: "/profil-chat" };
                const renderItem = (it: Item, key: string) => {
                  const active = "to" in it && isPathActive(it.to);
                  const cls =
                    "flex items-center justify-between gap-2 " +
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

      <div className="flex-1 space-y-3 px-3 py-3">
      {isError && (conversations?.length ?? 0) > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Menampilkan data offline</p>
            <p className="opacity-80">
              Tidak bisa menyegarkan daftar chat: {error instanceof Error ? error.message : "jaringan bermasalah"}.
            </p>
          </div>
          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={isFetching} onClick={() => refetch()}>
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
        <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <span className="wa-chip wa-chip-active font-medium">Semua</span>
          <span className="wa-chip"><span className="inline-block h-2 w-2 rounded-full bg-[var(--wa-green)]" />Aktif {active.length ? active.length : ""}</span>
          <span className="wa-chip"><span className="inline-block h-2 w-2 rounded-full bg-rose-500" />Arsip {archived.length ? archived.length : ""}</span>
          <span className="wa-chip">Belum dibaca</span>
        </div>
      ) : null}

      {pendingRequests > 0 ? (
        <Link
          to={"/kontak/permintaan" as never}
          className="mt-2 flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm hover:bg-primary/10"
          aria-label="Buka permintaan pertemanan"
        >
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
            <UserPlus className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">
              {pendingRequests} permintaan pertemanan baru
            </div>
            <div className="truncate text-xs text-muted-foreground">
              Terima dulu supaya bisa chat & panggilan.
            </div>
          </div>
          <span className="inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
            {pendingRequests}
          </span>
        </Link>
      ) : null}

      {q.trim().length >= 2 ? (
        <div className="rounded-lg border">
          {search.isLoading ? (
            <div className="flex items-center justify-center p-6 text-xs text-muted-foreground">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Mencari…
            </div>
          ) : (search.data ?? []).length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
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
                      className="flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-accent/50"
                    >
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                        <Search className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{conv?.display_title ?? "Percakapan"}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">{timeShort(m.created_at)}</span>
                        </div>
                        <p className="line-clamp-2 text-xs text-muted-foreground">{highlight(m.body ?? "", q)}</p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <Tabs defaultValue="active">
          <TabsList className="grid w-full grid-cols-2 bg-transparent">
            <TabsTrigger value="active">Aktif {active.length ? `(${active.length})` : ""}</TabsTrigger>
            <TabsTrigger value="archived">Arsip {archived.length ? `(${archived.length})` : ""}</TabsTrigger>
          </TabsList>
          <TabsContent value="active">
            <ConvList
              list={active}
              isLoading={isLoading}
              selecting={selecting}
              selectedIds={selectedIds}
              onLongPressStart={toggleSelect}
              onRowTap={toggleSelect}
              empty={
                <div className="space-y-2 p-8 text-center">
                  <MessageCircle className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium">Belum ada percakapan</p>
                  <p className="text-xs text-muted-foreground">
                    Mulai chat dengan kontak yang akunnya sudah tertaut, atau buat grup baru.
                  </p>
                  <div className="pt-2">
                    <Button asChild size="sm" className="gap-1.5">
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
          <TabsContent value="archived">
            <ConvList
              list={archived}
              isLoading={isLoading}
              selecting={selecting}
              selectedIds={selectedIds}
              onLongPressStart={toggleSelect}
              onRowTap={toggleSelect}
              empty={
                <div className="p-8 text-center text-xs text-muted-foreground">
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
        <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
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
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1 truncate text-[15px] font-medium">
                      {c.pinned_at ? <Pin className="h-3 w-3 shrink-0 wa-muted" /> : null}
                      <span className="truncate">{c.display_title}</span>
                      {isMuted ? <BellOff className="h-3 w-3 shrink-0 wa-muted" /> : null}
                    </span>
                    <span className={`shrink-0 text-[11px] ${c.unread > 0 ? "text-[var(--wa-green)] font-medium" : "wa-muted"}`}>{timeShort(c.last_at)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1 truncate text-[13px] wa-muted">
                      {c.last_body ? (
                        <>
                          {c.last_delivered ? (
                            c.last_read ? (
                              <CheckCheck className="h-3.5 w-3.5 shrink-0 wa-check" aria-label="Dibaca" />
                            ) : (
                              <CheckCheck className="h-3.5 w-3.5 shrink-0 wa-muted opacity-70" aria-label="Terkirim" />
                            )
                          ) : null}
                          <span className="truncate">{c.last_body}</span>
                        </>
                      ) : (
                        <em className="text-muted-foreground/70">Belum ada pesan</em>
                      )}
                    </span>
                    {c.unread > 0 ? (
                      <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full wa-badge px-1.5 text-[11px] font-semibold">
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
    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[var(--wa-surface-2)] text-[var(--wa-text-muted)] text-sm font-semibold uppercase">
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
    "flex items-center gap-3 px-4 py-2.5 pr-12 hover:bg-[var(--wa-surface-2)] " +
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