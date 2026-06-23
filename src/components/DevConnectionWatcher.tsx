import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type DevStatus = "connected" | "disconnected" | "unknown";

type Listener = () => void;

const listeners = new Set<Listener>();
let currentStatus: DevStatus = import.meta.env.DEV ? "connected" : "unknown";
let lastDisconnectAt: number | null = null;
let lastConnectAt: number | null = null;

function setStatus(next: DevStatus) {
  if (currentStatus === next) return;
  currentStatus = next;
  if (next === "disconnected") lastDisconnectAt = Date.now();
  if (next === "connected") lastConnectAt = Date.now();
  listeners.forEach((l) => l());
}

function subscribe(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getSnapshot() {
  return currentStatus;
}
function getServerSnapshot(): DevStatus {
  return "unknown";
}

export function useDevConnectionStatus() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Memantau koneksi WebSocket Vite (HMR) di mode dev. Saat koneksi putus
 * tampilkan toast persisten, dan saat koneksi pulih lakukan reload otomatis
 * agar preview tidak menggantung pada render lama (mis. layar "Memuat…").
 *
 * Hanya aktif di mode dev (import.meta.hot tersedia). Di production
 * komponen ini no-op.
 */
export function DevConnectionWatcher() {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const hot = (import.meta as unknown as { hot?: ViteHotApi }).hot;
    if (!hot) return;

    const TOAST_ID = "dev-connection-lost";
    let lostAt = 0;
    let reloadTimer: number | null = null;

    const onDisconnect = () => {
      lostAt = Date.now();
      setStatus("disconnected");
      toast.warning("Koneksi dev server terputus", {
        id: TOAST_ID,
        description: "Menunggu koneksi pulih, halaman akan dimuat ulang otomatis.",
        duration: Number.POSITIVE_INFINITY,
      });
    };

    const onConnect = () => {
      setStatus("connected");
      // Abaikan event connect pertama saat halaman pertama dimuat.
      if (!lostAt) return;
      const downMs = Date.now() - lostAt;
      toast.success("Koneksi dev server pulih", {
        id: TOAST_ID,
        description: `Memuat ulang halaman… (terputus ${(downMs / 1000).toFixed(1)} dtk)`,
        duration: 3000,
      });
      if (reloadTimer) window.clearTimeout(reloadTimer);
      // Beri jeda singkat agar toast sempat terlihat sebelum reload.
      reloadTimer = window.setTimeout(() => {
        window.location.reload();
      }, 600);
    };

    hot.on?.("vite:ws:disconnect", onDisconnect);
    hot.on?.("vite:ws:connect", onConnect);
    return () => {
      hot.off?.("vite:ws:disconnect", onDisconnect);
      hot.off?.("vite:ws:connect", onConnect);
      if (reloadTimer) window.clearTimeout(reloadTimer);
    };
  }, []);

  return null;
}

/**
 * Indikator status koneksi dev server. Hanya tampil di mode dev; di production
 * tidak merender apa-apa agar tidak memenuhi header.
 */
export function DevConnectionStatusBadge({ className }: { className?: string }) {
  const status = useDevConnectionStatus();
  const [, force] = useState(0);
  // Re-render tiap detik saat disconnected agar durasi terputus berjalan.
  useEffect(() => {
    if (status !== "disconnected") return;
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [status]);

  if (!import.meta.env.DEV) return null;

  const isDown = status === "disconnected";
  const downMs = isDown && lastDisconnectAt ? Date.now() - lastDisconnectAt : 0;
  const downSeconds = Math.max(0, Math.floor(downMs / 1000));
  const formatDuration = (totalSec: number) => {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}j ${m}m ${s}d`;
    if (m > 0) return `${m}m ${s}d`;
    return `${s}d`;
  };
  const durationLabel = formatDuration(downSeconds);
  const label = isDown ? `Dev terputus · ${durationLabel}` : "Dev tersambung";
  const title = isDown
    ? `Koneksi WebSocket Vite HMR terputus selama ${durationLabel}. Halaman akan reload otomatis saat pulih.`
    : lastConnectAt
      ? `Tersambung sejak ${new Date(lastConnectAt).toLocaleTimeString()}`
      : "Dev server tersambung";

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span
        role="status"
        aria-live="polite"
        title={title}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none transition-colors",
          isDown
            ? "border-destructive/40 bg-destructive/10 text-destructive"
            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        )}
      >
        <span
          className={cn(
            "inline-block h-1.5 w-1.5 rounded-full",
            isDown ? "bg-destructive animate-pulse" : "bg-emerald-500",
          )}
        />
        {label}
      </span>
      {isDown && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          title="Muat ulang halaman sekarang"
          className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive px-2 py-0.5 text-[10px] font-medium leading-none text-destructive-foreground transition-colors hover:bg-destructive/90 focus:outline-none focus:ring-2 focus:ring-destructive/40"
        >
          <RefreshCw className="h-3 w-3" />
          Muat ulang
        </button>
      )}
    </span>
  );
}

type ViteHotApi = {
  on?: (event: string, cb: (...args: unknown[]) => void) => void;
  off?: (event: string, cb: (...args: unknown[]) => void) => void;
};