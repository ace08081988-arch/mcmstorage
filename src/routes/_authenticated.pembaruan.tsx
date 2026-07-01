import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
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
  Heart,
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
import {
  getLikeCounts,
  listActiveStatuses,
  statusSignedUrl,
  type StatusRow,
} from "@/lib/status";
import { supabase } from "@/integrations/supabase/client";

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

/**
 * Fallback jalur per jenis pembaruan bila feed item tidak menyertakan
 * `href`. Tanpa ini, baris "Pesan baru" / "Pegawai mengirim penyiapan"
 * hanya tampil sebagai teks — tidak bisa dibuka. Dengan fallback,
 * seluruh baris selalu punya rute default sesuai jenisnya.
 */
const KIND_DEFAULT_HREF: Record<FeedItemKind, string> = {
  chat: "/chat",
  tugas: "/tugas",
  order: "/pesanan",
  system: "/notifikasi",
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

  // ==== Real statuses ====
  const { data: statuses = [] } = useQuery<StatusRow[]>({
    queryKey: ["statuses", "active"],
    queryFn: () => listActiveStatuses(),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null));
  }, []);

  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    (async () => {
      const entries: [string, string][] = [];
      for (const s of statuses) {
        if (s.media_type === "text" || !s.media_path) continue;
        const u = await statusSignedUrl(s.media_path, 60 * 30);
        if (u) entries.push([s.id, u]);
      }
      if (alive) setThumbUrls(Object.fromEntries(entries));
    })();
    return () => {
      alive = false;
    };
  }, [statuses]);

  const { data: likeCounts } = useQuery<Map<string, number>>({
    queryKey: ["status-likes", statuses.map((s) => s.id).join(",")],
    queryFn: () => getLikeCounts(statuses.map((s) => s.id)),
    enabled: statuses.length > 0,
    staleTime: 30_000,
  });

  const myStatuses = useMemo(
    () => (uid ? statuses.filter((s) => s.user_id === uid) : []),
    [statuses, uid],
  );
  const otherStatuses = useMemo(
    () => (uid ? statuses.filter((s) => s.user_id !== uid) : statuses),
    [statuses, uid],
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
          href: it.href ?? KIND_DEFAULT_HREF[it.kind],
        });
      } else {
        if (new Date(it.createdAt) > new Date(existing.time)) {
          existing.time = it.createdAt;
          existing.snippet = it.body;
          existing.href = it.href ?? existing.href ?? KIND_DEFAULT_HREF[it.kind];
        }
        if (it.unread) existing.unread += 1;
      }
    }
    return [...map.values()].sort(
      (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime(),
    );
  }, [feedItems]);

  // Handler pointerdown terpadu — jalankan haptic sebelum click event sehingga
  // getarannya terasa saat jari menyentuh, bukan saat melepas.
  const onPressStart = (intensity: HapticIntensity = "light") =>
    () => haptic(intensity);

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col bg-background pb-24">
      {/*
       * Skip-to-content: tersembunyi secara visual, muncul saat menerima
       * fokus keyboard (Tab pertama). Melompatkan fokus ke <main> di bawah
       * header supaya pengguna keyboard tidak harus melewati ikon header
       * setiap kali membuka halaman.
       */}
      <a
        href="#pembaruan-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Lompat ke konten
      </a>
      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center gap-2 bg-background/95 px-4 pb-2 pt-4 backdrop-blur">
        <h1 id="pembaruan-title" className="mr-auto text-2xl font-semibold tracking-tight">
          Pembaruan
        </h1>
        <Link
          to="/status/baru"
          aria-label="Buat status baru"
          onPointerDown={onPressStart("light")}
          className={`grid size-9 place-items-center rounded-full text-foreground hover:bg-muted active:bg-muted/80 ${PRESS_ICON}`}
        >
          <Camera className="size-5" aria-hidden="true" focusable="false" />
        </Link>
        <Link
          to="/chat"
          aria-label="Cari percakapan"
          onPointerDown={onPressStart("light")}
          className={`grid size-9 place-items-center rounded-full text-foreground hover:bg-muted active:bg-muted/80 ${PRESS_ICON}`}
        >
          <Search className="size-5" aria-hidden="true" focusable="false" />
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Menu lainnya"
              aria-haspopup="menu"
              onPointerDown={onPressStart("light")}
              className={`grid size-9 place-items-center rounded-full text-foreground hover:bg-muted active:bg-muted/80 ${PRESS_ICON}`}
            >
              <MoreVertical className="size-5" aria-hidden="true" focusable="false" />
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

      <main id="pembaruan-main" tabIndex={-1} className="outline-none">
      {/* Status */}
      <section className="px-4" aria-labelledby="pembaruan-status-h">
        <h2 id="pembaruan-status-h" className="mb-2 text-lg font-semibold">
          Status
        </h2>
        <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* Tambah Status card */}
          <Link
            to="/status/baru"
            aria-label="Tambah status baru"
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
          </Link>

          {myStatuses.slice(0, 1).map((s) => (
            <StatusTile
              key={s.id}
              status={s}
              thumbUrl={thumbUrls[s.id]}
              likes={likeCounts?.get(s.id) ?? 0}
              label="Status saya"
              onPressStart={onPressStart}
            />
          ))}

          {otherStatuses.map((s) => (
            <StatusTile
              key={s.id}
              status={s}
              thumbUrl={thumbUrls[s.id]}
              likes={likeCounts?.get(s.id) ?? 0}
              onPressStart={onPressStart}
            />
          ))}

          {statuses.length === 0 && (
            <div className="flex h-40 w-40 shrink-0 snap-start flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 px-3 text-center">
              <span className="text-xs text-muted-foreground">
                Belum ada status. Ketuk "Tambah Status" untuk mulai.
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Saluran */}
      <section className="mt-2 px-4" aria-labelledby="pembaruan-saluran-h">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="pembaruan-saluran-h" className="text-lg font-semibold">
            Saluran
          </h2>
          <Link
            to="/notifikasi"
            aria-label="Jelajahi pengaturan saluran & notifikasi"
            onPointerDown={onPressStart("selection")}
            className={`rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/80 active:bg-muted/60 ${PRESS_CHIP}`}
          >
            Jelajahi
          </Link>
        </div>

        {channels.length === 0 ? (
          <div
            role="status"
            className="rounded-xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground"
          >
            Belum ada pembaruan. Pesan, tugas, dan pesanan baru akan tampil di sini.
          </div>
        ) : (
          <ul className="space-y-4" aria-label="Daftar saluran pembaruan">
            {channels.map((ch) => {
              const Icon = KIND_ICON[ch.kind];
              const kindLabel: Record<FeedItemKind, string> = {
                chat: "Pesan",
                tugas: "Tugas",
                order: "Pesanan",
                system: "Sistem",
              };
              const rowLabel = [
                kindLabel[ch.kind],
                ch.title,
                ch.snippet,
                ch.unread > 0 ? `${ch.unread} belum dibaca` : null,
                formatTimeShort(ch.time),
              ]
                .filter(Boolean)
                .join(", ");
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
                      <span
                        className="ml-auto shrink-0 text-xs tabular-nums text-emerald-500"
                        aria-hidden="true"
                      >
                        {formatTimeShort(ch.time)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                        {ch.snippet}
                      </span>
                      {ch.unread > 0 && (
                        <span
                          aria-hidden="true"
                          className="grid min-w-6 shrink-0 place-items-center rounded-full bg-emerald-500 px-1.5 py-0.5 text-[11px] font-semibold text-white"
                        >
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
                      aria-label={rowLabel}
                      onPointerDown={onPressStart("selection")}
                      className={`-mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/40 active:bg-muted/60 ${PRESS_ROW}`}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div
                      className="flex items-center gap-3 py-1"
                      aria-label={rowLabel}
                    >
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Temukan saluran untuk diikuti */}
      <section className="mt-6 px-4" aria-labelledby="pembaruan-temukan-h">
        <h2 id="pembaruan-temukan-h" className="mb-3 text-sm text-muted-foreground">
          Temukan saluran untuk diikuti
        </h2>
        <ul className="space-y-4" aria-label="Rekomendasi saluran untuk diikuti">
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
      </main>

      {/*
       * FAB stack — DOM order = visual atas-ke-bawah supaya keyboard tab
       * berpindah tanpa loncatan:
       *   1. Compose pencil (bottom-40, lebih atas di layar) → tab dulu.
       *   2. Camera primary (bottom-24, lebih bawah) → tab kedua.
       */}
      <button
        type="button"
        aria-label="Tulis status teks baru"
        onClick={() => (window.location.href = "/status/baru")}
        onPointerDown={onPressStart("light")}
        className={`fixed bottom-40 right-5 z-30 grid size-11 place-items-center rounded-full bg-muted text-foreground shadow-md hover:bg-muted/80 ${PRESS_FAB}`}
      >
        <Edit3 className="size-5" aria-hidden="true" focusable="false" />
      </button>
      <Link
        to="/status/baru"
        aria-label="Ambil foto atau video untuk status baru"
        onPointerDown={onPressStart("medium")}
        className={`fixed bottom-24 right-5 z-30 grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg hover:brightness-110 active:shadow-md ${PRESS_FAB}`}
      >
        <Camera className="size-6" aria-hidden="true" focusable="false" />
      </Link>

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

function StatusTile({
  status,
  thumbUrl,
  likes,
  label,
  onPressStart,
}: {
  status: StatusRow;
  thumbUrl?: string;
  likes: number;
  label?: string;
  onPressStart: (i?: HapticIntensity) => () => void;
}) {
  const caption = status.caption?.trim();
  return (
    <Link
      to="/status/$id"
      params={{ id: status.id }}
      aria-label={`Buka status${caption ? ` ${caption}` : ""}`}
      onPointerDown={onPressStart("selection")}
      className="relative flex h-40 w-28 shrink-0 snap-start overflow-hidden rounded-2xl bg-muted/40 ring-1 ring-inset ring-primary/50"
    >
      {status.media_type === "image" && thumbUrl && (
        <img src={thumbUrl} alt="" className="size-full object-cover" />
      )}
      {status.media_type === "video" && thumbUrl && (
        <video src={thumbUrl} muted playsInline className="size-full object-cover" />
      )}
      {status.media_type === "text" && (
        <div
          className="flex size-full items-center justify-center p-2 text-center text-xs font-semibold text-white"
          style={{ background: status.bg_color || "#0f172a" }}
        >
          <span className="line-clamp-4">{caption}</span>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-[11px] font-medium text-white">
        <span className="truncate">{label ?? "Status"}</span>
        <span className="flex items-center gap-0.5">
          <Heart className="size-3" />
          {likes}
        </span>
      </div>
    </Link>
  );
}