import { useEffect } from "react";
import { toast } from "sonner";

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
      toast.warning("Koneksi dev server terputus", {
        id: TOAST_ID,
        description: "Menunggu koneksi pulih, halaman akan dimuat ulang otomatis.",
        duration: Number.POSITIVE_INFINITY,
      });
    };

    const onConnect = () => {
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

type ViteHotApi = {
  on?: (event: string, cb: (...args: unknown[]) => void) => void;
  off?: (event: string, cb: (...args: unknown[]) => void) => void;
};