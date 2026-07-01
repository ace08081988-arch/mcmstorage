import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  Download,
  Smartphone,
  MessageCircle,
  Loader2,
  ChevronRight,
  Link2,
  Check,
  AlertTriangle,
} from "lucide-react";
import {
  getLatestApkVariants,
  type LatestApk,
  type MinSupported,
} from "@/lib/apk.functions";
import { PublicHeader } from "@/components/PublicHeader";
import { PublicFooter } from "@/components/PublicFooter";
import { useState } from "react";
import { toast } from "sonner";

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
              variant="storage"
              min={data?.minSupported.storage ?? null}
            />
            <ApkCard
              title="MCM Chat"
              subtitle="Hanya komunikasi. Ringan, terpisah, akun sama."
              accent="sky"
              icon={<MessageCircle className="h-6 w-6" />}
              apk={data?.chat ?? null}
              variant="chat"
              min={data?.minSupported.chat ?? null}
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
  variant,
  min,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  accent: "emerald" | "sky";
  apk: LatestApk;
  variant: "storage" | "chat";
  min: MinSupported | null;
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
          {apk.belowMinimum && (
            <div className="mb-3 flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[11px] leading-snug text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                <strong className="font-semibold">Build ini lebih lama</strong>{" "}
                dari minimum yang direkomendasikan
                {min?.min_version_name ? ` (v${min.min_version_name}` : ""}
                {min?.min_version_code !== null && min?.min_version_code !== undefined
                  ? ` build ${min.min_version_code})`
                  : min?.min_version_name
                    ? ")"
                    : ""}
                . Beberapa fitur mungkin tidak berjalan sebagaimana mestinya.
                {min?.reason && (
                  <span className="mt-0.5 block opacity-80">
                    Alasan: {min.reason}
                  </span>
                )}
              </div>
            </div>
          )}
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
          <Link
            to="/download/$variant"
            params={{ variant }}
            className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            Detail & changelog
            <ChevronRight className="h-3 w-3" />
          </Link>
          <CopyLinkButtons apk={apk} variant={variant} title={title} />
        </>
      )}
    </div>
  );
}

function CopyLinkButtons({
  apk,
  variant,
  title,
}: {
  apk: NonNullable<LatestApk>;
  variant: "storage" | "chat";
  title: string;
}) {
  const [copied, setCopied] = useState<"page" | "file" | null>(null);

  const doCopy = async (text: string, kind: "page" | "file", label: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(kind);
      toast.success(`${label} disalin`);
      setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1500);
    } catch {
      toast.error("Gagal menyalin link");
    }
  };

  const pageUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/download/${variant}`
      : `/download/${variant}`;

  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={() => doCopy(pageUrl, "page", "Link halaman")}
        className="flex items-center justify-center gap-1.5 rounded-lg border bg-background px-2 py-2 text-xs font-medium hover:bg-muted"
        aria-label={`Salin link halaman ${title}`}
      >
        {copied === "page" ? (
          <Check className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <Link2 className="h-3.5 w-3.5" />
        )}
        {copied === "page" ? "Tersalin" : "Salin link halaman"}
      </button>
      <button
        type="button"
        onClick={() => doCopy(apk.url, "file", "Link unduh langsung")}
        className="flex items-center justify-center gap-1.5 rounded-lg border bg-background px-2 py-2 text-xs font-medium hover:bg-muted"
        aria-label={`Salin link unduh langsung ${title}`}
        title="Berlaku ± 1 jam sebelum kedaluwarsa"
      >
        {copied === "file" ? (
          <Check className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <Link2 className="h-3.5 w-3.5" />
        )}
        {copied === "file" ? "Tersalin" : "Salin link file"}
      </button>
    </div>
  );
}