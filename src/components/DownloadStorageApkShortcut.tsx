import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
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

  const availability = useQuery({
    queryKey: ["apk-availability", "storage"],
    queryFn: async () => {
      const detail = await fetchDetail({ data: { variant: "storage" } });
      return !!detail?.latest?.url;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 1,
  });
  const isChecking = availability.isLoading || availability.isFetching;
  const isAvailable = availability.data === true;
  const isUnavailable = availability.isSuccess && availability.data === false;

  async function onClick() {
    if (busy || !isAvailable) return;
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
    <div className="relative h-full min-w-0">
    <button
      type="button"
      onClick={() => {
        if (busy || isChecking) return;
        if (!isAvailable) {
          void availability.refetch();
          return;
        }
        void onClick();
      }}
      disabled={busy}
      aria-disabled={busy}
      aria-busy={busy || isChecking}
      aria-label={
        isUnavailable
          ? "APK MCM Storage belum tersedia — ketuk untuk cek ulang"
          : isChecking
            ? "Memeriksa ketersediaan APK MCM Storage"
            : "Unduh APK MCM Storage"
      }
      className="group flex h-full w-full flex-col gap-0.5 rounded-xl border bg-card px-ms-3 py-ms-3 pr-14 text-left transition-all duration-150 hover:border-primary/40 hover:bg-accent hover:shadow-sm active:scale-[0.97] active:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
    >
      <span className="text-ms-base leading-none">
        {busy || isChecking ? <Loader2 aria-hidden="true" className="busy-indicator h-4 w-4 animate-spin" /> : "⬇️"}
      </span>
      <span className="mt-1 break-words text-ms-xs font-semibold leading-tight">
        {isChecking
          ? "Memeriksa…"
          : isUnavailable
            ? "Belum tersedia"
            : "Unduh APK Storage"}
      </span>
      <span className="break-words text-ms-2xs leading-tight text-muted-foreground">
        {isChecking
          ? "Mengecek rilis terbaru…"
          : isUnavailable
            ? "Ketuk untuk cek ulang"
            : "Langsung unduh versi terbaru"}
      </span>
    </button>
    {isUnavailable && !busy ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void availability.refetch();
        }}
        disabled={isChecking}
        aria-label="Cek ulang ketersediaan APK MCM Storage"
        title="Cek ulang"
        className="absolute right-0.5 top-0.5 grid h-11 w-11 place-items-center rounded-full text-foreground/80 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
      >
        <RefreshCw aria-hidden="true" className={(isChecking ? "busy-indicator animate-spin " : "") + "h-4 w-4"} />
      </button>
    ) : null}
    <span className="sr-only" role="status" aria-live="polite">
      {busy
        ? "Unduhan APK MCM Storage sedang diproses"
        : isChecking
          ? "Memeriksa ketersediaan APK MCM Storage"
          : isUnavailable
            ? "APK MCM Storage belum tersedia"
            : ""}
    </span>
    </div>
  );
}