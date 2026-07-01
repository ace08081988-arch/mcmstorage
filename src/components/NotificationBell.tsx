import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bell, BellOff, BellRing, MessageCircle, ClipboardCheck, Package, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  getRecentNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type FeedItem,
} from "@/lib/notif-feed.functions";

const REFRESH_MS = 30_000;

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.max(1, Math.floor(diff / 1000));
  if (s < 60) return `${s}d`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}j`;
  const d = Math.floor(h / 24);
  return `${d}h`;
}

function iconFor(kind: FeedItem["kind"]) {
  switch (kind) {
    case "chat":
      return MessageCircle;
    case "tugas":
      return ClipboardCheck;
    case "order":
      return Package;
    case "system":
    default:
      return ShieldAlert;
  }
}

export function NotificationBell() {
  const fetchFeed = useServerFn(getRecentNotifications);
  const markOne = useServerFn(markNotificationRead);
  const markAll = useServerFn(markAllNotificationsRead);

  const [items, setItems] = useState<FeedItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(
    () =>
      typeof window !== "undefined" && "Notification" in window
        ? Notification.permission
        : "unsupported",
  );
  const [requesting, setRequesting] = useState(false);

  const refreshPerm = () => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) {
      setPerm("unsupported");
      return;
    }
    setPerm(Notification.permission);
  };

  const askPermission = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "denied") return;
    setRequesting(true);
    try {
      const res = await Notification.requestPermission();
      setPerm(res);
    } catch {
      /* ignore */
    } finally {
      setRequesting(false);
    }
  };

  const unreadCount = useMemo(
    () => items.filter((i) => i.unread).length,
    [items],
  );

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetchFeed({ data: { pageSize: 20 } });
      setItems(res.items);
    } catch {
      /* keep last snapshot on transient failure */
    } finally {
      setLoading(false);
    }
  };

  // Initial + polling. Pause polling while tab hidden to save battery.
  useEffect(() => {
    let alive = true;
    let timer: number | null = null;
    const tick = async () => {
      if (!alive) return;
      if (document.visibilityState === "visible") await refresh();
      timer = window.setTimeout(tick, REFRESH_MS);
    };
    void tick();
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        refreshPerm();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onItemClick = async (it: FeedItem) => {
    setItems((prev) =>
      prev.map((x) => (x.id === it.id ? { ...x, unread: false } : x)),
    );
    try {
      await markOne({ data: { id: it.id } });
    } catch {
      /* optimistic; will resync on next refresh */
    }
    setOpen(false);
  };

  const onMarkAll = async () => {
    setItems((prev) => prev.map((x) => ({ ...x, unread: false })));
    try {
      await markAll({ data: {} });
    } catch {
      /* optimistic */
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8"
          aria-label={
            unreadCount > 0
              ? `Notifikasi (${unreadCount} belum dibaca)`
              : "Notifikasi"
          }
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 h-4 min-w-4 rounded-full px-1 text-[10px] leading-none"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[calc(100vw-1rem)] max-w-sm p-0"
      >
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="text-sm font-semibold">Notifikasi</div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={onMarkAll}
              >
                Tandai dibaca
              </Button>
            )}
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setOpen(false)}
            >
              <Link to="/notifikasi">Semua</Link>
            </Button>
          </div>
        </div>

        {perm !== "granted" && (
          <div className="flex items-start gap-2 border-b bg-muted/40 px-3 py-2 text-xs">
            {perm === "denied" ? (
              <BellOff className="mt-0.5 h-3.5 w-3.5 flex-none text-destructive" />
            ) : (
              <BellRing className="mt-0.5 h-3.5 w-3.5 flex-none text-primary" />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {perm === "unsupported"
                  ? "Notification API tidak tersedia"
                  : perm === "denied"
                    ? "Izin notifikasi diblokir"
                    : "Aktifkan banner notifikasi"}
              </div>
              <p className="leading-snug text-muted-foreground">
                {perm === "unsupported"
                  ? "Browser/WebView ini tidak mendukung banner sistem."
                  : perm === "denied"
                    ? "Browser tidak akan menampilkan prompt lagi. Reset dari site settings atau buka diagnostik."
                    : "Izinkan browser menampilkan banner walau aplikasi ditutup."}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {perm === "default" && (
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={askPermission}
                    disabled={requesting}
                  >
                    {requesting ? "Meminta…" : "Izinkan notifikasi"}
                  </Button>
                )}
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setOpen(false)}
                >
                  <Link to="/status-notifikasi">Diagnostik</Link>
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="max-h-[70vh] overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              {loading ? "Memuat…" : "Belum ada notifikasi."}
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((it) => {
                const Icon = iconFor(it.kind);
                const content = (
                  <div className="flex gap-2 px-3 py-2">
                    <div className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-muted">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-xs font-medium">
                          {it.title}
                        </div>
                        <div className="flex-none text-[11px] text-muted-foreground">
                          {timeAgo(it.createdAt)}
                        </div>
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
                        {it.body}
                      </div>
                    </div>
                    {it.unread && (
                      <span
                        aria-hidden
                        className="mt-1 h-2 w-2 flex-none rounded-full bg-primary"
                      />
                    )}
                  </div>
                );
                return (
                  <li key={it.id}>
                    {it.href ? (
                      <Link
                        to={it.href}
                        className="block hover:bg-muted/60"
                        onClick={() => onItemClick(it)}
                      >
                        {content}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="w-full text-left hover:bg-muted/60"
                        onClick={() => onItemClick(it)}
                      >
                        {content}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t px-3 py-2 text-[11px] text-muted-foreground">
          Fallback in-app — muncul walau banner sistem diblokir preview.
        </div>
      </PopoverContent>
    </Popover>
  );
}