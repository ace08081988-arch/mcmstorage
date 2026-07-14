import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
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
  isLockSuppressed,
} from "@/lib/app-lock";
import { AppLockScreen } from "@/components/AppLockScreen";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { AppHeader } from "@/components/AppHeader";
import { CallHost } from "@/components/chat/CallHost";
import { MobileBottomNav } from "@/components/MobileBottomNav";

function AuthLock() {
  const [uid, setUid] = useState<string | null>(null);
  const [locked, setLockedState] = useState(false);
  const [cfgVer, setCfgVer] = useState(0);
  // H23: keep an always-current uid in a ref so pagehide/beforeunload
  // never sees a stale (or null) captured value and never removes tokens
  // that don't belong to the currently signed-in user.
  const uidRef = useRef<string | null>(null);
  useEffect(() => { uidRef.current = uid; }, [uid]);
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
      // Grace period saat user membuka native picker (kamera/galeri/file).
      if (isLockSuppressed()) return;
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
      const currentUid = uidRef.current;
      if (!currentUid) return;
      if (!isAutoLockEnabled(currentUid)) return;
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
          <AppHeader />
          <div className="min-w-0 flex-1 pb-[calc(env(safe-area-inset-bottom)+64px)] md:pb-0">
            <Outlet />
          </div>
        </SidebarInset>
      </div>
      {uid && cfg && locked && <AppLockScreen uid={uid} cfg={cfg} />}
      <CallHost />
      <MobileBottomNav />
    </SidebarProvider>
  );
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    if (typeof window !== "undefined") {
      const hasAuthCallback =
        window.location.hash.includes("access_token=") ||
        window.location.hash.includes("error=") ||
        window.location.search.includes("code=");
      if (hasAuthCallback) {
        window.location.replace(`/auth-callback${window.location.search}${window.location.hash}`);
        return;
      }
    }
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
    let trusted = false;
    try {
      const res = await isDeviceTrusted({ data: { deviceHash: hash } });
      trusted = !!res?.trusted;
    } catch {
      trusted = false;
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