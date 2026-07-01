import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Camera,
  Search,
  MoreVertical,
  Plus,
  MessageCircle,
  ClipboardList,
  PackagePlus,
  Settings2,
  Compass,
  Edit3,
  Store,
} from "lucide-react";
import { ChatBottomNav } from "@/components/chat/ChatBottomNav";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOrgName } from "@/lib/org-name";
import { haptic, type HapticIntensity } from "@/lib/haptics";
import {
  getRecentNotifications,
  type FeedItem,
  type FeedItemKind,
} from "@/lib/notif-feed.functions";

/**
 * Landing tab "Pembaruan" bergaya WhatsApp: Status carousel + daftar Saluran
 * (dari feed notifikasi eksisting, dikelompokkan per judul) + rekomendasi
 * saluran. Pengaturan lengkap tetap tersedia via menu tiga-titik → /notifikasi.
 */

export const Route = createFileRoute("/_authenticated/pembaruan")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Pembaruan · MCM Storage" },
      {
        name: "description",
        content: "Status, saluran, dan rekomendasi pembaruan dari akun Anda.",
      },
    ],
  }),
  component: PembaruanPage,
});

type Channel = {
  key: string;
  kind: FeedItemKind;
  title: string;
  snippet: string;
  time: string;
  unread: number;
  href?: string;
};

const KIND_ICON: Record<FeedItemKind, React.ComponentType<{ className?: string }>> = {
  chat: MessageCircle,
  tugas: ClipboardList,
  order: PackagePlus,
  system: Settings2,
};

const KIND_TONE: Record<FeedItemKind, string> = {
  chat: "bg-emerald-500/15 text-emerald-500",
  tugas: "bg-sky-500/15 text-sky-400",
  order: "bg-amber-500/15 text-amber-400",
  system: "bg-violet-500/15 text-violet-400",
};

function formatTimeShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  }
  const dayMs = 24 * 60 * 60 * 1000;
  const diff = Math.floor((now.getTime() - d.getTime()) / dayMs);
  if (diff === 1) return "Kemarin";
  if (diff < 7) return d.toLocaleDateString("id-ID", { weekday: "short" });
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit" });
}

/**
 * Token reaksi sentuh terpadu:
 *  - durasi 150ms, easing ease-out (sinkron dengan micro-interactions lain).
 *  - properti yang dianimasikan dibatasi eksplisit agar tidak "wobble" saat
 *    kelas lain berubah.
 *  - varian scale disesuaikan dengan luas hit-area (ikon vs kartu besar).
 */
const PRESS_BASE =
  "transition-[transform,background-color,filter,box-shadow,opacity] duration-150 ease-out will-change-transform outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const PRESS_ICON = `${PRESS_BASE} active:scale-95`;
const PRESS_CHIP = `${PRESS_BASE} active:scale-95`;
const PRESS_CARD = `${PRESS_BASE} active:scale-[0.97]`;
const PRESS_ROW = `${PRESS_BASE} active:scale-[0.98]`;
const PRESS_FAB = `${PRESS_BASE} active:scale-95`;

