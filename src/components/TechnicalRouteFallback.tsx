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
const LAST_SAFE_KEY = "ace:last-safe-path";

/** Simpan halaman non-teknis terakhir yang benar-benar dibuka pengguna. */
export function rememberSafeLocation(href: string) {
  try {
    sessionStorage.setItem(LAST_SAFE_KEY, href);
  } catch { /* ignore */ }
}

function readSafeLocation(): string | null {
  try {
    const v = sessionStorage.getItem(LAST_SAFE_KEY);
    if (!v || !v.startsWith("/")) return null;
    if (isHiddenMenuUrl(v.split("?")[0])) return null;
    return v;
  } catch {
    return null;
  }
}

function isUnlocked(): boolean {
  if (typeof window === "undefined") return true;
  try {
    if (new URLSearchParams(window.location.search).get("teknis") === "1") return true;
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function TechnicalRouteNotice({
  pathname,
  onUnlock,
}: {
  pathname: string;
  onUnlock?: () => void;
}) {
  const navigate = useNavigate();
  const [backTarget, setBackTarget] = useState<string | null>(null);
  useEffect(() => {
    setBackTarget(readSafeLocation());
  }, [pathname]);
  const goBack = () => {
    if (backTarget) {
      void navigate({ to: backTarget, replace: true });
      return;
    }
    void navigate({ to: "/", replace: true });
  };
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
        <Button variant="default" className="depth-tap" onClick={goBack}>
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
          onUnlock?.();
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
  const href = useRouterState({ select: (s) => s.location.href });
  const [unlocked, setUnlocked] = useState(true);
  useEffect(() => {
    setUnlocked(isUnlocked());
  }, [pathname]);
  const hidden = isHiddenMenuUrl(pathname);
  useEffect(() => {
    if (!hidden) rememberSafeLocation(href);
  }, [hidden, href]);
  if (hidden && !unlocked) {
    return <TechnicalRouteNotice pathname={pathname} onUnlock={() => setUnlocked(true)} />;
  }
  return <>{children}</>;
}
