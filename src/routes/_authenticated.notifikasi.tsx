import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Bell, BellOff, Moon, Vibrate, MessageCircle, ClipboardList, PackagePlus, Settings2, BellRing, RefreshCw, Inbox } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";

import {
  DEFAULT_PREFS,
  isInDndWindow,
  loadPrefs,
  savePrefs,
  pullPrefsFromCloud,
  subscribeRemotePrefs,
  getLastSyncedAt,
  type NotifKind,
  type NotifPrefs,
} from "@/lib/notif-prefs";
import {
  enablePushNotifications,
  disablePushNotifications,
  hasActivePushSubscription,
  isPushSupported,
  sendTestNotification,
} from "@/lib/push-client";
import { getRecentNotifications, type FeedItem } from "@/lib/notif-feed.functions";

export const Route = createFileRoute("/_authenticated/notifikasi")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Pengaturan Notifikasi · MCM Storage" },
      {
        name: "description",
        content:
          "Pilih jenis notifikasi yang muncul, aktifkan getaran, dan atur jam jangan ganggu.",
      },
    ],
  }),
  component: NotifikasiPage,
});

type KindMeta = { key: NotifKind; label: string; desc: string; Icon: typeof MessageCircle };
const KINDS: KindMeta[] = [
  { key: "chat", label: "Pesan Chat", desc: "Pesan baru dari rekan dan pelanggan", Icon: MessageCircle },
  { key: "tugas", label: "Tugas Pegawai", desc: "Kiriman foto & PIN dari pegawai", Icon: ClipboardList },
  { key: "order", label: "Permintaan Pesanan", desc: "Order request baru / update", Icon: PackagePlus },
  { key: "system", label: "Sistem & Keamanan", desc: "OTP, peringatan, dan pembaruan", Icon: Settings2 },
];

