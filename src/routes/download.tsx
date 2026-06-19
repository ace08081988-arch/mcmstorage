import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Download, Smartphone, Loader2 } from "lucide-react";
import { getLatestApk } from "@/lib/apk.functions";

export const Route = createFileRoute("/download")({
  head: () => ({
    meta: [
      { title: "Unduh APK MCM Storage" },
      {
        name: "description",
        content:
          "Unduh aplikasi Android MCM Storage untuk mengelola gudang dari ponsel.",
      },
      { property: "og:title", content: "Unduh APK MCM Storage" },
      {
        property: "og:description",
        content:
          "Unduh aplikasi Android MCM Storage untuk mengelola gudang dari ponsel.",
      },
    ],
  }),
  component: DownloadPage,
  errorComponent: () => (
    <div className="p-6 text-center text-sm text-red-600">
      Gagal memuat informasi unduhan.
    </div>
  ),
  notFoundComponent: () => (
    <div className="p-6 text-center text-sm">Halaman tidak ditemukan.</div>
  ),
});

function DownloadPage() {
  const fetchApk = useServerFn(getLatestApk);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["latest-apk"],
    queryFn: () => fetchApk(),
    staleTime: 60_000,
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 py-10">
      <div className="w-full rounded-2xl border bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-xl bg-emerald-600/10 p-3 text-emerald-700 dark:text-emerald-300">
            <Smartphone className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">
              MCM Storage untuk Android
            </h1>
            <p className="text-xs text-muted-foreground">
              Unduh APK terbaru langsung ke ponsel Anda.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat informasi APK...
          </div>
        ) : isError ? (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
            <p>Tidak dapat memuat link unduhan.</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-2 text-xs font-semibold underline"
            >
              Coba lagi
            </button>
          </div>
        ) : !data ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Belum ada APK yang tersedia. Silakan periksa kembali nanti.
          </div>
        ) : (
          <>
            <a
              href={data.url}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow transition hover:bg-emerald-700"
            >
              <Download className="h-4 w-4" />
              Unduh APK ({data.sizeMB ? `${data.sizeMB} MB` : "ukuran ?"})
            </a>
            <dl className="mt-4 space-y-1 text-xs text-muted-foreground">
              <div className="flex justify-between gap-2">
                <dt>Nama berkas</dt>
                <dd className="truncate font-mono">{data.name}</dd>
              </div>
              {data.updatedAt && (
                <div className="flex justify-between gap-2">
                  <dt>Diperbarui</dt>
                  <dd>
                    {new Date(data.updatedAt).toLocaleString("id-ID")}
                  </dd>
                </div>
              )}
            </dl>
            <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
              Setelah terunduh, buka berkas dan izinkan instalasi dari sumber
              tidak dikenal jika diminta.
            </p>
          </>
        )}
      </div>
    </main>
  );
}