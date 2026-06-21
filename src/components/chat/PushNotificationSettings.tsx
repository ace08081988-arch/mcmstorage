import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, BellOff, Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  isPushSupported,
  notificationPermission,
  hasActivePushSubscription,
  enablePushNotifications,
  disablePushNotifications,
  sendTestNotification,
} from "@/lib/push-client";

export function PushNotificationSettings() {
  const [supported, setSupported] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const [busy, setBusy] = useState<"enable" | "disable" | "test" | null>(null);

  useEffect(() => {
    setSupported(isPushSupported());
    setPerm(notificationPermission());
    hasActivePushSubscription().then(setSubscribed).catch(() => setSubscribed(false));
  }, []);

  const onEnable = async () => {
    setBusy("enable");
    try {
      const r = await enablePushNotifications();
      if (r.ok) {
        setSubscribed(true);
        setPerm("granted");
        toast.success("Notifikasi chat aktif di perangkat ini");
      } else if (r.reason === "denied") {
        toast.error("Izin notifikasi ditolak. Aktifkan dari pengaturan browser.");
      } else if (r.reason === "unsupported") {
        toast.error("Browser ini tidak mendukung Web Push");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengaktifkan notifikasi");
    } finally {
      setBusy(null);
    }
  };

  const onDisable = async () => {
    setBusy("disable");
    try {
      await disablePushNotifications();
      setSubscribed(false);
      toast.success("Notifikasi chat dimatikan pada perangkat ini");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mematikan notifikasi");
    } finally {
      setBusy(null);
    }
  };

  const onTest = async () => {
    setBusy("test");
    try {
      const r = await sendTestNotification();
      if (r.sent > 0) toast.success(r.message);
      else toast.warning(r.message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengirim uji notifikasi");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <Bell className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Notifikasi chat</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Terima notifikasi pesan baru di perangkat ini, bahkan saat aplikasi tertutup.
        Pengaturan berlaku per perangkat/browser.
      </p>

      {!supported ? (
        <p className="text-xs text-destructive">
          Browser ini tidak mendukung Web Push. Coba Chrome/Edge/Firefox/Safari versi terbaru.
        </p>
      ) : perm === "denied" ? (
        <p className="text-xs text-destructive">
          Izin notifikasi diblokir. Aktifkan kembali dari ikon gembok di address bar.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!subscribed ? (
          <Button onClick={onEnable} disabled={!supported || busy !== null || perm === "denied"} className="gap-2">
            {busy === "enable" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
            Aktifkan notifikasi
          </Button>
        ) : (
          <>
            <Button onClick={onTest} disabled={busy !== null} variant="default" className="gap-2">
              {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Kirim notifikasi uji
            </Button>
            <Button onClick={onDisable} disabled={busy !== null} variant="outline" className="gap-2">
              {busy === "disable" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellOff className="h-4 w-4" />}
              Matikan notifikasi
            </Button>
          </>
        )}
      </div>

      {subscribed ? (
        <p className="text-[11px] text-muted-foreground">
          Status: <span className="font-medium text-foreground">Aktif</span> di perangkat ini.
        </p>
      ) : null}
    </section>
  );
}