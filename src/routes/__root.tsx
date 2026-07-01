import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "sonner";
import { AppearanceInit } from "@/components/appearance-settings";
import { applyCompactMode } from "@/components/CompactModeToggle";
import { applyReduceMotion } from "@/components/ReduceMotionToggle";
import { bootstrapNativePermissions } from "@/lib/permission-bootstrap";
import { ConfirmHost } from "@/lib/confirm";
import { WhatsAppTargetHost } from "@/lib/wa-target";
import { WaPreviewHost } from "@/lib/wa-preview";
import { useDeviceSessionGuard } from "@/lib/device-sessions";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [autoRetrying, setAutoRetrying] = useState(true);
  const MAX_AUTO_RETRIES = 3;
  // Chunk-load / dynamic import failures cannot be recovered with reset() —
  // the browser is holding a stale index.html that points at a chunk that
  // no longer exists on the server. A hard reload is the only fix.
  const msg = String(error?.message ?? "");
  const isChunkLoadError =
    /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk \d+ failed/i.test(
      msg,
    );
  const isAdminRequiredError = /Forbidden:\s*admin diperlukan|admin diperlukan/i.test(msg);
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  useEffect(() => {
    if (!isChunkLoadError) return;
    if (typeof window === "undefined") return;
    // Chunk-load errors typically mean the dev server rebuilt and the
    // currently-loaded index.html points at chunk hashes that no longer
    // exist. A hard reload with a cache-busting query param is the only
    // safe recovery. Guard against tight reload loops by throttling to
    // one reload per 5s window — but do NOT lock reloads to once per
    // session, since subsequent rebuilds in the same session must also
    // recover.
    const KEY = "__chunk_reload_at";
    const now = Date.now();
    try {
      const prev = Number(window.sessionStorage.getItem(KEY) || "0");
      if (prev && now - prev < 5000) return;
      window.sessionStorage.setItem(KEY, String(now));
    } catch {
      // ignore storage errors
    }
    // Force bypass of any HTTP/service-worker cache for the shell.
    const url = new URL(window.location.href);
    url.searchParams.set("__r", String(now));
    window.location.replace(url.toString());
  }, [isChunkLoadError]);

  useEffect(() => {
    if (isAdminRequiredError) {
      setAutoRetrying(false);
      return;
    }
    if (attempt >= MAX_AUTO_RETRIES) {
      setAutoRetrying(false);
      return;
    }
    let cancelled = false;
    const delay = 500 * Math.pow(2, attempt); // 500ms, 1s, 2s
    const t = window.setTimeout(() => {
      if (cancelled) return;
      setAttempt((n: number) => n + 1);
      // Defer reset to next tick so we don't unmount mid-setState batch.
      Promise.resolve().then(() => {
        if (cancelled) return;
        router.invalidate();
        reset();
      });
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [attempt, isAdminRequiredError, router, reset]);

  if (isAdminRequiredError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 shadow-sm dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          <h1 className="text-base font-semibold leading-snug">Hanya admin</h1>
          <p className="mt-2 text-sm leading-snug">
            Halaman ini khusus admin. Aplikasi tidak akan menampilkan layar kosong lagi saat akun tidak punya akses.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => {
                router.invalidate();
                reset();
              }}
              className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Coba lagi
            </button>
            <a
              href="/"
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              Beranda
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (autoRetrying && attempt < MAX_AUTO_RETRIES) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
          <h1 className="text-base font-semibold text-foreground">
            Memuat ulang halaman…
          </h1>
          <p className="mt-2 text-xs text-muted-foreground">
            Percobaan otomatis {attempt + 1} dari {MAX_AUTO_RETRIES}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sudah dicoba memuat ulang otomatis {MAX_AUTO_RETRIES}× namun belum berhasil. Anda bisa coba lagi atau kembali ke beranda.
        </p>
        <details className="mx-auto mt-4 max-w-full rounded-md border bg-muted/30 p-3 text-left text-xs" open>
          <summary className="cursor-pointer select-none font-medium text-foreground">
            Detail error
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-snug text-muted-foreground">
{String(error?.name ?? "Error")}: {msg || "(tanpa pesan)"}
{error?.stack ? "\n\n" + String(error.stack).split("\n").slice(0, 8).join("\n") : ""}
          </pre>
          <button
            type="button"
            onClick={() => {
              const text = `${error?.name ?? "Error"}: ${msg}\n${error?.stack ?? ""}`;
              try { void navigator.clipboard?.writeText(text); } catch { /* ignore */ }
            }}
            className="mt-2 inline-flex items-center justify-center rounded border border-input bg-background px-2 py-1 text-[11px] font-medium hover:bg-accent"
          >
            Salin detail error
          </button>
        </details>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              setAttempt(0);
              setAutoRetrying(true);
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Muat ulang
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Beranda
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "MCM — Kelola Pesanan & Chat" },
      { name: "description", content: "MCM — aplikasi pengelola pesanan harian dengan foto, lokasi, dan kirim cepat via MCM." },
      { name: "author", content: "MCM" },
      { name: "theme-color", content: "#0a7a4a" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "MCM" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "msapplication-TileColor", content: "#0a7a4a" },
      { name: "msapplication-TileImage", content: "/mstile-144x144.png" },
      { name: "msapplication-config", content: "/browserconfig.xml" },
      { property: "og:title", content: "MCM — Kelola Pesanan & Chat" },
      { property: "og:description", content: "Aplikasi pengelola pesanan harian: foto, lokasi, dan kirim cepat via MCM." },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "MCM" },
      { property: "og:url", content: "https://mcmstorage.biz/" },
      { property: "og:image", content: "https://mcmstorage.biz/og-image.jpg" },
      { property: "og:image:secure_url", content: "https://mcmstorage.biz/og-image.jpg" },
      { property: "og:image:type", content: "image/jpeg" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "Logo MCM — Kelola Pesanan & Chat" },
      { property: "og:locale", content: "id_ID" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "MCM — Kelola Pesanan & Chat" },
      { name: "twitter:description", content: "Aplikasi pengelola pesanan harian: foto, lokasi, dan kirim cepat via MCM." },
      { name: "twitter:image", content: "https://mcmstorage.biz/og-image.jpg" },
      { name: "twitter:image:alt", content: "Logo MCM — Kelola Pesanan & Chat" },
      { name: "google-site-verification", content: "U9gNbUi1Ly1ya2k-cTFj2H05IsYp3K9gIB6TQsCzOLg" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@400;700&family=JetBrains+Mono:wght@400;600&family=Space+Grotesk:wght@500;600;700&display=swap",
      },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", href: "/favicon-16.png", type: "image/png", sizes: "16x16" },
      { rel: "icon", href: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { rel: "icon", href: "/favicon-48.png", type: "image/png", sizes: "48x48" },
      { rel: "icon", href: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { rel: "icon", href: "/icon-maskable-512.png", type: "image/png", sizes: "512x512" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
      { rel: "mask-icon", href: "/mask-icon.svg", color: "#0F766E" },
      { rel: "shortcut icon", href: "/favicon.ico" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  // Skrip blocking: terapkan tema (dark/light), aksen, radius, dan latar SEBELUM paint
  // sehingga tidak ada kedipan tema dari light → dark saat hydration.
  const themeBootstrap = `
(function(){try{
  var d=document.documentElement;
  var ls=window.localStorage;
  var t=ls.getItem('app-theme')||'dark';
  var resolved=t;
  if(t==='system'){resolved=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
  if(resolved==='dark') d.classList.add('dark'); else d.classList.remove('dark');
  var ACC={emerald:'oklch(0.62 0.17 155)',blue:'oklch(0.60 0.18 250)',violet:'oklch(0.58 0.22 295)',rose:'oklch(0.63 0.22 20)',amber:'oklch(0.78 0.16 80)',slate:'oklch(0.30 0.04 260)'};
  var aId=ls.getItem('app-accent')||'emerald';
  var aVal=ACC[aId]||ACC.emerald;
  d.style.setProperty('--primary',aVal);
  d.style.setProperty('--ring',aVal);
  d.style.setProperty('--primary-foreground','oklch(0.985 0 0)');
  var r=Number(ls.getItem('app-radius')||'0.625');
  d.style.setProperty('--radius',r+'rem');
  var bg=ls.getItem('app-bg-image')||'';
  var ov=Number(ls.getItem('app-bg-overlay')||'0.7');
  var bl=Number(ls.getItem('app-bg-blur')||'0');
  d.style.setProperty('--app-bg-image',bg?'url("'+bg.replace(/"/g,'\\\\"')+'")':'none');
  d.style.setProperty('--app-bg-overlay',String(bg?ov:1));
  d.style.setProperty('--app-bg-blur',(bg?bl:0)+'px');
  d.dataset.font=ls.getItem('app-font')||'sans';
  d.dataset.fontSize=ls.getItem('app-font-size')||'md';
  if(bg) d.dataset.hasBg='1'; else delete d.dataset.hasBg;
}catch(e){}})();`;
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  // Lacak perangkat tempat login + auto-signOut bila sesi dicabut dari
  // halaman "Sesi & Perangkat" di tempat lain.
  useDeviceSessionGuard();

  useEffect(() => {
    bootstrapNativePermissions().catch((e) =>
      console.warn("[perm-bootstrap]", e),
    );
    // Aktifkan notifikasi native (FCM) — hanya di APK/native, no-op di web
    import("@/lib/native-push").then(({ startNativePush }) => {
      startNativePush({
        onOpenUrl: (url) => {
          try {
            router.navigate({ to: url.startsWith("/") ? url : `/${url}` });
          } catch {
            window.location.assign(url);
          }
        },
      }).catch((e) => console.warn("[native-push]", e));
    }).catch(() => {});
    applyCompactMode();
    applyReduceMotion();
    // Auto-update service worker: manifest & ikon selalu ambil versi terbaru
    // tanpa perlu uninstall/install ulang.
    import("@/lib/sw-auto-update").then(({ installSwAutoUpdate }) => {
      installSwAutoUpdate();
    }).catch(() => {});
    // Dev-mode: audit komponen interaktif yang berpotensi bentrok dengan
    // reaksi press tapi belum diberi `data-no-press`.
    if (import.meta.env.DEV) {
      import("@/lib/press-audit").then(({ installPressAudit }) => {
        installPressAudit();
      }).catch(() => {});
    }
    // Terapkan preferensi aplikasi (skala teks, kontras, reduce-motion, lang).
    import("@/lib/app-prefs").then(({ applyAppPrefs }) => applyAppPrefs()).catch(() => {});
    // Terapkan warna brand organisasi + tarik ulang dari backend agar konsisten
    // lintas perangkat/login.
    import("@/lib/org-name").then(({ applyBrandColor, hydrateOrgBrandingFromRemote, watchThemeForBrand }) => {
      applyBrandColor();
      watchThemeForBrand();
      hydrateOrgBrandingFromRemote().catch(() => {});
    }).catch(() => {});
    // Re-hydrate saat login/logout berubah
    let authUnsub: (() => void) | null = null;
    import("@/integrations/supabase/client").then(({ supabase }) => {
      const { data } = supabase.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
          import("@/lib/org-name").then(({ hydrateOrgBrandingFromRemote }) => {
            hydrateOrgBrandingFromRemote().catch(() => {});
          }).catch(() => {});
        }
      });
      authUnsub = () => data.subscription.unsubscribe();
    }).catch(() => {});
    // Kirim preferensi notifikasi ke service worker + tarik versi terbaru dari cloud
    let unsub: (() => void) | null = null;
    import("@/lib/notif-prefs").then(({ loadPrefs, broadcastPrefs, pullPrefsFromCloud, subscribeRemotePrefs }) => {
      broadcastPrefs(loadPrefs());
      pullPrefsFromCloud().catch(() => {});
      unsub = subscribeRemotePrefs(() => {});
    }).catch(() => {});
    return () => { if (unsub) unsub(); if (authUnsub) authUnsub(); };
  }, []);

  // Tangani pesan dari service worker push (klik notifikasi / aksi cepat)
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMsg = (event: MessageEvent) => {
      const d = event.data as { type?: string; url?: string; conversationId?: string } | undefined;
      if (!d || typeof d.type !== "string") return;
      if (d.type === "navigate" && d.url) {
        try { router.navigate({ to: d.url }); } catch { window.location.href = d.url; }
      } else if (d.type === "mark-read" && d.conversationId) {
        import("@/integrations/supabase/client").then(async ({ supabase }) => {
          const { data: u } = await supabase.auth.getUser();
          if (!u.user) return;
          await supabase
            .from("conversation_members")
            .update({ last_read_at: new Date().toISOString() })
            .eq("conversation_id", d.conversationId!)
            .eq("user_id", u.user.id);
          queryClient.invalidateQueries({ queryKey: ["chat"] });
        }).catch(() => {});
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [router, queryClient]);

  // Global recovery: dynamic-import failures often escape the route
  // errorComponent (fired from setTimeout / event handlers / detached
  // promises). Listen at window scope and hard-reload once per 5s so
  // stale chunks after a dev rebuild or new deploy don't wedge the app.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const looksLikeChunkErr = (msg: string) =>
      /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk \d+ failed|error loading dynamically imported module/i.test(
        msg,
      );
    const recover = () => {
      const KEY = "__chunk_reload_at";
      const now = Date.now();
      try {
        const prev = Number(window.sessionStorage.getItem(KEY) || "0");
        if (prev && now - prev < 5000) return;
        window.sessionStorage.setItem(KEY, String(now));
      } catch { /* ignore */ }
      const url = new URL(window.location.href);
      url.searchParams.set("__r", String(now));
      window.location.replace(url.toString());
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const msg = String((e.reason as { message?: string } | undefined)?.message ?? e.reason ?? "");
      if (looksLikeChunkErr(msg)) recover();
    };
    const onError = (e: ErrorEvent) => {
      if (looksLikeChunkErr(String(e.message ?? ""))) recover();
    };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AppearanceInit />
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster richColors position="top-center" />
      <ConfirmHost />
      <WhatsAppTargetHost />
      <WaPreviewHost />
    </QueryClientProvider>
  );
}
