import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getApkVariantDetail } from "@/lib/apk.functions";
import { recordChatApkDownload } from "@/lib/chat-apk-history";

/**
 * Tombol pintas di menu Pengaturan untuk langsung mengunduh APK MCM
 * Chat terbaru tanpa membuka halaman `/download`. Menampilkan toast
 * untuk status mulai/berhasil/gagal supaya pengguna tahu unduhan sudah
 * dimulai atau ada error.
 */
export function DownloadChatApkShortcut() {
  const fetchDetail = useServerFn(getApkVariantDetail);
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    const loadingId = toast.loading("Menyiapkan unduhan APK MCM Chat…");
    try {
      const detail = await fetchDetail({ data: { variant: "chat" } });
      const url = detail?.latest?.url;
      if (!url) {
        toast.error("Belum ada APK MCM Chat yang tersedia.", { id: loadingId });
        return;
      }
      const version =
        detail?.latest?.versionName || detail?.latest?.name || "terbaru";
      const sizeMB = detail?.latest?.sizeMB ?? null;
      const sizeLabel =
        typeof sizeMB === "number" && Number.isFinite(sizeMB)
          ? `${sizeMB.toFixed(2)} MB`
          : "ukuran tidak diketahui";
      // Catat ke riwayat versi lokal sebelum navigasi.
      if (detail?.latest) {
        recordChatApkDownload({
          name: detail.latest.name,
          versionName: detail.latest.versionName ?? null,
          versionCode: detail.latest.versionCode ?? null,
          url,
          sizeMB: detail.latest.sizeMB ?? null,
        });
      }
      window.location.href = url;
      toast.success(`Mulai mengunduh APK MCM Chat v${version} • ${sizeLabel}`, {
        id: loadingId,
        description: `Berkas: ${detail?.latest?.name ?? "APK Chat"} — cek folder Unduhan pada perangkat Anda.`,
      });
    } catch (e) {
      toast.error((e as Error)?.message || "Gagal memulai unduhan APK Chat.", {
        id: loadingId,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={busy}
      aria-label="Unduh APK MCM Chat"
      className="group flex flex-col gap-0.5 rounded-md border bg-card px-3 py-2.5 text-left transition-all duration-150 hover:border-primary/40 hover:bg-accent hover:shadow-sm active:scale-[0.97] active:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
    >
      <span className="text-base leading-none">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "💬"}
      </span>
      <span className="mt-1 text-xs font-semibold leading-tight">
        Unduh APK Chat
      </span>
      <span className="text-[10px] leading-tight text-muted-foreground">
        Langsung unduh versi terbaru
      </span>
    </button>
  );
}