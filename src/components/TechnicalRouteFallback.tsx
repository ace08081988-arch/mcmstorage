/**
 * Halaman fallback untuk rute teknis (diagnostik, debug, alat internal).
 *
 * Rute teknis sengaja disembunyikan dari navigasi. Bila seseorang membukanya
 * lewat URL langsung, halaman ini yang tampil: pesan singkat + tombol kembali.
 * Untuk keperluan debugging, halaman tetap bisa dibuka dengan menambahkan
 * `?teknis=1` pada URL, atau menekan tombol "Buka halaman teknis" di bawah
 * (pilihan bertahan selama sesi berlangsung).
 */
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ShieldAlert, ArrowLeft, Home, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isHiddenMenuUrl } from "@/lib/hidden-menu-routes";

const SESSION_KEY = "ace:technical-route-unlocked";

function isUnlocked(): boolean {
  if (typeof window === "undefined") return true;
  try {
    if (new URLSearchParams(window.location.search).get("teknis") === "1") return true;
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function TechnicalRouteNotice({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  const [, force] = useState(0);
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-lg flex-col items-center justify-center gap-4 px-4 py-10 text-center">
      <div className="depth-3d flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <ShieldAlert className="size-7" aria-hidden="true" />
      </div>
      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold tracking-tight">Halaman internal</h1>
        <p className="text-sm text-muted-foreground">
          Alamat <span className="font-mono text-xs">{pathname}</span> adalah alat internal
          (diagnostik &amp; pemeliharaan) dan tidak dipakai dalam penggunaan sehari-hari.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
        <Button
          variant="default"
          className="depth-tap"
          onClick={() => {
            if (typeof window !== "undefined" && window.history.length > 1) window.history.back();
            else void navigate({ to: "/" });
          }}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Kembali
        </Button>
        <Button variant="outline" className="depth-tap" onClick={() => void navigate({ to: "/" })}>
          <Home className="size-4" aria-hidden="true" />
          Beranda
        </Button>
      </div>
      <button
        type="button"
        className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:underline"
        onClick={() => {
          try {
            sessionStorage.setItem(SESSION_KEY, "1");
          } catch { /* ignore */ }
          force((v) => v + 1);
        }}
      >
        <Wrench className="size-3.5" aria-hidden="true" />
        Buka halaman teknis
      </button>
    </div>
  );
}

/** Bungkus konten rute teknis; tampilkan fallback bila belum dibuka sengaja. */
export function TechnicalRouteGate({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [unlocked, setUnlocked] = useState(true);
  useEffect(() => {
    setUnlocked(isUnlocked());
  }, [pathname]);
  const hidden = isHiddenMenuUrl(pathname);
  if (hidden && !unlocked) {
    return (
      <TechnicalRouteNoticeWrapper
        pathname={pathname}
        onUnlock={() => setUnlocked(true)}
      />
    );
  }
  return <>{children}</>;
}

function TechnicalRouteNoticeWrapper({
  pathname,
  onUnlock,
}: {
  pathname: string;
  onUnlock: () => void;
}) {
  useEffect(() => {
    const onStorage = () => {
      if (isUnlocked()) onUnlock();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [onUnlock]);
  return (
    <div onClickCapture={() => { if (isUnlocked()) onUnlock(); }}>
      <TechnicalRouteNotice pathname={pathname} />
    </div>
  );
}
