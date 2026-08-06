import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Copy, Loader2, Check, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { getApkVariantDetail } from "@/lib/apk.functions";

/**
 * Tombol untuk menyalin SEMUA link unduhan APK varian "chat" (versi
 * terbaru → terlama) ke clipboard dalam satu klik. Format teks:
 *
 *   Ace Chat APK — daftar unduhan
 *   • v1.2.3 (12 MB, 2025-01-02): https://...
 *   • v1.2.2 (12 MB, 2025-01-01): https://...
 */
export function CopyChatApkLinksButton({
  variant = "shortcut",
  className,
}: {
  variant?: "shortcut" | "inline";
  className?: string;
}) {
  const fetchDetail = useServerFn(getApkVariantDetail);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Pre-fetch ketersediaan APK Chat agar tombol dapat tampil idle
  // "Belum tersedia" tanpa memicu toast merah saat ditekan.
  const availability = useQuery({
    queryKey: ["apk-availability", "chat"],
    queryFn: async () => {
      const detail = await fetchDetail({ data: { variant: "chat" } });
      return (detail?.releases ?? []).length > 0;
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
    if (busy || isChecking) return;
    if (!isAvailable) {
      // Cek ulang ketersediaan tanpa menampilkan toast merah.
      void availability.refetch();
      return;
    }
    setBusy(true);
    const loadingId = toast.loading("Mengambil semua link APK Chat…");
    try {
      const detail = await fetchDetail({ data: { variant: "chat" } });
      const releases = detail?.releases ?? [];
      if (releases.length === 0) {
        // Tidak ada rilis untuk disalin = kondisi kosong normal.
        toast.dismiss(loadingId);
        return;
      }
      const header = `Ace Chat APK — daftar unduhan (${releases.length} versi)`;
      const lines = releases.map((r) => {
        const version = r.versionName || r.name;
        const size = r.sizeMB != null ? `${r.sizeMB} MB` : "?";
        const date = r.updatedAt ? new Date(r.updatedAt).toISOString().slice(0, 10) : "-";
        return `• ${version} (${size}, ${date}): ${r.url}`;
      });
      const text = [header, ...lines].join("\n");

      let ok = false;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        // Fallback textarea untuk browser lama/insecure context
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          ok = document.execCommand("copy");
          document.body.removeChild(ta);
        } catch {
          ok = false;
        }
      }

      if (!ok) {
        toast.error("Gagal menyalin ke clipboard. Coba lagi.", { id: loadingId });
        return;
      }

      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      toast.success(`${releases.length} link APK Chat disalin`, {
        id: loadingId,
        description: "Tempel (paste) di mana pun untuk membagikan.",
      });
    } catch (e) {
      toast.error((e as Error)?.message || "Gagal menyalin link APK Chat.", {
        id: loadingId,
      });
    } finally {
      setBusy(false);
    }
  }

  if (variant === "inline") {
    return (
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={busy || isChecking}
        aria-label={
          copied
            ? "Tersalin: semua link APK Ace Chat sudah disalin ke clipboard"
            : busy
              ? "Memproses: menyalin semua link APK Ace Chat, tombol dinonaktifkan sementara"
              : isChecking
                ? "Memeriksa ketersediaan APK Ace Chat, tombol dinonaktifkan sementara"
                : isUnavailable
                  ? "APK Ace Chat belum tersedia — ketuk untuk cek ulang"
                  : "Salin semua link APK Chat"
        }
        className={
          className ??
          "inline-flex items-center gap-ms-1.5 rounded-md border bg-card px-ms-3 py-1.5 text-ms-xs font-medium transition-all duration-150 hover:bg-accent hover:shadow-sm active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        {busy || isChecking ? (
          <Loader2 aria-hidden="true" className="busy-indicator h-3.5 w-3.5 animate-spin" />
        ) : copied ? (
          <Check aria-hidden="true" className="h-3.5 w-3.5 text-success" />
        ) : (
          <Copy aria-hidden="true" className="h-3.5 w-3.5" />
        )}
        <span>
          {copied
            ? "Tersalin"
            : isChecking
              ? "Memeriksa…"
              : isUnavailable
                ? "Belum tersedia"
                : "Salin semua link APK Chat"}
        </span>
      </button>
    );
  }

  return (
    <div className="relative h-full min-w-0">
      <button
      type="button"
      onClick={() => void onClick()}
      disabled={busy || isChecking}
      aria-busy={busy || isChecking}
      aria-label={
        copied
          ? "Tersalin: semua link APK Ace Chat sudah disalin ke clipboard"
          : busy
            ? "Memproses: menyalin semua link APK Ace Chat, tombol dinonaktifkan sementara"
            : isChecking
              ? "Memeriksa ketersediaan APK Ace Chat, tombol dinonaktifkan sementara"
              : isUnavailable
                ? "APK Ace Chat belum tersedia — ketuk untuk cek ulang"
                : "Salin semua link APK Chat"
      }
      className={
        className ??
        "group flex h-full w-full flex-col gap-0.5 rounded-xl border bg-card px-ms-3 py-ms-3 pr-14 text-left transition-all duration-150 hover:border-primary/40 hover:bg-accent hover:shadow-sm active:scale-[0.97] active:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
      }
    >
      <span className="text-ms-base leading-none">
        {busy || isChecking ? (
          <Loader2 aria-hidden="true" className="busy-indicator h-4 w-4 animate-spin" />
        ) : copied ? (
          <Check aria-hidden="true" className="h-4 w-4 text-success" />
        ) : (
          "📋"
        )}
      </span>
      <span className="mt-1 break-words text-ms-xs font-semibold leading-tight">
        {copied
          ? "Tersalin"
          : isChecking
            ? "Memeriksa…"
            : isUnavailable
              ? "Belum tersedia"
              : "Salin link APK Chat"}
      </span>
      <span className="break-words text-ms-2xs leading-tight text-muted-foreground">
        {isChecking
          ? "Mengecek rilis terbaru…"
          : isUnavailable
            ? "Ketuk untuk cek ulang"
            : "Semua versi sekaligus"}
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
          aria-label="Cek ulang ketersediaan APK Ace Chat"
          title="Cek ulang"
          className="absolute right-0.5 top-0.5 grid h-11 w-11 place-items-center rounded-full text-foreground/80 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw aria-hidden="true" className={(isChecking ? "busy-indicator animate-spin " : "") + "h-4 w-4"} />
        </button>
      ) : null}
      <span className="sr-only" role="status" aria-live="polite">
        {copied
          ? "Semua link APK Ace Chat sudah disalin"
          : busy
            ? "Menyalin link APK Ace Chat"
            : isChecking
              ? "Memeriksa ketersediaan APK Ace Chat"
              : isUnavailable
                ? "APK Ace Chat belum tersedia"
                : ""}
      </span>
    </div>
  );
}