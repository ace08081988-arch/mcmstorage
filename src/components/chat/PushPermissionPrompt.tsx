import { useEffect, useState } from "react";
import { Bell, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  isPushSupported,
  notificationPermission,
  hasActivePushSubscription,
  enablePushNotifications,
} from "@/lib/push-client";

const DISMISS_KEY = "ace:push-prompt-dismissed-v1";

/**
 * Ajakan opt-in notifikasi. Muncul HANYA bila browser mendukung push,
 * izin masih "default" (belum pernah diminta), dan pengguna belum menutup
 * banner ini. Permintaan izin browser baru dipicu setelah pengguna
 * menekan "Aktifkan" — tidak pernah otomatis.
 */
export function PushPermissionPrompt() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!isPushSupported()) return;
      if (notificationPermission() !== "default") return;
      try {
        if (localStorage.getItem(DISMISS_KEY) === "1") return;
      } catch {
        /* ignore */
      }
      const subscribed = await hasActivePushSubscription().catch(() => false);
      if (alive && !subscribed) setVisible(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  const onEnable = async () => {
    setBusy(true);
    try {
      const r = await enablePushNotifications();
      if (r.ok) {
        toast.success("Notifikasi aktif di perangkat ini");
        setVisible(false);
      } else if (r.reason === "denied") {
        toast.error("Izin notifikasi ditolak. Aktifkan dari pengaturan browser.");
        setVisible(false);
      } else {
        toast.error("Browser ini tidak mendukung notifikasi push");
        setVisible(false);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengaktifkan notifikasi");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="region"
      aria-label="Aktifkan notifikasi"
      data-floating-ui="fab"
      className="fixed z-fab overflow-y-auto rounded-xl border bg-card p-ms-3 shadow-lg"
      style={{
        bottom:
          "calc(max(var(--app-bottom-nav-h, 0px), var(--app-bottom-bar-space, 0px), var(--app-safe-bottom, env(safe-area-inset-bottom, 0px))) + var(--app-keyboard-inset, 0px) + 12px)",
        left: "calc(var(--app-safe-left, env(safe-area-inset-left, 0px)) + 0.75rem)",
        right: "calc(var(--app-safe-right, env(safe-area-inset-right, 0px)) + 0.75rem)",
        maxHeight:
          "calc(var(--app-vh, 100dvh) - max(var(--app-bottom-nav-h, 0px), var(--app-bottom-bar-space, 0px), var(--app-safe-bottom, env(safe-area-inset-bottom, 0px))) - var(--app-keyboard-inset, 0px) - var(--app-safe-top, env(safe-area-inset-top, 0px)) - 24px)",
      }}
    >
      <div className="flex items-start gap-ms-3">
        <Bell className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-ms-sm font-semibold">Aktifkan notifikasi?</p>
          <p className="mt-1 text-ms-xs text-muted-foreground">
            Dapatkan pemberitahuan pesan baru walau aplikasi tertutup. Izin hanya
            diminta setelah Anda menyetujui, dan bisa dimatikan kapan saja di Profil.
          </p>
          <div className="mt-ms-3 flex flex-wrap gap-ms-2">
            <Button size="sm" onClick={onEnable} disabled={busy} className="gap-ms-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
              Aktifkan notifikasi
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss} disabled={busy}>
              Nanti saja
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Tutup ajakan notifikasi"
          className="rounded-md p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
