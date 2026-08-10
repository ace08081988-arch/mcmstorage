/**
 * Layar hitam total (bukan boundary React) terjadi ketika modul entry/chunk
 * gagal di-fetch — misalnya setelah aplikasi di-build ulang sementara WebView
 * masih memegang index.html lama, atau saat koneksi HP putus sesaat.
 * Kegagalan ini terjadi DI LUAR React, jadi errorComponent root tidak pernah
 * jalan dan layar tetap kosong.
 *
 * Recovery: deteksi pesan chunk-load pada window error / unhandledrejection /
 * event `vite:preloadError`, lalu hard reload dengan cache-buster. Dibatasi
 * agar tidak pernah jadi reload-loop.
 */
const CHUNK_RE =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk \d+ failed|Unable to preload CSS/i;

/**
 * Bundle klien lama yang masih memegang ID server function versi sebelumnya.
 * Server membalas 500 dengan pesan di bawah, dan halaman jadi blank karena
 * loader/komponen gagal. Perlakukan sama seperti chunk basi: hard reload.
 */
const STALE_SERVERFN_RE =
  /Invalid server function ID|Server function info not found/i;

const KEY = "mcm:chunk-reload";
const MAX_TRIES = 2;
const WINDOW_MS = 30_000;

function shouldReload(): boolean {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const state = raw ? (JSON.parse(raw) as { at: number; n: number }) : null;
    const now = Date.now();
    if (state && now - state.at < WINDOW_MS) {
      if (state.n >= MAX_TRIES) return false;
      window.sessionStorage.setItem(KEY, JSON.stringify({ at: now, n: state.n + 1 }));
      return true;
    }
    window.sessionStorage.setItem(KEY, JSON.stringify({ at: now, n: 1 }));
    return true;
  } catch {
    return true;
  }
}

function recover(reason: string) {
  if (!CHUNK_RE.test(reason)) return;
  if (!shouldReload()) return;
  hardReload();
}

/** Apakah error ini akibat chunk/bundle basi (bukan bug aplikasi)? */
export function isChunkLoadError(err: unknown): boolean {
  const msg =
    typeof err === "string"
      ? err
      : String((err as { message?: string } | undefined)?.message ?? "");
  return CHUNK_RE.test(msg) || STALE_SERVERFN_RE.test(msg);
}

/**
 * Coba pulihkan error chunk basi dengan hard reload (dibatasi anti-loop).
 * Mengembalikan true bila reload dijalankan.
 */
export function recoverFromChunkError(err: unknown): boolean {
  if (typeof window === "undefined") return false;
  if (!isChunkLoadError(err)) return false;
  if (!shouldReload()) return false;
  hardReload();
  return true;
}

function hardReload() {
  const url = new URL(window.location.href);
  url.searchParams.set("__r", String(Date.now()));
  window.location.replace(url.toString());
}

/** Deteksi respons 500 dari `/_serverFn/*` akibat bundle klien basi. */
function installStaleServerFnRecovery() {
  const originalFetch = window.fetch?.bind(window);
  if (!originalFetch) return;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await originalFetch(input, init);
    try {
      if (res.status >= 500) {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url && url.includes("/_serverFn/")) {
          const body = await res.clone().text();
          if (STALE_SERVERFN_RE.test(body) && shouldReload()) hardReload();
        }
      }
    } catch {
      /* jangan pernah menggagalkan request asli karena deteksi ini */
    }
    return res;
  };
}

export function installChunkRecovery() {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __mcmChunkRecovery?: boolean };
  if (w.__mcmChunkRecovery) return;
  w.__mcmChunkRecovery = true;

  window.addEventListener("error", (e) => {
    recover(String(e.message ?? "") + " " + String((e as ErrorEvent).error?.message ?? ""));
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = (e as PromiseRejectionEvent).reason as { message?: string } | string | undefined;
    recover(typeof r === "string" ? r : String(r?.message ?? ""));
  });
  window.addEventListener("vite:preloadError", (e) => {
    recover(String((e as unknown as { payload?: { message?: string } }).payload?.message ?? "Failed to fetch dynamically imported module"));
  });

  installStaleServerFnRecovery();
}
