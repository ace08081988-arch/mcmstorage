import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getApkVariantDetail } from "@/lib/apk.functions";

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
      window.location.href = url;
      toast.success(`Mulai mengunduh APK MCM Chat (${version})…`, {
        id: loadingId,
        description: "Cek folder Unduhan pada perangkat Anda.",
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
      className="group flex flex-col gap-0.5 rounded-md border bg-card px-3 py-2.5 text-left hover:border-primary/40 hover:bg-accent disabled:opacity-60"
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