import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getApkVariantDetail } from "@/lib/apk.functions";
import { triggerApkDownload } from "@/lib/trigger-apk-download";

/**
 * Tombol pintas di menu Pengaturan untuk langsung mengunduh APK MCM
 * Storage terbaru tanpa membuka halaman `/download`. Mengambil URL
 * signed langsung lewat server function `getApkVariantDetail` dan
 * memicu navigasi unduh di browser.
 */
export function DownloadStorageApkShortcut() {
  const fetchDetail = useServerFn(getApkVariantDetail);
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    const loadingId = toast.loading("Menyiapkan unduhan APK MCM Storage…");
    try {
      const detail = await fetchDetail({ data: { variant: "storage" } });
      const apk = detail?.latest;
      const url = apk?.url;
      if (!apk || !url) {
        // Belum ada rilis = status kosong normal, bukan error unduhan.
        // Jangan munculkan status/toast merah di atas.
        toast.dismiss(loadingId);
        return;
      }
      const version =
        apk.versionName || apk.name || "terbaru";
      const res = await triggerApkDownload(url, apk.name);
      toast.success(`Mulai mengunduh APK MCM Storage (${version})…`, {
        id: loadingId,
        description:
          res.via === "capacitor-app-launcher"
            ? "Dibuka di browser sistem — cek folder Unduhan pada perangkat."
            : "Cek folder Unduhan pada perangkat Anda.",
      });
    } catch (e) {
      const err = e as { message?: string; code?: string };
      toast.error(
        err?.message || "Gagal memulai unduhan APK.",
        {
          id: loadingId,
          description: err?.code ? `Kode: ${err.code}` : undefined,
          action: { label: "Coba lagi", onClick: () => void onClick() },
        },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={busy}
      aria-label="Unduh APK MCM Storage"
      className="group flex flex-col gap-0.5 rounded-md border bg-card px-3 py-2.5 text-left transition-all duration-150 hover:border-primary/40 hover:bg-accent hover:shadow-sm active:scale-[0.97] active:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
    >
      <span className="text-base leading-none">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "⬇️"}
      </span>
      <span className="mt-1 text-xs font-semibold leading-tight">
        Unduh APK Storage
      </span>
      <span className="text-[10px] leading-tight text-muted-foreground">
        Langsung unduh versi terbaru
      </span>
    </button>
  );
}