import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, Suspense, lazy, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "sonner";
import { PushPermissionPrompt } from "@/components/chat/PushPermissionPrompt";
import { AppearanceInit } from "@/components/appearance-init";
import { FullscreenModeInit } from "@/components/FullscreenModeInit";
import { applyCompactMode } from "@/components/CompactModeToggle";
import { applyReduceMotion } from "@/components/ReduceMotionToggle";
import { bootstrapNativePermissions } from "@/lib/permission-bootstrap";
import { ConfirmHost } from "@/lib/confirm";
import { useDeviceSessionGuard } from "@/lib/device-sessions";
import { ChatModeSplash } from "@/components/ChatModeSplash";
import { installChunkRecovery } from "@/lib/chunk-recovery";
import { withAssetVersion } from "@/lib/asset-version";
import { jsonLdScript, organizationSchema, websiteSchema } from "@/lib/structured-data";

// Layar hitam: entry/chunk gagal di-fetch di luar React → pulihkan sendiri.
installChunkRecovery();
// Global observability: capture errors from background async work (WA share,
// fetch during backgrounded WebView, dsb.) yang tidak melewati React
// boundary. Tersimpan di sessionStorage["mcm:last-unhandled"] agar bisa
// diambil next-turn saat user melaporkan crash tanpa DevTools.
if (typeof window !== "undefined" && !(window as unknown as { __mcmGlobalErrHooks?: boolean }).__mcmGlobalErrHooks) {
  (window as unknown as { __mcmGlobalErrHooks?: boolean }).__mcmGlobalErrHooks = true;
  const persist = (payload: Record<string, unknown>) => {
    try {
      window.sessionStorage.setItem("mcm:last-unhandled", JSON.stringify({ at: new Date().toISOString(), route: window.location.pathname + window.location.search, ...payload }));
    } catch { /* ignore */ }
  };
  window.addEventListener("error", (e) => {
    console.error("[mcm:window-error]", e.message, e.error?.stack ?? "");
    persist({ kind: "error", message: String(e.message ?? ""), stack: String(e.error?.stack ?? "").split("\n").slice(0, 12).join("\n") });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason as { message?: string; stack?: string } | string | undefined;
    const msg = typeof reason === "string" ? reason : (reason?.message ?? String(reason ?? ""));
    const stack = typeof reason === "object" && reason ? String(reason.stack ?? "") : "";
    console.error("[mcm:unhandled-rejection]", msg, stack);
    persist({ kind: "unhandledrejection", message: msg, stack: stack.split("\n").slice(0, 12).join("\n") });
  });
}
// Komponen non-kritis di-lazy-load supaya tidak masuk critical bundle
// dan tidak mengeksekusi efek/polling sebelum halaman utama siap.
const BuildVersionBadge = lazy(() =>
  import("@/components/BuildVersionBadge").then((m) => ({ default: m.BuildVersionBadge })),
);
const WhatsAppTargetHostLazy = lazy(() =>
  import("@/lib/wa-target").then((m) => ({ default: m.WhatsAppTargetHost })),
);
const WaPreviewHostLazy = lazy(() =>
  import("@/lib/wa-preview").then((m) => ({ default: m.WaPreviewHost })),
);

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-ms-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold tracking-tight text-primary">404</h1>
        <h2 className="mt-ms-3 text-ms-xl font-semibold text-foreground">Halaman tidak ditemukan</h2>
        <p className="mt-ms-2 text-ms-sm leading-relaxed text-muted-foreground">
          Halaman yang kamu tuju tidak ada atau sudah dipindahkan.
        </p>
        <div className="mt-ms-5">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-ms-5 py-ms-2 text-ms-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Kembali ke beranda
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error("[mcm:root-boundary]", error?.name, error?.message, error?.stack);
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
  // Portal pegawai (`/t/:token`) memiliki boundary + auto-remount sendiri,
  // dan pegawai tidak boleh melihat teks alarming saat WebView baru saja
  // dibuat ulang setelah kembali dari kamera / galeri. Kalau error tetap
  // menembus ke sini, tampilkan hanya spinner minimal dan retry lebih cepat.
  const isWorkerPortal =
    typeof window !== "undefined" && /^\/t\//.test(window.location.pathname);
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  // Simpan detail error terakhir ke sessionStorage supaya bisa dibaca
  // setelah auto-retry berhasil menyembunyikan pesan. Bisa diambil lewat
  // DevTools: sessionStorage.getItem("mcm:last-crash").
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const payload = {
        at: new Date().toISOString(),
        route: window.location.pathname + window.location.search,
        name: error?.name ?? "Error",
        message: msg,
        stack: error?.stack ? String(error.stack).split("\n").slice(0, 16).join("\n") : "",
      };
      window.sessionStorage.setItem("mcm:last-crash", JSON.stringify(payload));
    } catch {
      // ignore quota / privacy mode
    }
  }, [error, msg]);

  useEffect(() => {
    if (!isChunkLoadError) return;
    if (typeof window === "undefined") return;
    // Chunk-load recovery: cache-busting reload throttled to once every 5s.
    // A cache-busting `__r` query param + `location.replace` reliably forces
    // the browser to bypass its stale index.html/chunk cache; a plain
    // reload can still resolve to the same broken chunk.
    const KEY = "__chunk_reload_at";
    try {
      const prev = Number(window.sessionStorage.getItem(KEY) || "0");
      if (prev && Date.now() - prev < 5_000) return;
      window.sessionStorage.setItem(KEY, String(Date.now()));
    } catch {
      // ignore storage errors
    }
    const url = new URL(window.location.href);
    url.searchParams.set("__r", String(Date.now()));
    window.location.replace(url.toString());
  }, [isChunkLoadError]);

  useEffect(() => {
    if (attempt >= MAX_AUTO_RETRIES) {
      setAutoRetrying(false);
      return;
    }
    let cancelled = false;
    // Portal pegawai: retry lebih agresif (150ms → 400ms → 900ms) supaya
    // pemulihan hampir tak terlihat. Rute lain tetap 500ms → 1s → 2s.
    const delay = isWorkerPortal
      ? 150 * Math.pow(2, attempt)
      : 500 * Math.pow(2, attempt);
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
  }, [attempt, router, reset, isWorkerPortal]);

  if (autoRetrying && attempt < MAX_AUTO_RETRIES) {
    if (isWorkerPortal) {
      // UI diam-diam: spinner saja, tanpa "Memuat ulang halaman…" / "Percobaan
      // otomatis N dari 3" — teks itu membuat pegawai mengira mereka
      // dikeluarkan dari sesi PIN padahal sessionStorage-nya aman.
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-ms-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
        </div>
      );
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-ms-4">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
          <h1 className="text-ms-base font-semibold text-foreground">
            Memuat ulang halaman…
          </h1>
          <p className="mt-2 text-ms-xs text-muted-foreground">
            Percobaan otomatis {attempt + 1} dari {MAX_AUTO_RETRIES}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-ms-4">
      <div className="max-w-md text-center">
        <h1 className="text-ms-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-ms-sm text-muted-foreground">
          Sudah dicoba memuat ulang otomatis {MAX_AUTO_RETRIES}× namun belum berhasil. Anda bisa coba lagi atau kembali ke beranda.
        </p>
        <details className="mx-auto mt-4 max-w-full rounded-md border bg-muted/30 p-ms-3 text-left text-ms-xs" open>
          <summary className="cursor-pointer select-none font-medium text-foreground">
            Detail error
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-ms-2xs leading-snug text-muted-foreground">
{String(error?.name ?? "Error")}: {msg || "(tanpa pesan)"}
{error?.stack ? "\n\n" + String(error.stack).split("\n").slice(0, 8).join("\n") : ""}
          </pre>
          <button
            type="button"
            onClick={() => {
              const text = `${error?.name ?? "Error"}: ${msg}\n${error?.stack ?? ""}`;
              try { void navigator.clipboard?.writeText(text); } catch { /* ignore */ }
            }}
            className="mt-2 inline-flex items-center justify-center rounded border border-input bg-background px-ms-2 py-1 text-ms-2xs font-medium hover:bg-accent"
          >
            Salin detail error
          </button>
        </details>
        <div className="mt-6 flex flex-wrap justify-center gap-ms-2">
          <button
            onClick={() => {
              setAttempt(0);
              setAutoRetrying(true);
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-ms-4 py-ms-2 text-ms-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Muat ulang
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-ms-4 py-ms-2 text-ms-sm font-medium text-foreground transition-colors hover:bg-accent"
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
      // `interactive-widget=resizes-content`: keyboard virtual Android
      // menyusutkan LAYOUT viewport (bukan hanya visual viewport), jadi bar
      // bawah `fixed bottom-0` tidak pernah tergeser/melayang saat scroll
      // maupun saat keyboard muncul.
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
      },
      { title: "Ace Storage — Kelola Pesanan & Kirim WhatsApp" },
      { name: "description", content: "Kelola pesanan, stok gudang, dan hutang-piutang dari HP — lengkap dengan foto produk, tautan lokasi, dan kirim cepat ke WhatsApp pelanggan." },
      { name: "author", content: "Ace Storage" },
      { name: "theme-color", content: "#0a7a4a" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Ace Storage" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { property: "og:title", content: "Ace Storage — Kelola Pesanan & Kirim WhatsApp" },
      { property: "og:description", content: "Kelola pesanan, stok gudang, dan hutang-piutang dari HP — lengkap dengan foto produk, tautan lokasi, dan kirim cepat ke WhatsApp pelanggan." },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Ace Storage" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Ace Storage — Kelola Pesanan & Kirim WhatsApp" },
      { name: "twitter:description", content: "Kelola pesanan, stok gudang, dan hutang-piutang dari HP — lengkap dengan foto produk, tautan lokasi, dan kirim cepat ke WhatsApp pelanggan." },
      // Ukuran kartu OG bersifat sitewide (semua halaman memakai 1200×630);
      // URL gambarnya sendiri di-set per-rute lewat `socialMeta()` di
      // src/lib/seo-meta.ts supaya foto produk katalog bisa menimpanya.
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:locale", content: "id_ID" },
      { name: "msapplication-TileColor", content: "#0a7a4a" },
      { name: "msapplication-config", content: "/browserconfig.xml" },
      { name: "google-site-verification", content: "U9gNbUi1Ly1ya2k-cTFj2H05IsYp3K9gIB6TQsCzOLg" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      ...(import.meta.env.VITE_SUPABASE_URL
        ? [
            {
              rel: "preconnect",
              href: new URL(import.meta.env.VITE_SUPABASE_URL).origin,
            },
            {
              rel: "dns-prefetch",
              href: new URL(import.meta.env.VITE_SUPABASE_URL).origin,
            },
          ]
        : []),
      {
        rel: "stylesheet",
        // Dipangkas dari 7 → 5 keluarga font (Instrument Serif + Work Sans jadi
        // pasangan utama). Lebih sedikit request & byte pada buka pertama.
        href: "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Work+Sans:wght@400;500;600;700&family=Merriweather:wght@400;700&family=JetBrains+Mono:wght@400;600&family=Space+Grotesk:wght@500;600;700&display=swap",
      },
      // `withAssetVersion` menempelkan ?v=<BRAND_ASSET_VERSION> supaya ikon &
      // manifest lama tidak nyangkut di cache browser/launcher setelah publish.
      { rel: "manifest", href: withAssetVersion("/manifest.webmanifest") },
      { rel: "icon", type: "image/x-icon", href: withAssetVersion("/favicon.ico"), sizes: "any" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: withAssetVersion("/favicon-16.png") },
      { rel: "icon", type: "image/png", sizes: "32x32", href: withAssetVersion("/favicon-32.png") },
      { rel: "icon", type: "image/png", sizes: "48x48", href: withAssetVersion("/favicon-48.png") },
      { rel: "apple-touch-icon", sizes: "180x180", href: withAssetVersion("/apple-touch-icon.png") },
      { rel: "mask-icon", href: withAssetVersion("/mask-icon.svg"), color: "#c9a227" },
    ],
    // Identitas brand sitewide (beranda ikut memakainya) supaya hasil
    // pencarian bisa menampilkan knowledge panel / rich preview Ace Storage.
    scripts: [jsonLdScript([organizationSchema(), websiteSchema()])],
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
  // `translate="no"` + class `notranslate`: penerjemah otomatis Chrome /
  // Google Translate mengganti text node di luar sepengetahuan React —
  // penyebab klasik `NotFoundError: Failed to execute 'removeChild'`
  // yang selama ini bikin halaman Gudang "reload sendiri" di Android.
  return (
    <html lang="id" className="dark notranslate" translate="no" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <HeadContent />
        <meta name="google" content="notranslate" />
        {/* Verifikasi Search Console untuk domain mcmstorage.app.
            Ditulis langsung di <head> agar tidak menimpa token
            mcmstorage.biz yang dipasang lewat head() (meta di-dedupe
            berdasarkan name). */}
        <meta
          name="google-site-verification"
          content="iwAC6wE02G8EuSHBnL0KyePhsdySbjZn3k2OPLxjDhk"
        />
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
    // Jaga langganan notifikasi web tetap hidup supaya pesan tetap masuk
    // walau aplikasi sedang tertutup (endpoint push bisa dirotasi browser).
    import("@/lib/push-client")
      .then(({ startPushKeepAlive }) => startPushKeepAlive())
      .catch(() => {});
    // Bersihkan draft nama pegawai `mcm:sendPrepLink:workerName:*` yang
    // tertinggal dari sesi sebelumnya (mis. app di-force-stop sebelum
    // dialog sempat unmount). Hanya dijalankan sekali per boot.
    import("@/lib/cleanup-send-prep-link-drafts").then(
      ({ cleanupSendPrepLinkDrafts }) => {
        const n = cleanupSendPrepLinkDrafts();
        if (n > 0) console.info(`[mcm:cleanup] removed ${n} stale workerName draft(s)`);
      },
    ).catch(() => {});
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
    // Deep link native (scheme biz.mcmstorage.app + App Link mcmstorage.biz/t/*)
    import("@/lib/native-deeplink").then(({ startDeepLinkListener }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      startDeepLinkListener(router as any).catch((e) => console.warn("[deeplink]", e));
    }).catch(() => {});
    applyCompactMode();
    applyReduceMotion();
    // Terapkan preferensi aksesibilitas (font scale, high contrast, reduce
    // motion, bahasa) di boot supaya user tidak perlu membuka halaman
    // pengaturan dulu agar preferensi mereka aktif.
    import("@/lib/app-prefs").then(({ applyAppPrefs }) => applyAppPrefs()).catch(() => {});
    // Warna brand organisasi + branding mode Chat (title/icon/manifest).
    import("@/lib/org-name").then(({ applyBrandColor, watchThemeForBrand, hydrateOrgBrandingFromRemote }) => {
      applyBrandColor();
      watchThemeForBrand();
      hydrateOrgBrandingFromRemote().catch(() => {});
    }).catch(() => {});
    import("@/lib/chat-mode-branding").then(({ applyChatModeBranding }) => {
      applyChatModeBranding();
    }).catch(() => {});
    const onAppModeChange = () => {
      import("@/lib/chat-mode-branding").then(({ applyChatModeBranding }) => applyChatModeBranding()).catch(() => {});
    };
    window.addEventListener("mcm:app-mode-change", onAppModeChange);
    // Recovery bundle basi + auto-update SW pasca deploy baru.
    import("@/lib/build-cache-buster").then(({ installBuildCacheBuster }) => installBuildCacheBuster()).catch(() => {});
    import("@/lib/sw-auto-update").then(({ installSwAutoUpdate }) => installSwAutoUpdate()).catch(() => {});
    // Ketika Supabase mencabut sesi (mis. refresh 403 session_not_found),
    // paksa router re-run `_authenticated` gate supaya user diarahkan ke
    // /auth. Tanpa ini, komponen mounted (mis. NotificationBell) terus
    // memanggil serverFn yang butuh bearer → 401 "No authorization header
    // provided" dan layar blank.
    let authUnsub: (() => void) | null = null;
    import("@/integrations/supabase/client").then(({ supabase }) => {
      const { data } = supabase.auth.onAuthStateChange((event) => {
        if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
        try { router.invalidate(); } catch { /* ignore */ }
        if (event !== "SIGNED_OUT") {
          try { queryClient.invalidateQueries(); } catch { /* ignore */ }
        }
      });
      authUnsub = () => data.subscription.unsubscribe();
    }).catch(() => {});
    // Chunk-load errors yang muncul dari event handler / timer tidak akan
    // menyentuh errorComponent — tangkap di window scope dan lakukan hard
    // reload cache-busting sekali per 5 detik.
    const CHUNK_RE = /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk \d+ failed/i;
    const tryChunkReload = (msg: string) => {
      if (!CHUNK_RE.test(msg)) return;
      try {
        const KEY = "__chunk_reload_at";
        const prev = Number(window.sessionStorage.getItem(KEY) || "0");
        if (prev && Date.now() - prev < 5_000) return;
        window.sessionStorage.setItem(KEY, String(Date.now()));
      } catch { /* ignore */ }
      const url = new URL(window.location.href);
      url.searchParams.set("__r", String(Date.now()));
      window.location.replace(url.toString());
    };
    const onErr = (e: ErrorEvent) => tryChunkReload(String(e?.message || e?.error?.message || ""));
    const onRej = (e: PromiseRejectionEvent) => tryChunkReload(String((e?.reason as { message?: string } | undefined)?.message || e?.reason || ""));
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    // Kirim preferensi notifikasi ke service worker + tarik versi terbaru dari cloud
    let unsub: (() => void) | null = null;
    import("@/lib/notif-prefs").then(({ loadPrefs, broadcastPrefs, pullPrefsFromCloud, subscribeRemotePrefs }) => {
      broadcastPrefs(loadPrefs());
      pullPrefsFromCloud().catch(() => {});
      unsub = subscribeRemotePrefs(() => {});
    }).catch(() => {});
    return () => {
      if (unsub) unsub();
      if (authUnsub) authUnsub();
      window.removeEventListener("mcm:app-mode-change", onAppModeChange);
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
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

  return (
    <QueryClientProvider client={queryClient}>
      <AppearanceInit />
      <FullscreenModeInit />
      <ChatModeSplash />
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <PushPermissionPrompt />
      <Toaster
        // Ikuti tema aplikasi (Noir & Gold) — token semantik, bukan putih bawaan.
        theme="system"
        // Varian B: toast muncul di bawah, tepat di atas bar navigasi
        // bawah. Header dan kontrol atas (judul, lonceng, avatar) tidak
        // pernah tertutup berapa pun jumlah toast yang menumpuk.
        position="bottom-center"
        offset={{
          bottom: "calc(var(--app-bottom-nav-h, 0px) + 16px)",
          left: 16,
          right: 16,
          top: 16,
        }}
        mobileOffset={{
          bottom: "calc(var(--app-bottom-nav-h, 0px) + 12px)",
          left: 12,
          right: 12,
          top: 12,
        }}
        toastOptions={{
          style: { maxWidth: "calc(100vw - 24px)" },
          classNames: {
            toast:
              // Layar sempit: teks di atas, tombol aksi turun ke baris
              // sendiri (rata kanan) supaya judul tidak terpotong.
              "group !bg-card !text-foreground !border-border/70 !shadow-lg !rounded-xl backdrop-blur !flex-wrap !gap-ms-2",
            title: "!text-sm !font-semibold !leading-snug !whitespace-normal !break-words",
            description: "!text-xs !text-muted-foreground !whitespace-normal !break-words",
            // Noir & Gold: aksi utama memakai aksen emas (primary),
            // aksi sekunder tetap netral dengan border halus.
            actionButton:
              "!ml-auto !h-8 !shrink-0 !rounded-lg !px-3 !text-xs !font-semibold !bg-primary !text-primary-foreground hover:!brightness-110 active:!brightness-95 focus-visible:!outline-none focus-visible:!ring-2 focus-visible:!ring-ring focus-visible:!ring-offset-1 focus-visible:!ring-offset-card transition",
            cancelButton:
              "!h-8 !shrink-0 !rounded-lg !px-3 !text-xs !font-medium !bg-transparent !text-muted-foreground !border !border-border/70 hover:!bg-muted hover:!text-foreground focus-visible:!outline-none focus-visible:!ring-2 focus-visible:!ring-ring transition",
            closeButton: "!bg-card !text-muted-foreground !border-border/70",
          },
        }}
      />
      <ConfirmHost />
      <Suspense fallback={null}>
        <WhatsAppTargetHostLazy />
        <WaPreviewHostLazy />
        <BuildVersionBadge />
      </Suspense>
    </QueryClientProvider>
  );
}
