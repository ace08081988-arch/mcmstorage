import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  MessageCircle, Loader2, Link2, CheckCheck, Pin, Archive, BellOff,
  Search, MoreVertical, ArchiveRestore, BellRing, X, WifiOff, Check, Camera,
} from "lucide-react";

import {
  useConversations, useChatSearch, usePinConversation, useArchiveConversation,
  useMuteConversation, useChatHeartbeat,
} from "@/lib/chat";
import { NewDmDialog } from "@/components/chat/NewDmDialog";
import { NewGroupDialog } from "@/components/chat/NewGroupDialog";
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
  const [q, setQ] = useState("");
  const search = useChatSearch(q);
  const navigate = useNavigate();
  const pin = usePinConversation();
  const archive = useArchiveConversation();
  const mute = useMuteConversation();
  const [grupOpen, setGrupOpen] = useState(false);
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

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col wa-surface">
      <header className="wa-header sticky top-0 z-10 flex items-center justify-between gap-2 border-b px-4 py-3">
        <h1 className="text-2xl font-bold tracking-tight">WhatsApp</h1>
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
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="active">Aktif {active.length ? `(${active.length})` : ""}</TabsTrigger>
            <TabsTrigger value="archived">Arsip {archived.length ? `(${archived.length})` : ""}</TabsTrigger>
          </TabsList>
          <TabsContent value="active">
            <ConvList
              list={active}
              isLoading={isLoading}
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
}: {
  list: ConvItem[];
  isLoading: boolean;
  empty: React.ReactNode;
  archivedView?: boolean;
  onPin: (c: ConvItem) => void;
  onArchive: (c: ConvItem) => void;
  onMute: (c: ConvItem, until: Date | null) => void;
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
    <div className="rounded-lg border">
      <ul className="divide-y">
        {list.map((c) => {
          const mutedUntil = c.muted_until ? new Date(c.muted_until) : null;
          const isMuted = mutedUntil && mutedUntil.getTime() > Date.now();
          return (
            <li key={c.id} className="relative">
              <Link
                to="/chat/$conversationId"
                params={{ conversationId: c.id }}
                className="flex items-start gap-3 px-3 py-3 pr-12 hover:bg-accent/50"
              >
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <MessageCircle className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1 truncate text-sm font-medium">
                      {c.pinned_at ? <Pin className="h-3 w-3 shrink-0 text-primary" /> : null}
                      <span className="truncate">{c.display_title}</span>
                      {isMuted ? <BellOff className="h-3 w-3 shrink-0 text-muted-foreground" /> : null}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{timeShort(c.last_at)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
                      {c.last_body ? (
                        <>
                          {c.last_delivered ? (
                            c.last_read ? (
                              <CheckCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="Dibaca" />
                            ) : (
                              <CheckCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-label="Terkirim" />
                            )
                          ) : null}
                          <span className="truncate">{c.last_body}</span>
                        </>
                      ) : (
                        <em className="text-muted-foreground/70">Belum ada pesan</em>
                      )}
                    </span>
                    {c.unread > 0 ? (
                      <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                        {c.unread > 99 ? "99+" : c.unread}
                      </span>
                    ) : null}
                  </div>
                </div>
              </Link>
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
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function addMin(m: number) {
  return new Date(Date.now() + m * 60 * 1000);
}