// Recover from stale dynamic-import chunks after a redeploy / dev restart.
// When the browser holds an old index that points to a chunk path which no
// longer exists, dynamic import() rejects with one of the messages below.
// We force a single hard reload (cache-busting via ?v=ts) — guarded by
// sessionStorage so a genuinely broken build can't trigger a reload loop.

const CHUNK_ERROR_RE =
  /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk [\w-]+ failed|error loading dynamically imported module/i;

const RELOAD_KEY = "__chunk_reload_once";

function isChunkError(err: unknown): boolean {
  if (!err) return false;
  const msg =
    typeof err === "string"
      ? err
      : err instanceof Error
        ? err.message
        : String((err as { message?: unknown })?.message ?? "");
  return CHUNK_ERROR_RE.test(msg);
}

function hardReloadOnce() {
  try {
    if (sessionStorage.getItem(RELOAD_KEY)) return;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // ignore storage errors
  }
  const url = new URL(window.location.href);
  url.searchParams.set("v", String(Date.now()));
  window.location.replace(url.toString());
}

let installed = false;

export function installChunkReloadGuard() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  // Successful page load means the new chunks are good — clear the guard so
  // a future stale-chunk event can reload once more.
  try {
    sessionStorage.removeItem(RELOAD_KEY);
  } catch {
    /* ignore */
  }

  window.addEventListener("error", (event) => {
    if (isChunkError(event.error ?? event.message)) hardReloadOnce();
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (isChunkError(event.reason)) hardReloadOnce();
  });
}