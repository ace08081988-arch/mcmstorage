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
 *   MCM Chat APK — daftar unduhan
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
      const header = `MCM Chat APK — daftar unduhan (${releases.length} versi)`;
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
            ? "Tersalin: semua link APK MCM Chat sudah disalin ke clipboard"
            : busy
              ? "Memproses: menyalin semua link APK MCM Chat, tombol dinonaktifkan sementara"
              : isChecking
                ? "Memeriksa ketersediaan APK MCM Chat, tombol dinonaktifkan sementara"
                : isUnavailable
                  ? "APK MCM Chat belum tersedia — ketuk untuk cek ulang"
                  : "Salin semua link APK Chat"
        }
        className={
          className ??
          "inline-flex items-center gap-ms-1.5 rounded-md border bg-card px-ms-3 py-1.5 text-ms-xs font-medium transition-all duration-150 hover:bg-accent hover:shadow-sm active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        {busy || isChecking ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : copied ? (
          <Check className="h-3.5 w-3.5 text-success" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
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
    <div className="relative">
      <button
      type="button"
      onClick={() => void onClick()}
      disabled={busy || isChecking}
      aria-label={
        copied
          ? "Tersalin: semua link APK MCM Chat sudah disalin ke clipboard"
          : busy
            ? "Memproses: menyalin semua link APK MCM Chat, tombol dinonaktifkan sementara"
            : isChecking
              ? "Memeriksa ketersediaan APK MCM Chat, tombol dinonaktifkan sementara"
              : isUnavailable
                ? "APK MCM Chat belum tersedia — ketuk untuk cek ulang"
                : "Salin semua link APK Chat"
      }
      className={
        className ??
        "group flex flex-col gap-0.5 rounded-md border bg-card px-ms-3 py-ms-2.5 text-left transition-all duration-150 hover:border-primary/40 hover:bg-accent hover:shadow-sm active:scale-[0.97] active:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
      }
    >
      <span className="text-ms-base leading-none">
        {busy || isChecking ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : copied ? (
          <Check className="h-4 w-4 text-success" />
        ) : (
          "📋"
        )}
      </span>
      <span className="mt-1 text-ms-xs font-semibold leading-tight">
        {copied
          ? "Tersalin"
          : isChecking
            ? "Memeriksa…"
            : isUnavailable
              ? "Belum tersedia"
              : "Salin link APK Chat"}
      </span>
      <span className="text-ms-2xs leading-tight text-muted-foreground">
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
          aria-label="Cek ulang ketersediaan APK MCM Chat"
          title="Cek ulang"
          className="absolute right-0 top-0 grid min-h-11 min-w-11 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={"h-3.5 w-3.5 " + (isChecking ? "animate-spin" : "")} />
        </button>
      ) : null}
    </div>
  );
}