function initials(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function PembaruanPage() {
  const { full: orgName, short: orgShort, logo, brand } = useOrgName();

  const fetchRecent = useServerFn(getRecentNotifications);
  const { data } = useInfiniteQuery({
    queryKey: ["notif-feed", "pembaruan"],
    queryFn: ({ pageParam }) =>
      fetchRecent({ data: { before: pageParam as string | undefined, pageSize: 30 } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const feedItems: FeedItem[] = useMemo(
    () => (data?.pages ?? []).flatMap((p) => p.items),
    [data],
  );

  // Grouping: setiap judul unik jadi satu "saluran".
  const channels: Channel[] = useMemo(() => {
    const map = new Map<string, Channel>();
    for (const it of feedItems) {
      const key = `${it.kind}::${it.title}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          key,
          kind: it.kind,
          title: it.title,
          snippet: it.body,
          time: it.createdAt,
          unread: it.unread ? 1 : 0,
          href: it.href,
        });
      } else {
        if (new Date(it.createdAt) > new Date(existing.time)) {
          existing.time = it.createdAt;
          existing.snippet = it.body;
          existing.href = it.href ?? existing.href;
        }
        if (it.unread) existing.unread += 1;
      }
    }
    return [...map.values()].sort(
      (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime(),
    );
  }, [feedItems]);

  const tellUnavailable = () =>
    toast.info("Status kontak belum tersedia — akan diaktifkan setelah fitur status siap.");

  // Handler pointerdown terpadu — jalankan haptic sebelum click event sehingga
  // getarannya terasa saat jari menyentuh, bukan saat melepas.
  const onPressStart = (intensity: HapticIntensity = "light") =>
    () => haptic(intensity);

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col bg-background pb-24">
      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center gap-2 bg-background/95 px-4 pb-2 pt-4 backdrop-blur">
        <h1 className="mr-auto text-2xl font-semibold tracking-tight">Pembaruan</h1>
        <button
          type="button"
          aria-label="Kamera"
          onClick={tellUnavailable}
          onPointerDown={onPressStart("light")}
          className={`grid size-9 place-items-center rounded-full text-foreground hover:bg-muted active:bg-muted/80 ${PRESS_ICON}`}
        >
          <Camera className="size-5" />
        </button>
        <Link
          to="/chat"
          aria-label="Cari"
          onPointerDown={onPressStart("light")}
          className={`grid size-9 place-items-center rounded-full text-foreground hover:bg-muted active:bg-muted/80 ${PRESS_ICON}`}
        >
          <Search className="size-5" />
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Menu"
              onPointerDown={onPressStart("light")}
              className={`grid size-9 place-items-center rounded-full text-foreground hover:bg-muted active:bg-muted/80 ${PRESS_ICON}`}
            >
              <MoreVertical className="size-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link to="/notifikasi">Pengaturan notifikasi</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/status-notifikasi">Status notifikasi</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* Status */}
      <section className="px-4">
        <h2 className="mb-2 text-lg font-semibold">Status</h2>
        <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* Tambah Status card */}
          <button
            type="button"
            onClick={tellUnavailable}
            onPointerDown={onPressStart("medium")}
            className={`relative flex h-40 w-28 shrink-0 snap-start flex-col justify-end rounded-2xl bg-muted/40 p-2 text-left ring-1 ring-inset ring-border/50 hover:bg-muted/60 active:bg-muted/70 ${PRESS_CARD}`}
          >
            <span
              className="absolute left-1/2 top-6 grid size-16 -translate-x-1/2 place-items-center overflow-hidden rounded-full bg-background text-lg font-semibold"
              style={{ color: brand || undefined }}
            >
              {logo ? (
                <img src={logo} alt="" className="size-full object-cover" />
              ) : (
                <span>{initials(orgShort || orgName)}</span>
              )}
              <span className="absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground ring-2 ring-background">
                <Plus className="size-3.5" />
              </span>
            </span>
            <span className="text-center text-xs font-medium">Tambah Status</span>
          </button>

          {/* Placeholder empty tile — jujur: tidak ada status kontak lain */}
          <div className="flex h-40 w-40 shrink-0 snap-start flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 px-3 text-center">
            <span className="text-xs text-muted-foreground">
              Belum ada status dari kontak. Status akan muncul di sini setelah fitur aktif.
            </span>
          </div>
        </div>
      </section>

      {/* Saluran */}
      <section className="mt-2 px-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Saluran</h2>
          <Link
            to="/notifikasi"
            onPointerDown={onPressStart("selection")}
            className={`rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/80 active:bg-muted/60 ${PRESS_CHIP}`}
          >
            Jelajahi
          </Link>
        </div>

        {channels.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            Belum ada pembaruan. Pesan, tugas, dan pesanan baru akan tampil di sini.
          </div>
        ) : (
          <ul className="space-y-4">
            {channels.map((ch) => {
              const Icon = KIND_ICON[ch.kind];
              const body = (
                <>
                  <span
                    className={`grid size-12 shrink-0 place-items-center rounded-full ${KIND_TONE[ch.kind]}`}
                    aria-hidden
                  >
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[15px] font-semibold">{ch.title}</span>
                      <span className="ml-auto shrink-0 text-xs tabular-nums text-emerald-500">
                        {formatTimeShort(ch.time)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                        {ch.snippet}
                      </span>
                      {ch.unread > 0 && (
                        <span className="grid min-w-6 shrink-0 place-items-center rounded-full bg-emerald-500 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                          {ch.unread > 99 ? "99+" : ch.unread}
                        </span>
                      )}
                    </div>
                  </div>
                </>
              );
              return (
                <li key={ch.key}>
                  {ch.href ? (
                    <Link
                      to={ch.href}
                      onPointerDown={onPressStart("selection")}
                      className={`-mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/40 active:bg-muted/60 ${PRESS_ROW}`}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 py-1">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Temukan saluran untuk diikuti */}
      <section className="mt-6 px-4">
        <h2 className="mb-3 text-sm text-muted-foreground">
          Temukan saluran untuk diikuti
        </h2>
        <ul className="space-y-4">
          <SuggestionRow
            to="/chat"
            Icon={MessageCircle}
            tone="bg-emerald-500/15 text-emerald-500"
            title="Chat pelanggan"
            subtitle="Ikuti percakapan aktif"
          />
          <SuggestionRow
            to="/tugas"
            Icon={ClipboardList}
            tone="bg-sky-500/15 text-sky-400"
            title="Tugas pegawai"
            subtitle="Foto & PIN dari pegawai"
          />
          <SuggestionRow
            to="/pesanan"
            Icon={Store}
            tone="bg-amber-500/15 text-amber-400"
            title="Pesanan"
            subtitle="Order request & update"
          />
        </ul>
      </section>

      {/* Camera FAB */}
      <button
        type="button"
        aria-label="Kamera"
        onClick={tellUnavailable}
        onPointerDown={onPressStart("medium")}
        className={`fixed bottom-24 right-5 z-30 grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg hover:brightness-110 active:shadow-md ${PRESS_FAB}`}
      >
        <Camera className="size-6" />
      </button>
      {/* Compose pencil (secondary FAB) */}
      <button
        type="button"
        aria-label="Tambah status teks"
        onClick={tellUnavailable}
        onPointerDown={onPressStart("light")}
        className={`fixed bottom-40 right-5 z-30 grid size-11 place-items-center rounded-full bg-muted text-foreground shadow-md hover:bg-muted/80 ${PRESS_FAB}`}
      >
        <Edit3 className="size-5" />
      </button>

      <ChatBottomNav />
    </div>
  );
}

function SuggestionRow({
  to,
  Icon,
  tone,
  title,
  subtitle,
}: {
  to: string;
  Icon: React.ComponentType<{ className?: string }>;
  tone: string;
  title: string;
  subtitle: string;
}) {
  return (
    <li>
      <Link
        to={to as never}
        className={`-mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/40 active:bg-muted/60 ${PRESS_ROW}`}
      >
        <span className={`grid size-12 shrink-0 place-items-center rounded-full ${tone}`}>
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{title}</div>
          <div className="truncate text-sm text-muted-foreground">{subtitle}</div>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-4 py-1.5 text-xs font-medium">
          Ikuti
        </span>
      </Link>
    </li>
  );
}

// Keep Compass import used for tree-shake safety in future edits.
void Compass;