import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, BellOff, Moon, Vibrate, MessageCircle, ClipboardList, PackagePlus, Settings2, BellRing } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

import {
  DEFAULT_PREFS,
  isInDndWindow,
  loadPrefs,
  savePrefs,
  type NotifKind,
  type NotifPrefs,
} from "@/lib/notif-prefs";

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

  useEffect(() => {
    setPrefs(loadPrefs());
    if (typeof Notification !== "undefined") setPermission(Notification.permission);
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const dndActive =
    prefs.dnd.enabled && isInDndWindow(now, prefs.dnd.start, prefs.dnd.end);
  const startError = !/^\d{2}:\d{2}$/.test(prefs.dnd.start);
  const endError = !/^\d{2}:\d{2}$/.test(prefs.dnd.end);

  function update(patch: Partial<NotifPrefs>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
  }
  function updateDnd(patch: Partial<NotifPrefs["dnd"]>) {
    const next = { ...prefs, dnd: { ...prefs.dnd, ...patch } };
    setPrefs(next);
    savePrefs(next);
  }
  function toggleKind(k: NotifKind, value: boolean) {
    update({ enabledKinds: { ...prefs.enabledKinds, [k]: value } });
  }

  async function requestPermission() {
    if (typeof Notification === "undefined") {
      toast.error("Browser tidak mendukung notifikasi");
      return;
    }
    try {
      const p = await Notification.requestPermission();
      setPermission(p);
      if (p === "granted") toast.success("Notifikasi diizinkan");
      else toast.warning("Notifikasi belum diizinkan");
    } catch (e) {
      toast.error("Gagal meminta izin notifikasi");
    }
  }

  function testNotification() {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") {
      toast.warning("Izinkan notifikasi terlebih dahulu");
      return;
    }
    try {
      navigator.serviceWorker?.getRegistration().then((reg) => {
        const opts: NotificationOptions = {
          body: dndActive
            ? "DND aktif: notifikasi akan disenyapkan sesuai pengaturan."
            : "Halo! Notifikasi MCM Storage siap dipakai.",
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: "notif-test",
          // @ts-expect-error vibrate didukung di mobile
          vibrate: prefs.vibrate && !dndActive ? [80, 40, 80] : [0],
          silent: dndActive,
        };
        if (reg) reg.showNotification("Uji Notifikasi", opts);
        else new Notification("Uji Notifikasi", opts);
      });
    } catch (e) {
      toast.error("Tidak bisa menampilkan notifikasi uji");
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
      </header>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Izin browser</CardTitle>
            <CardDescription>
              Status saat ini:{" "}
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
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-2">
            {permission !== "granted" && (
              <Button size="sm" onClick={requestPermission}>
                Izinkan
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={testNotification}>
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
              <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                Aktif sekarang
              </span>
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