function NotifikasiPage() {
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_PREFS);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [now, setNow] = useState(() => new Date());
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPrefs(loadPrefs());
    if (typeof Notification !== "undefined") setPermission(Notification.permission);
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    setSyncing(true);
    pullPrefsFromCloud()
      .then((p) => { setPrefs(p); setSyncedAt(getLastSyncedAt()); })
      .finally(() => setSyncing(false));
    void hasActivePushSubscription().then(setSubscribed).catch(() => setSubscribed(false));
    const unsub = subscribeRemotePrefs((p) => {
      setPrefs(p);
      setSyncedAt(getLastSyncedAt());
      toast.info("Preferensi notifikasi disinkronkan dari perangkat lain");
    });
    return () => { window.clearInterval(t); unsub(); };
  }, []);

  const dndActive =
    prefs.dnd.enabled && isInDndWindow(now, prefs.dnd.start, prefs.dnd.end);
  const startError = !/^\d{2}:\d{2}$/.test(prefs.dnd.start);
  const endError = !/^\d{2}:\d{2}$/.test(prefs.dnd.end);

  function update(patch: Partial<NotifPrefs>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
    setSyncedAt(new Date().toISOString());
  }
  function updateDnd(patch: Partial<NotifPrefs["dnd"]>) {
    const next = { ...prefs, dnd: { ...prefs.dnd, ...patch } };
    setPrefs(next);
    savePrefs(next);
    setSyncedAt(new Date().toISOString());
  }
  function toggleKind(k: NotifKind, value: boolean) {
    update({ enabledKinds: { ...prefs.enabledKinds, [k]: value } });
  }

  async function requestPermission() {
    if (!isPushSupported()) {
      toast.error("Browser/perangkat ini tidak mendukung notifikasi push");
      return;
    }
    setBusy(true);
    try {
      const r = await enablePushNotifications();
      setPermission(typeof Notification !== "undefined" ? Notification.permission : "default");
      if (r.ok) {
        setSubscribed(true);
        toast.success("Notifikasi aktif di perangkat ini");
      } else if (r.reason === "denied") {
        toast.warning("Notifikasi diblokir di pengaturan browser/HP");
      } else if (r.reason === "unsupported") {
        toast.error("Perangkat ini tidak mendukung push");
      } else {
        toast.error("Gagal mengaktifkan notifikasi");
      }
    } catch (e) {
      toast.error("Gagal mendaftarkan langganan push: " + ((e as Error)?.message ?? "unknown"));
    } finally {
      setBusy(false);
    }
  }

  async function testNotification() {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") {
      toast.warning("Izinkan notifikasi terlebih dahulu");
      return;
    }
    setBusy(true);
    try {
      // Selalu coba kirim via server (round-trip push asli). Jika belum berlangganan, daftarkan dulu.
      const isSub = await hasActivePushSubscription();
      if (!isSub) {
        const r = await enablePushNotifications();
        if (!r.ok) throw new Error(r.reason ?? "subscribe_failed");
        setSubscribed(true);
      }
      const res = await sendTestNotification();
      if (res.sent > 0) toast.success(res.message);
      else toast.warning(res.message || "Gagal mengirim notifikasi uji");
    } catch (e) {
      // Fallback lokal supaya user paham izin OK tapi pipeline server gagal
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        await reg?.showNotification("Uji Notifikasi (lokal)", {
          body: "Push server gagal — ini hanya notifikasi lokal. Periksa langganan & koneksi.",
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: "notif-test",
        });
      } catch (_) {}
      toast.error("Push server gagal: " + ((e as Error)?.message ?? "unknown"));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      await disablePushNotifications();
      setSubscribed(false);
      toast.success("Langganan push dinonaktifkan di perangkat ini");
    } finally {
      setBusy(false);
    }
  }

  function resetAll() {
    setPrefs(DEFAULT_PREFS);
    savePrefs(DEFAULT_PREFS);
    toast.success("Pengaturan dikembalikan ke default");
  }

  return (
    <div className="container max-w-3xl space-y-6 px-4 py-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <BellRing className="size-6 text-primary" /> Pengaturan Notifikasi
        </h1>
        <p className="text-sm text-muted-foreground">
          Pilih jenis notifikasi yang ingin Anda terima, atur getaran, dan jadwalkan jangan ganggu.
        </p>
        <p className="text-xs text-muted-foreground">
          {syncing
            ? "Menyinkronkan preferensi…"
            : syncedAt
              ? `Disinkronkan ke akun · ${new Date(syncedAt).toLocaleString("id-ID")}`
              : "Preferensi akan otomatis disinkronkan ke perangkat lain saat Anda login."}
        </p>
      </header>

      <RecentNotificationsCard enabledKinds={prefs.enabledKinds} />

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Izin & langganan</CardTitle>
            <CardDescription className="space-y-0.5">
              <div>
                Izin:{" "}
                <span
                  className={
                    permission === "granted"
                      ? "font-medium text-emerald-600"
                      : permission === "denied"
                        ? "font-medium text-destructive"
                        : "font-medium text-amber-600"
                  }
                >
                  {permission === "granted" ? "Diizinkan" : permission === "denied" ? "Diblokir" : "Belum diatur"}
                </span>
              </div>
              <div>
                Langganan push:{" "}
                <span
                  className={
                    subscribed === true
                      ? "font-medium text-emerald-600"
                      : subscribed === false
                        ? "font-medium text-amber-600"
                        : "font-medium text-muted-foreground"
                  }
                >
                  {subscribed === true ? "Aktif" : subscribed === false ? "Belum aktif" : "Memeriksa…"}
                </span>
              </div>
              {permission === "denied" && (
                <div className="text-[11px] text-destructive">
                  Buka Pengaturan situs/aplikasi di HP, izinkan Notifikasi untuk MCM Storage, lalu kembali.
                </div>
              )}
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-2">
            {subscribed !== true ? (
              <Button size="sm" onClick={requestPermission} disabled={busy}>
                Aktifkan
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={turnOff} disabled={busy}>
                Matikan
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={testNotification} disabled={busy}>
              Uji
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Jenis Notifikasi</CardTitle>
          <CardDescription>Pilih kategori mana saja yang boleh muncul.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {KINDS.map(({ key, label, desc, Icon }, idx) => (
            <div key={key}>
              {idx > 0 && <Separator className="my-2" />}
              <label
                htmlFor={`kind-${key}`}
                className="flex cursor-pointer items-center justify-between gap-3 py-1"
              >
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-md bg-muted text-foreground">
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-xs text-muted-foreground">{desc}</div>
                  </div>
                </div>
                <Switch
                  id={`kind-${key}`}
                  checked={prefs.enabledKinds[key]}
                  onCheckedChange={(v) => toggleKind(key, v)}
                />
              </label>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Getaran</CardTitle>
          <CardDescription>Hanya berfungsi di perangkat yang mendukung getaran.</CardDescription>
        </CardHeader>
        <CardContent>
          <label htmlFor="vibrate" className="flex cursor-pointer items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-md bg-muted">
                <Vibrate className="size-4" />
              </span>
              <div>
                <div className="text-sm font-medium">Aktifkan getaran</div>
                <div className="text-xs text-muted-foreground">Getaran singkat saat notifikasi datang.</div>
              </div>
            </div>
            <Switch
              id="vibrate"
              checked={prefs.vibrate}
              onCheckedChange={(v) => update({ vibrate: v })}
            />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Moon className="size-4" /> Jangan Ganggu
            {dndActive && (
              <StatusBadge size="xs" variant="menunggu" className="ml-1">
                Aktif sekarang
              </StatusBadge>
            )}
          </CardTitle>
          <CardDescription>
            Selama jam DND notifikasi akan disenyapkan. Anda tetap melihatnya di daftar saat aplikasi dibuka.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label htmlFor="dnd" className="flex cursor-pointer items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-md bg-muted">
                {prefs.dnd.enabled ? <BellOff className="size-4" /> : <Bell className="size-4" />}
              </span>
              <div>
                <div className="text-sm font-medium">Aktifkan jangan ganggu</div>
                <div className="text-xs text-muted-foreground">
                  Jadwal harian. Lintas tengah malam didukung (mis. 22:00–06:00).
                </div>
              </div>
            </div>
            <Switch
              id="dnd"
              checked={prefs.dnd.enabled}
              onCheckedChange={(v) => updateDnd({ enabled: v })}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="dnd-start">Mulai</Label>
              <Input
                id="dnd-start"
                type="time"
                value={prefs.dnd.start}
                disabled={!prefs.dnd.enabled}
                onChange={(e) => updateDnd({ start: e.target.value })}
                aria-invalid={startError}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dnd-end">Selesai</Label>
              <Input
                id="dnd-end"
                type="time"
                value={prefs.dnd.end}
                disabled={!prefs.dnd.enabled}
                onChange={(e) => updateDnd({ end: e.target.value })}
                aria-invalid={endError}
              />
            </div>
          </div>

          <label
            htmlFor="dnd-urgent"
            className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border/60 p-3"
          >
            <div>
              <div className="text-sm font-medium">Izinkan notifikasi penting</div>
              <div className="text-xs text-muted-foreground">
                OTP & peringatan keamanan tetap berbunyi meski DND aktif.
              </div>
            </div>
            <Switch
              id="dnd-urgent"
              checked={prefs.dnd.allowUrgent}
              disabled={!prefs.dnd.enabled}
              onCheckedChange={(v) => updateDnd({ allowUrgent: v })}
            />
          </label>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="ghost" onClick={resetAll}>
          Reset ke default
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────── Daftar notifikasi nyata ─────────────────── */

const KIND_META: Record<FeedItem["kind"], { label: string; Icon: typeof MessageCircle; tone: string }> = {
  chat: { label: "Chat", Icon: MessageCircle, tone: "bg-blue-500/10 text-blue-600" },
  tugas: { label: "Tugas", Icon: ClipboardList, tone: "bg-emerald-500/10 text-emerald-600" },
  order: { label: "Pesanan", Icon: PackagePlus, tone: "bg-amber-500/10 text-amber-700" },
  system: { label: "Sistem", Icon: Settings2, tone: "bg-destructive/10 text-destructive" },
};

function formatRelative(iso: string, now = new Date()) {
  const diff = (now.getTime() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "baru saja";
  if (diff < 3600) return `${Math.floor(diff / 60)} mnt lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} hari lalu`;
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

function RecentNotificationsCard({
  enabledKinds,
}: {
  enabledKinds: NotifPrefs["enabledKinds"];
}) {
  const fetchFeed = useServerFn(getRecentNotifications);
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["notif-feed"],
    queryFn: () => fetchFeed(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const items = useMemo(
    () => (data?.items ?? []).filter((it) => enabledKinds[it.kind]),
    [data, enabledKinds],
  );
  const unreadCount = items.filter((i) => i.unread).length;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Inbox className="size-4 text-primary" />
            Notifikasi terkini
            {unreadCount > 0 && (
              <StatusBadge size="xs" variant="info" className="ml-1">
                {unreadCount} belum dibaca
              </StatusBadge>
            )}
          </CardTitle>
          <CardDescription>
            Diambil langsung dari chat, tugas pegawai, pesanan, dan peringatan sistem milik akun ini.
          </CardDescription>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refetch()}
          disabled={isFetching}
          title="Muat ulang"
        >
          <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-1">
        {isLoading ? (
          <>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </>
        ) : error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            Gagal memuat: {(error as Error).message}
          </div>
        ) : items.length === 0 ? (
          <div className="grid place-items-center gap-1 py-6 text-center text-xs text-muted-foreground">
            <Inbox className="size-6 opacity-50" />
            <div>Belum ada notifikasi baru untuk kategori yang aktif.</div>
          </div>
        ) : (
          items.map((it, idx) => {
            const meta = KIND_META[it.kind];
            const Icon = meta.Icon;
            const row = (
              <div className="flex items-start gap-3 py-2">
                <span className={`grid size-9 shrink-0 place-items-center rounded-md ${meta.tone}`}>
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="truncate text-sm font-medium" title={it.title}>
                      {it.title}
                    </div>
                    {it.unread && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />}
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">
                      {formatRelative(it.createdAt)}
                    </span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground" title={it.body}>
                    {it.body}
                  </div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                    {meta.label}
                  </div>
                </div>
              </div>
            );
            return (
              <div key={it.id}>
                {idx > 0 && <Separator />}
                {it.href ? (
                  <Link to={it.href} className="block rounded-md px-1 hover:bg-muted/50">
                    {row}
                  </Link>
                ) : (
                  <div className="px-1">{row}</div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}