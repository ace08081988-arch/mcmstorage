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
import { isHiddenMenuUrl, isTechnicalRouteUrl } from "@/lib/hidden-menu-routes";

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
    // Browser otomatis (Playwright/E2E) tidak bisa menekan tombol gerbang;
    // harness `/lovable/visual/*` harus langsung ter-render agar CI valid.
    if (navigator.webdriver === true) return true;
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
      void navigate({ to: backTarget as never, replace: true });
      return;
    }
    void navigate({ to: "/", replace: true });
  };
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-ms-4 py-ms-6 sm:px-ms-6">
      <section className="depth-3d w-full rounded-2xl border bg-card px-ms-5 py-ms-6 text-center shadow-sm">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <ShieldAlert className="size-6" aria-hidden="true" />
        </div>

        <h1 className="mt-ms-4 text-ms-lg font-semibold tracking-tight text-foreground">
          Halaman internal
        </h1>
        <p className="mt-ms-2 text-ms-sm leading-relaxed text-muted-foreground">
          Halaman ini adalah alat internal untuk diagnostik dan pemeliharaan, bukan
          bagian dari penggunaan sehari-hari.
        </p>
        <p className="mt-ms-3 inline-block max-w-full truncate rounded-md border bg-muted/60 px-ms-2 py-1 font-mono text-ms-2xs text-muted-foreground">
          {pathname}
        </p>

        <div className="mt-ms-5 flex flex-col gap-ms-2 sm:flex-row sm:justify-center">
          <Button variant="default" className="depth-tap w-full sm:w-auto" onClick={goBack}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            Kembali
          </Button>
          <Button
            variant="outline"
            className="depth-tap w-full sm:w-auto"
            onClick={() => void navigate({ to: "/" })}
          >
            <Home className="size-4" aria-hidden="true" />
            Beranda
          </Button>
        </div>

        <div className="mt-ms-5 border-t pt-ms-4">
          <button
            type="button"
            className="inline-flex items-center gap-ms-1 text-ms-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
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
      </section>
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
  const hidden = isTechnicalRouteUrl(pathname);
  useEffect(() => {
    if (!hidden) rememberSafeLocation(href);
  }, [hidden, href]);
  if (hidden && !unlocked) {
    return <TechnicalRouteNotice pathname={pathname} onUnlock={() => setUnlocked(true)} />;
  }
  return <>{children}</>;
}
