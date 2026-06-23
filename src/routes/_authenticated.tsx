import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { autoLockKey, isAutoLockEnabled, AUTO_LOCK_EVENT } from "@/lib/auto-lock";
import {
  getClientDeviceFingerprint,
} from "@/lib/device-fingerprint";
import { isDeviceTrusted } from "@/lib/device.functions";
import {
  APP_LOCK_EVENT,
  APP_LOCK_REQUEST,
  getLockConfig,
  hydrateLockConfig,
  isLocked,
  setLocked,
} from "@/lib/app-lock";
import { AppLockScreen } from "@/components/AppLockScreen";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";

function AuthLock() {
  const [uid, setUid] = useState<string | null>(null);
  const [locked, setLockedState] = useState(false);
  const [cfgVer, setCfgVer] = useState(0);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null));
  }, []);
  // Hydrate persisted lock config from Capacitor Preferences into localStorage
  // so settings survive app kill on native devices.
  useEffect(() => {
    if (!uid) return;
    void hydrateLockConfig(uid);
  }, [uid]);
  // Track lock config + locked state
  useEffect(() => {
    if (!uid) return;
    const sync = () => {
      setLockedState(isLocked(uid));
      setCfgVer((v) => v + 1);
    };
    sync();
    window.addEventListener(APP_LOCK_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(APP_LOCK_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [uid]);
  // Lock triggers: manual request, visibility hidden, idle timer
  useEffect(() => {
    if (!uid) return;
    const cfg = getLockConfig(uid);
    const lockNow = () => {
      if (!getLockConfig(uid)) return;
      setLocked(uid, true);
    };
    const onReq = () => lockNow();
    const onVis = () => {
      const c = getLockConfig(uid);
      if (c?.lockOnHide && document.visibilityState === "hidden") lockNow();
    };
    window.addEventListener(APP_LOCK_REQUEST, onReq);
    document.addEventListener("visibilitychange", onVis);

    // Idle timer
    let idleTimer: number | null = null;
    const resetIdle = () => {
      const c = getLockConfig(uid);
      if (idleTimer) window.clearTimeout(idleTimer);
      if (!c || !c.idleMs) return;
      idleTimer = window.setTimeout(lockNow, c.idleMs);
    };
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, resetIdle, { passive: true }));
    resetIdle();

    return () => {
      window.removeEventListener(APP_LOCK_REQUEST, onReq);
      document.removeEventListener("visibilitychange", onVis);
      events.forEach((e) => window.removeEventListener(e, resetIdle));
      if (idleTimer) window.clearTimeout(idleTimer);
    };
  }, [uid, cfgVer]);
  useEffect(() => {
    if (!uid) return;
    const lock = () => {
      if (!isAutoLockEnabled(uid)) return;
      try {
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith("sb-") && k.endsWith("-auth-token")) {
            localStorage.removeItem(k);
          }
        }
      } catch {}
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === autoLockKey(uid)) {/* re-read on next event */}
    };
    window.addEventListener("pagehide", lock);
    window.addEventListener("beforeunload", lock);
    window.addEventListener("storage", onStorage);
    window.addEventListener(AUTO_LOCK_EVENT, () => {});
    return () => {
      window.removeEventListener("pagehide", lock);
      window.removeEventListener("beforeunload", lock);
      window.removeEventListener("storage", onStorage);
    };
  }, [uid]);
  const cfg = uid ? getLockConfig(uid) : null;
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <SidebarInset className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-10 items-center gap-2 border-b bg-background/95 px-2 backdrop-blur">
            <SidebarTrigger />
            <span className="text-xs text-muted-foreground">Menu</span>
          </header>
          <div className="min-w-0 flex-1">
            <Outlet />
          </div>
        </SidebarInset>
      </div>
      {uid && cfg && locked && <AppLockScreen uid={uid} cfg={cfg} />}
    </SidebarProvider>
  );
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({
        to: "/auth",
        search: { redirect: location.href },
      });
    }
    // Lewati pengecekan device pada halaman verifikasi itu sendiri
    if (location.pathname.startsWith("/device-verify")) return;
    const hash = await getClientDeviceFingerprint();
    const uid = data.session.user.id;
    const cacheKey = `mcm_device_trust_check_${uid}_${hash}`;
    // Cache hasil pengecekan selama 10 menit agar beforeLoad tidak memanggil
    // server fn pada setiap perubahan navigasi (hash, search params, dll).
    let trusted = false;
    let cached: { trusted: boolean; at: number } | null = null;
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (raw) cached = JSON.parse(raw);
    } catch {}
    if (cached && cached.trusted && Date.now() - cached.at < 10 * 60 * 1000) {
      trusted = true;
    } else {
      try {
        const res = await isDeviceTrusted({ data: { deviceHash: hash } });
        trusted = !!res?.trusted;
      } catch {
        trusted = false;
      }
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({ trusted, at: Date.now() }));
      } catch {}
    }
    if (!trusted) {
      throw redirect({
        to: "/device-verify",
        search: { redirect: location.href },
      });
    }
  },
  component: AuthLock,
});