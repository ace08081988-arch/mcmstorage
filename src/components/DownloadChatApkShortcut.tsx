import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getApkVariantDetail } from "@/lib/apk.functions";
import { recordChatApkDownload } from "@/lib/chat-apk-history";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * Tombol pintas di menu Pengaturan untuk langsung mengunduh APK MCM
 * Chat terbaru tanpa membuka halaman `/download`. Menampilkan toast
 * untuk status mulai/berhasil/gagal supaya pengguna tahu unduhan sudah
 * dimulai atau ada error.
 */
export function DownloadChatApkShortcut() {
  const fetchDetail = useServerFn(getApkVariantDetail);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function startDownload() {
    if (busy) return;
    setOpen(false);
    setBusy(true);
    const loadingId = toast.loading("Menyiapkan unduhan APK MCM Chat…");
    // Simpan info terakhir yang berhasil didapat supaya bila error terjadi
    // setelah metadata terbaca (mis. saat window.location.href), toast error
    // tetap bisa menyebut versi + ukuran berkas.
    let attemptLabel: string | null = null;
    try {
      const detail = await fetchDetail({ data: { variant: "chat" } });
      // Ambil snapshot APK terbaru sekali, lalu turunkan url + label dari
      // objek yang sama supaya versi/ukuran yang ditampilkan di toast
      // selalu merujuk ke berkas yang benar-benar diunduh.
      const apk = detail?.latest;
      const url = apk?.url;
      if (!apk || !url) {
        toast.error("Belum ada APK MCM Chat yang tersedia.", {
          id: loadingId,
          description:
            "Server belum menyediakan berkas APK Chat terbaru. Coba lagi nanti atau hubungi admin.",
        });
        return;
      }
      const version = apk.versionName || apk.name || "terbaru";
      const sizeMB = apk.sizeMB ?? null;
      const sizeLabel =
        typeof sizeMB === "number" && Number.isFinite(sizeMB)
          ? `${sizeMB.toFixed(2)} MB`
          : "ukuran tidak diketahui";
      attemptLabel = `v${version} • ${sizeLabel}`;
      // Catat ke riwayat versi lokal sebelum navigasi.
      recordChatApkDownload({
        name: apk.name,
        versionName: apk.versionName ?? null,
        versionCode: apk.versionCode ?? null,
        url,
        sizeMB,
      });
      window.location.href = url;
      toast.success(`Mulai mengunduh APK MCM Chat v${version} • ${sizeLabel}`, {
        id: loadingId,
        description: `Berkas: ${apk.name} — cek folder Unduhan pada perangkat Anda.`,
      });
    } catch (e) {
      const err = e as { message?: string; name?: string; status?: number; code?: string };
      const detailParts = [
        err?.name && err.name !== "Error" ? err.name : null,
        typeof err?.status === "number" ? `status ${err.status}` : null,
        err?.code ? `kode ${err.code}` : null,
        err?.message,
      ].filter(Boolean);
      const errorDetail =
        detailParts.length > 0 ? detailParts.join(" • ") : "Penyebab tidak diketahui.";
      toast.error(
        attemptLabel
          ? `Gagal mengunduh APK MCM Chat ${attemptLabel}`
          : "Gagal memulai unduhan APK Chat.",
        {
          id: loadingId,
          description: errorDetail,
          duration: 8000,
        },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <button
          type="button"
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
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unduh APK MCM Chat?</AlertDialogTitle>
          <AlertDialogDescription>
            Versi terbaru APK MCM Chat akan langsung diunduh ke perangkat Anda.
            Lanjutkan?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction onClick={() => void startDownload()}>
            Ya, unduh
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}