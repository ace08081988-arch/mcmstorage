import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { getApkVariantDetail } from "@/lib/apk.functions";
import { recordChatApkDownload } from "@/lib/chat-apk-history";
import { triggerApkDownload } from "@/lib/trigger-apk-download";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
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
  // Label progres bertahap yang tampil di dalam tombol saat unduhan
  // berjalan — memberi tahu pengguna proses sedang jalan tanpa hanya
  // menampilkan spinner.
  const [stage, setStage] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // Pre-fetch ketersediaan APK Chat sehingga tombol bisa tampil idle
  // "Belum tersedia" tanpa perlu memicu toast/dialog konfirmasi dulu.
  const availability = useQuery({
    queryKey: ["apk-availability", "chat"],
    queryFn: async () => {
      const detail = await fetchDetail({ data: { variant: "chat" } });
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

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function startDownload() {
    if (busy) return;
    setOpen(false);
    setBusy(true);
    setStage("Menghubungi server…");
    const loadingId = toast.loading("Menghubungi server unduhan…", {
      description: "Mengambil metadata APK MCM Chat terbaru.",
    });
    // Simpan info terakhir yang berhasil didapat supaya bila error terjadi
    // setelah metadata terbaca (mis. saat window.location.href), toast error
    // tetap bisa menyebut versi + ukuran berkas.
    let attemptLabel: string | null = null;
    let downloadTriggered = false;
    try {
      const detail = await fetchDetail({ data: { variant: "chat" } });
      // Ambil snapshot APK terbaru sekali, lalu turunkan url + label dari
      // objek yang sama supaya versi/ukuran yang ditampilkan di toast
      // selalu merujuk ke berkas yang benar-benar diunduh.
      const apk = detail?.latest;
      const url = apk?.url;
      if (!apk || !url) {
        // Kondisi kosong adalah status normal (belum ada rilis), bukan error.
        // Jangan tampilkan toast/teks merah di atas; tombol cukup kembali idle.
        setStage(null);
        toast.dismiss(loadingId);
        return;
      }
      const version = apk.versionName || apk.name || "terbaru";
      const sizeMB = apk.sizeMB ?? null;
      const sizeLabel =
        typeof sizeMB === "number" && Number.isFinite(sizeMB)
          ? `${sizeMB.toFixed(2)} MB`
          : "ukuran tidak diketahui";
      attemptLabel = `v${version} • ${sizeLabel}`;
      setStage(`Menyiapkan v${version}`);
      toast.loading(`Menyiapkan v${version} • ${sizeLabel}`, {
        id: loadingId,
        description: `Berkas: ${apk.name}`,
      });
      // Catat ke riwayat versi lokal sebelum navigasi.
      recordChatApkDownload({
        name: apk.name,
        versionName: apk.versionName ?? null,
        versionCode: apk.versionCode ?? null,
        url,
        sizeMB,
      });
      setStage("Memicu unduhan…");
      toast.loading(`Memicu unduhan v${version}…`, {
        id: loadingId,
        description: `Ukuran: ${sizeLabel}`,
      });
      const res = await triggerApkDownload(url, apk.name);
      downloadTriggered = true;
      toast.success(`Mulai mengunduh APK MCM Chat v${version} • ${sizeLabel}`, {
        id: loadingId,
        description:
          res.via === "capacitor-app-launcher"
            ? `Berkas: ${apk.name} — dibuka di browser sistem, cek folder Unduhan.`
            : `Berkas: ${apk.name} — cek folder Unduhan pada perangkat Anda.`,
      });
      setStage("Unduhan dipicu");
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
          action: {
            label: "Coba lagi",
            onClick: () => void startDownload(),
          },
        },
      );
      setStage("Gagal");
    } finally {
      if (downloadTriggered) {
        // Jangan langsung buka kunci tombol: unduhan APK memicu download
        // browser (bukan navigasi), sehingga tanpa jeda tombol langsung bisa
        // ditekan ulang dan berpotensi menembak unduhan ganda. Kunci selama
        // 5 detik memberi cukup waktu bagi browser untuk mulai mengunduh.
        setCooldown(5);
        setTimeout(() => {
          setBusy(false);
          setStage(null);
        }, 5000);
        return;
      }

      setCooldown(0);
      window.setTimeout(() => {
        setBusy(false);
        setStage(null);
      }, 300);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        disabled={busy || isChecking || isUnavailable}
        aria-label={
          busy
            ? `Unduhan APK MCM Chat sedang berjalan${stage ? `: ${stage}` : ""}${cooldown > 0 ? `, tunggu ${cooldown} detik` : ""}`
            : isUnavailable
              ? "APK MCM Chat belum tersedia"
              : isChecking
                ? "Memeriksa ketersediaan APK MCM Chat"
                : "Unduh APK MCM Chat versi terbaru"
        }
        aria-busy={busy}
        aria-live="polite"
        aria-disabled={busy || isChecking || isUnavailable}
        onClick={() => {
          if (!isAvailable) return;
          setOpen(true);
        }}
        className="group flex flex-col gap-0.5 rounded-md border bg-card px-3 py-2.5 text-left transition-all duration-150 hover:border-primary/40 hover:bg-accent hover:shadow-sm active:scale-[0.97] active:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
      >
        <span className="text-base leading-none">
          {busy || isChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : "💬"}
        </span>
        <span className="mt-1 text-xs font-semibold leading-tight">
          {busy
            ? stage ?? "Memproses…"
            : isChecking
              ? "Memeriksa…"
              : isUnavailable
                ? "Belum tersedia"
                : "Unduh APK Chat"}
        </span>
        <span className="text-[10px] leading-tight text-muted-foreground">
          {busy
            ? cooldown > 0
              ? `Menunggu browser… ${cooldown}s`
              : "Sedang berjalan…"
            : isChecking
              ? "Mengecek rilis terbaru…"
              : isUnavailable
                ? "Belum ada rilis APK Chat"
                : "Langsung unduh versi terbaru"}
        </span>
      </button>
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