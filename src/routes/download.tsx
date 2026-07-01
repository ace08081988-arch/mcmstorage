import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Download, Smartphone, MessageCircle, Loader2 } from "lucide-react";
import { getLatestApkVariants, type LatestApk } from "@/lib/apk.functions";
import { PublicHeader } from "@/components/PublicHeader";
import { PublicFooter } from "@/components/PublicFooter";

export const Route = createFileRoute("/download")({
  head: () => ({
    meta: [
      { title: "Unduh APK — MCM Storage & MCM Chat" },
      {
        name: "description",
        content:
          "Unduh APK Android MCM Storage (fitur lengkap) atau MCM Chat (khusus komunikasi).",
      },
      { property: "og:title", content: "Unduh APK — MCM Storage & MCM Chat" },
      {
        property: "og:description",
        content:
          "Unduh APK Android MCM Storage (fitur lengkap) atau MCM Chat (khusus komunikasi).",
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
  const fetchApk = useServerFn(getLatestApkVariants);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["latest-apk-variants"],
    queryFn: () => fetchApk(),
    staleTime: 60_000,
  });

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PublicHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-10">
        <div className="text-center">
          <h1 className="text-lg font-semibold">Unduh APK</h1>
          <p className="text-xs text-muted-foreground">
            Pilih varian aplikasi Android yang ingin dipasang.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat informasi APK...
          </div>
        ) : isError ? (
          <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
            <p>Tidak dapat memuat link unduhan.</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-2 text-xs font-semibold underline"
            >
              Coba lagi
            </button>
          </div>
        ) : (
          <>
            <ApkCard
              title="MCM Storage"
              subtitle="Fitur lengkap: gudang, ecer, hutang piutang, chat."
              accent="emerald"
              icon={<Smartphone className="h-6 w-6" />}
              apk={data?.storage ?? null}
            />
            <ApkCard
              title="MCM Chat"
              subtitle="Hanya komunikasi. Ringan, terpisah, akun sama."
              accent="sky"
              icon={<MessageCircle className="h-6 w-6" />}
              apk={data?.chat ?? null}
            />
            <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
              Setelah terunduh, buka berkas dan izinkan instalasi dari sumber tidak dikenal jika diminta.
              Kedua APK bisa dipasang berdampingan di satu HP.
            </p>
          </>
        )}
      </main>
    <PublicFooter />
    </div>
  );
}

function ApkCard({
  title,
  subtitle,
  icon,
  accent,
  apk,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  accent: "emerald" | "sky";
  apk: LatestApk;
}) {
  const badge =
    accent === "emerald"
      ? "bg-emerald-600/10 text-emerald-700 dark:text-emerald-300"
      : "bg-sky-600/10 text-sky-700 dark:text-sky-300";
  const btn =
    accent === "emerald"
      ? "bg-emerald-600 hover:bg-emerald-700"
      : "bg-sky-600 hover:bg-sky-700";
  return (
    <div className="w-full rounded-2xl border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <div className={`rounded-xl p-3 ${badge}`}>{icon}</div>
        <div>
          <h2 className="text-base font-semibold leading-tight">{title}</h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {!apk ? (
        <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
          APK belum tersedia. Silakan cek kembali nanti.
        </div>
      ) : (
        <>
          <a
            href={apk.url}
            className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow transition ${btn}`}
          >
            <Download className="h-4 w-4" />
            Unduh {title} ({apk.sizeMB ? `${apk.sizeMB} MB` : "ukuran ?"})
          </a>
          <dl className="mt-3 space-y-1 text-[11px] text-muted-foreground">
            {(apk.versionName || apk.versionCode !== null) && (
              <div className="flex justify-between gap-2">
                <dt>Versi</dt>
                <dd className="font-mono">
                  {apk.versionName ?? "?"}
                  {apk.versionCode !== null && (
                    <span className="ml-1 text-muted-foreground/70">
                      (build {apk.versionCode})
                    </span>
                  )}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <dt>Nama berkas</dt>
              <dd className="truncate font-mono">{apk.name}</dd>
            </div>
            {apk.updatedAt && (
              <div className="flex justify-between gap-2">
                <dt>Diperbarui</dt>
                <dd>{new Date(apk.updatedAt).toLocaleString("id-ID")}</dd>
              </div>
            )}
          </dl>
        </>
      )}
    </div>
  );
}