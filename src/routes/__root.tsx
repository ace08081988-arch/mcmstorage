import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "sonner";
import { AppearanceInit } from "@/components/appearance-settings";
import { applyCompactMode } from "@/components/CompactModeToggle";
import { bootstrapNativePermissions } from "@/lib/permission-bootstrap";
import { ConfirmHost } from "@/lib/confirm";
import { WhatsAppPreviewHost } from "@/lib/share-wa-preview";
import { DevConnectionWatcher } from "@/components/DevConnectionWatcher";

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
  // Chunk-load / dynamic import failures cannot be recovered with reset() —
  // the browser is holding a stale index.html that points at a chunk that
  // no longer exists on the server. A hard reload is the only fix.
  const msg = String(error?.message ?? "");
  const isChunkLoadError =
    /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk \d+ failed/i.test(
      msg,
    );
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  useEffect(() => {
    if (!isChunkLoadError) return;
    if (typeof window === "undefined") return;
    // Avoid infinite reload loops: only auto-reload once per session.
    const KEY = "__chunk_reload_once";
    try {
      if (window.sessionStorage.getItem(KEY)) return;
      window.sessionStorage.setItem(KEY, "1");
    } catch {
      // ignore storage errors
    }
    window.location.reload();
  }, [isChunkLoadError]);

  // Chunk-load errors: show a spinner while the page hard-reloads.
  // Other errors are shown to the user immediately — auto-resetting the
  // boundary silently remounts the route and loses user-entered state
  // (PIN, form fields), which is worse than showing the error.
  if (isChunkLoadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
          <h1 className="text-base font-semibold text-foreground">
            Memuat ulang halaman…
          </h1>
          <p className="mt-2 text-xs text-muted-foreground">
            Versi aplikasi diperbarui, sedang menyegarkan…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Halaman gagal dimuat
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Terjadi kesalahan sementara saat memuat halaman ini. Coba muat ulang, atau kembali ke beranda.
        </p>
        {msg && (
          <p className="mt-2 text-[11px] text-muted-foreground/80 break-words">{msg}</p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
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
      { name: "google", content: "notranslate" },
      { title: "MCM Storage — Kelola Pesanan & Kirim WhatsApp" },
      { name: "description", content: "MCM Storage — aplikasi pengelola pesanan harian dengan foto, lokasi, dan kirim cepat ke WhatsApp pelanggan." },
      { name: "author", content: "MCM Storage" },
      { name: "theme-color", content: "#0a7a4a" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "MCM Storage" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { property: "og:title", content: "MCM Storage — Kelola Pesanan & Kirim WhatsApp" },
      { property: "og:description", content: "MCM Storage — aplikasi pengelola pesanan harian dengan foto, lokasi, dan kirim cepat ke WhatsApp pelanggan." },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "MCM Storage" },
      { property: "og:url", content: "https://mcmstorage.lovable.app/" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "MCM Storage — Kelola Pesanan & Kirim WhatsApp" },
      { name: "twitter:description", content: "MCM Storage — aplikasi pengelola pesanan harian dengan foto, lokasi, dan kirim cepat ke WhatsApp pelanggan." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/856c467e-49d8-4ece-830b-e2130c9812d1" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/856c467e-49d8-4ece-830b-e2130c9812d1" },
      { name: "google-site-verification", content: "StEYz84rl1qtnbBteGIp64am18nvMhg5C8bd43_SPu4" },
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
      { rel: "icon", href: "/icon-512.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/icon-512.png" },
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
    <html lang="id" translate="no" className="dark notranslate" suppressHydrationWarning>
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

  useEffect(() => {
    bootstrapNativePermissions().catch((e) =>
      console.warn("[perm-bootstrap]", e),
    );
    applyCompactMode();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AppearanceInit />
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster richColors position="top-center" />
      <ConfirmHost />
      <WhatsAppPreviewHost />
      <DevConnectionWatcher />
    </QueryClientProvider>
  );
}
