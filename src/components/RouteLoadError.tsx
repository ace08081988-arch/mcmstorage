import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { isChunkLoadError, recoverFromChunkError } from "@/lib/chunk-recovery";

/**
 * Fallback error untuk rute publik. Penyebab paling umum di WebView Android
 * bukan bug halaman, melainkan bundle basi (chunk lama sudah tidak ada di
 * server setelah deploy). Kasus itu dipulihkan otomatis dengan hard reload
 * (dibatasi anti-loop); sisanya menampilkan pesan + tombol muat ulang.
 */
export function RouteLoadError({
  error,
  message,
}: {
  error?: unknown;
  message: string;
}) {
  const stale = isChunkLoadError(error);
  const [recovering, setRecovering] = useState(stale);

  useEffect(() => {
    if (!stale) return;
    const ok = recoverFromChunkError(error);
    if (!ok) setRecovering(false);
  }, [stale, error]);

  if (recovering) {
    return (
      <div
        role="status"
        className="flex min-h-[40vh] flex-col items-center justify-center gap-ms-2 p-ms-6 text-center text-ms-sm text-muted-foreground"
      >
        <RefreshCw className="h-5 w-5 animate-spin" aria-hidden />
        Memuat ulang versi terbaru…
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="mx-auto flex max-w-sm flex-col items-center gap-ms-3 p-ms-6 text-center"
    >
      <p className="text-ms-sm text-destructive">{message}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex min-h-11 items-center gap-ms-1.5 rounded-lg border bg-background px-ms-3 text-ms-xs font-semibold transition-colors hover:bg-muted"
      >
        <RefreshCw className="h-4 w-4" aria-hidden /> Muat ulang
      </button>
    </div>
  );
}
