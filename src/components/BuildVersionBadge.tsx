import { useEffect, useState } from "react";
import { toast } from "sonner";

// Nilai ini di-inline oleh Vite pada saat build (lihat vite.config.ts).
// Fallback aman bila define belum berjalan (mis. HMR sebelum reload).
const BUILD_ID: string = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";
const BUILD_TIME: string = typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : new Date().toISOString();

const STORAGE_HIDE_KEY = "mcm:build-badge:hidden";

function shortId(id: string) {
  return id.length > 12 ? id.slice(0, 12) : id;
}

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

export function BuildVersionBadge() {
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const [stale, setStale] = useState(false);
  const [remoteId, setRemoteId] = useState<string | null>(null);

  useEffect(() => {
    try {
      setHidden(localStorage.getItem(STORAGE_HIDE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  // Cek apakah bundle di server sudah lebih baru dari yang sedang berjalan.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`/api/version?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { buildId?: string };
        if (cancelled) return;
        if (typeof data.buildId === "string" && data.buildId.length > 0) {
          setRemoteId(data.buildId);
          setStale(data.buildId !== BUILD_ID);
        }
      } catch {
        /* server tidak menyediakan version.json — abaikan */
      }
    };
    void check();
    const iv = window.setInterval(check, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
    };
  }, []);

  if (hidden) return null;

  const copyAll = async () => {
    const text = `BuildID: ${BUILD_ID}\nBuildTime: ${BUILD_TIME}${remoteId ? `\nServerBuildID: ${remoteId}` : ""}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Info build disalin");
    } catch {
      toast.error("Gagal menyalin");
    }
  };

  const hardReload = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("__r", String(Date.now()));
    window.location.replace(url.toString());
  };

  return (
    <div
      className="pointer-events-none fixed bottom-2 left-2 z-[9999] flex flex-col items-start gap-1"
      data-no-press
    >
      {stale && (
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-amber-400/60 bg-amber-500/95 px-3 py-1 text-[11px] font-medium text-amber-950 shadow-lg">
          <span>Versi baru tersedia</span>
          <button
            type="button"
            onClick={hardReload}
            className="rounded-full bg-amber-950/20 px-2 py-0.5 text-[10px] font-semibold text-amber-950 hover:bg-amber-950/30"
          >
            Muat ulang
          </button>
        </div>
      )}

      <div className="pointer-events-auto">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title={`Build ${BUILD_ID}\n${BUILD_TIME}`}
          className={
            "flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] leading-none shadow-sm backdrop-blur-md transition " +
            (stale
              ? "border-amber-400/60 bg-amber-500/20 text-amber-200"
              : "border-white/10 bg-black/50 text-white/60 hover:text-white/90")
          }
        >
          <span
            className={
              "inline-block h-1.5 w-1.5 rounded-full " +
              (stale ? "bg-amber-400" : "bg-emerald-400")
            }
          />
          <span>build {shortId(BUILD_ID)}</span>
        </button>

        {open && (
          <div className="mt-1 w-64 rounded-lg border border-white/10 bg-zinc-950/95 p-3 text-[11px] text-zinc-200 shadow-xl backdrop-blur-md">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-100">Info build</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-zinc-500 hover:text-zinc-200"
                aria-label="Tutup"
              >
                ×
              </button>
            </div>
            <dl className="mt-2 space-y-1 font-mono text-[10px] leading-snug">
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-500">Bundle</dt>
                <dd className="truncate text-right text-zinc-200">{BUILD_ID}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-500">Waktu</dt>
                <dd className="text-right text-zinc-200">{formatTime(BUILD_TIME)}</dd>
              </div>
              {remoteId && (
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-500">Server</dt>
                  <dd
                    className={
                      "truncate text-right " + (stale ? "text-amber-300" : "text-emerald-300")
                    }
                  >
                    {shortId(remoteId)} {stale ? "· baru" : "· sama"}
                  </dd>
                </div>
              )}
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={copyAll}
                className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-medium text-zinc-100 hover:bg-white/10"
              >
                Salin
              </button>
              <button
                type="button"
                onClick={hardReload}
                className="rounded-md border border-emerald-500/30 bg-emerald-600/20 px-2 py-1 text-[10px] font-medium text-emerald-200 hover:bg-emerald-600/30"
              >
                Muat ulang paksa
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.setItem(STORAGE_HIDE_KEY, "1");
                  } catch {
                    /* ignore */
                  }
                  setHidden(true);
                }}
                className="ml-auto rounded-md px-2 py-1 text-[10px] text-zinc-500 hover:text-zinc-300"
              >
                Sembunyikan
              </button>
            </div>
            <p className="mt-2 text-[9.5px] leading-snug text-zinc-500">
              Untuk menampilkan lagi: jalankan{" "}
              <code className="rounded bg-white/5 px-1">localStorage.removeItem('{STORAGE_HIDE_KEY}')</code>{" "}
              lalu muat ulang.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}