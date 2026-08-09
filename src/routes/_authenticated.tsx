import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { autoLockKey, isAutoLockEnabled, AUTO_LOCK_EVENT } from "@/lib/auto-lock";
import {
  getClientDeviceFingerprint,
  isDeviceTrustedLocal,
  markDeviceTrustedLocal,
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
import { LiveNotificationHost } from "@/components/LiveNotificationHost";
import { ChatPresenceHost } from "@/components/chat/ChatPresenceHost";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { TechnicalRouteGate } from "@/components/TechnicalRouteFallback";
import { withPlainTimeout } from "@/lib/supabase-timeout";

function AuthLock() {
  const [uid, setUid] = useState<string | null>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Halaman percakapan chat tampil "immersive" (layar penuh, header
  // sendiri): tanpa AppHeader agar tidak ada header ganda, dan tanpa
  // padding bottom nav supaya dokumen tidak ikut men-scroll — inilah
  // penyebab header percakapan terlihat naik-turun saat menggulir.
  const immersive = /^\/chat\/[^/]+/.test(pathname);
  // Daftar percakapan (/chat) juga tampil layar penuh: AppHeader
  // disembunyikan supaya tidak ada header ganda ("Chat" + "Ace Chat")
  // yang memangkas tinggi layar. Bedanya dengan `immersive`: halaman ini
  // TETAP memakai scroll dokumen normal.
  const chatListFull = /^\/chat\/?$/.test(pathname);
  const [locked, setLockedState] = useState(false);
  const [cfgVer, setCfgVer] = useState(0);
  // H23: keep an always-current uid in a ref so pagehide/beforeunload
  // never sees a stale (or null) captured value and never removes tokens
  // that don't belong to the currently signed-in user.
  const uidRef = useRef<string | null>(null);
  useEffect(() => { uidRef.current = uid; }, [uid]);
  useEffect(() => {
    void import("@/lib/current-user").then(({ getCurrentUser }) => getCurrentUser()).then((u) => setUid(u?.id ?? null));
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
      if (!getLockConfig(currentUid)) return;
      if (isLockSuppressed()) return;
      setLocked(currentUid, true);
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
      <div
        className={
          immersive
            ? "flex h-app-vh-visible w-full overflow-hidden"
            : "flex min-h-app-vh w-full"
        }
      >
        <AppSidebar />
        <SidebarInset className="flex min-w-0 flex-1 flex-col">
          {immersive || chatListFull ? null : <AppHeader />}
          <div
            id="konten-utama"
            tabIndex={-1}
            className={
              immersive
                ? "min-h-0 min-w-0 flex-1 overflow-hidden"
                // Ruang bawah mengikuti tinggi bar nyata (`--app-bottom-nav-h`,
                // sudah termasuk safe-area) supaya konten terakhir tidak
                // tertutup bar — termasuk saat landscape.
                // `app-safe-x` menjaga konten tidak masuk ke area cutout
                // (notch) saat perangkat dipakai landscape.
                // `app-bottom-spacer` otomatis 0px saat tak ada bar bawah
                // (desktop/sidebar) dan mengikuti tinggi bar nyata saat ada,
                // termasuk ChatBottomNav yang tampil juga di layar lebar.
                : "app-safe-x app-content-scrim min-w-0 flex-1 scroll-mt-16 app-bottom-spacer focus:outline-none"
            }
          >
            <TechnicalRouteGate>
              <Outlet />
            </TechnicalRouteGate>
          </div>
        </SidebarInset>
      </div>
      {uid && cfg && locked && <AppLockScreen uid={uid} cfg={cfg} />}
      <CallHost />
      <LiveNotificationHost />
      <ChatPresenceHost />
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
    const { data } = await withPlainTimeout(
      supabase.auth.getSession(),
      "authenticated-session",
      3_000,
    );
    if (!data.session) {
      // Pengunjung yang belum masuk dan membuka halaman depan diarahkan ke
      // halaman produk publik (nilai jual + harga), bukan langsung ke form
      // login — supaya calon pembeli bisa menilai produk lebih dulu.
      if (location.pathname === "/") {
        throw redirect({ to: "/produk" });
      }
      throw redirect({
        to: "/auth",
        search: { redirect: location.href },
      });
    }
    // Lewati pengecekan device pada halaman verifikasi itu sendiri
    if (location.pathname.startsWith("/device-verify")) return;
    const hash = await getClientDeviceFingerprint();
    if (isDeviceTrustedLocal(data.session.user.id, hash)) return;
    let trusted = false;
    try {
      const res = await withPlainTimeout(
        isDeviceTrusted({ data: { deviceHash: hash } }),
        "device-trust-check",
        6_000,
      );
      trusted = !!res?.trusted;
      if (trusted) markDeviceTrustedLocal(data.session.user.id, hash);
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