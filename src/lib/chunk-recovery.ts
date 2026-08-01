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
  const url = new URL(window.location.href);
  url.searchParams.set("__r", String(Date.now()));
  window.location.replace(url.toString());
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
}
