import { useEffect, useState } from "react";
import { toast } from "sonner";

// Nilai ini di-inline oleh Vite pada saat build (lihat vite.config.ts).
// Fallback aman bila define belum berjalan (mis. HMR sebelum reload).
const BUILD_ID: string = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";
const BUILD_TIME: string = typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : new Date().toISOString();

const STORAGE_HIDE_KEY = "mcm:build-badge:hidden";
// Badge build adalah alat QA, bukan elemen produk. Di produksi ia hanya
// muncul bila pengguna mengaktifkan mode diagnostik secara sadar
// (Pengaturan → Diagnostik menulis kunci ini).
const STORAGE_DIAGNOSTICS_KEY = "ace:diagnostics";

function diagnosticsEnabled(): boolean {
  if (!import.meta.env.PROD) return true;
  try {
    if (localStorage.getItem(STORAGE_DIAGNOSTICS_KEY) === "1") return true;
    return new URLSearchParams(window.location.search).get("diag") === "1";
  } catch {
    return false;
  }
}

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
  // Default `false` di produksi supaya badge tidak sempat berkedip sebelum
  // efek pertama berjalan; dev/staging langsung tampil.
  const [allowed, setAllowed] = useState(!import.meta.env.PROD);
  const [open, setOpen] = useState(false);
  const [stale, setStale] = useState(false);
  const [remoteId, setRemoteId] = useState<string | null>(null);

  useEffect(() => {
    setAllowed(diagnosticsEnabled());
    try {
      setHidden(localStorage.getItem(STORAGE_HIDE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  // Cek apakah bundle di server sudah lebih baru dari yang sedang berjalan.
  useEffect(() => {
    if (!allowed) return;
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
  }, [allowed]);

  if (!allowed || hidden) return null;

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
      className="pointer-events-none fixed app-fab-left app-fab-bottom z-[var(--z-build-badge)] flex flex-col items-start gap-ms-1"
      data-no-press
    >
      {stale && (
        <div className="pointer-events-auto flex items-center gap-ms-2 rounded-full border border-warning/60 bg-warning/95 px-ms-3 py-1 text-ms-2xs font-medium text-warning shadow-lg">
          <span>Versi baru tersedia</span>
          <button
            type="button"
            onClick={hardReload}
            className="rounded-full bg-warning/20 px-ms-2 py-0.5 text-ms-2xs font-semibold text-warning hover:bg-warning/30"
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
            "flex items-center gap-ms-1.5 rounded-full border px-ms-2 py-0.5 font-mono text-ms-2xs leading-none shadow-sm backdrop-blur-md transition " +
            (stale
              ? "border-warning/60 bg-warning/20 text-warning"
              : "border-white/10 bg-black/50 text-white/60 hover:text-white/90")
          }
        >
          <span
            className={
              "inline-block h-1.5 w-1.5 rounded-full " +
              (stale ? "bg-warning" : "bg-success")
            }
          />
          <span>build {shortId(BUILD_ID)}</span>
        </button>

        {open && (
          <div className="mt-1 w-64 rounded-lg border border-white/10 bg-zinc-950/95 p-ms-3 text-ms-2xs text-zinc-200 shadow-xl backdrop-blur-md">
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
            <dl className="mt-2 space-y-1 font-mono text-ms-2xs leading-snug">
              <div className="flex justify-between gap-ms-2">
                <dt className="text-zinc-500">Bundle</dt>
                <dd className="truncate text-right text-zinc-200">{BUILD_ID}</dd>
              </div>
              <div className="flex justify-between gap-ms-2">
                <dt className="text-zinc-500">Waktu</dt>
                <dd className="text-right text-zinc-200">{formatTime(BUILD_TIME)}</dd>
              </div>
              {remoteId && (
                <div className="flex justify-between gap-ms-2">
                  <dt className="text-zinc-500">Server</dt>
                  <dd
                    className={
                      "truncate text-right " + (stale ? "text-warning" : "text-success")
                    }
                  >
                    {shortId(remoteId)} {stale ? "· baru" : "· sama"}
                  </dd>
                </div>
              )}
            </dl>
            <div className="mt-3 flex flex-wrap gap-ms-2">
              <button
                type="button"
                onClick={copyAll}
                className="rounded-md border border-white/10 bg-white/5 px-ms-2 py-1 text-ms-2xs font-medium text-zinc-100 hover:bg-white/10"
              >
                Salin
              </button>
              <button
                type="button"
                onClick={hardReload}
                className="rounded-md border border-success/30 bg-success/20 px-ms-2 py-1 text-ms-2xs font-medium text-success hover:bg-success/30"
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
                className="ml-auto rounded-md px-ms-2 py-1 text-ms-2xs text-zinc-500 hover:text-zinc-300"
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