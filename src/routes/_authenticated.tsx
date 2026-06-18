import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { autoLockKey, isAutoLockEnabled, AUTO_LOCK_EVENT } from "@/lib/auto-lock";
import {
  getClientDeviceFingerprint,
  isDeviceTrustedLocal,
} from "@/lib/device-fingerprint";
import {
  APP_LOCK_EVENT,
  APP_LOCK_REQUEST,
  getLockConfig,
  isLocked,
  setLocked,
} from "@/lib/app-lock";
import { AppLockScreen } from "@/components/AppLockScreen";

function AuthLock() {
  const [uid, setUid] = useState<string | null>(null);
  const [locked, setLockedState] = useState(false);
  const [cfgVer, setCfgVer] = useState(0);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null));
  }, []);
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
    <>
      <Outlet />
      {uid && cfg && locked && <AppLockScreen uid={uid} cfg={cfg} />}
    </>
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
    const userId = data.session.user.id;
    const hash = await getClientDeviceFingerprint();
    if (!isDeviceTrustedLocal(userId, hash)) {
      throw redirect({
        to: "/device-verify",
        search: { redirect: location.href },
      });
    }
  },
  component: AuthLock,
});