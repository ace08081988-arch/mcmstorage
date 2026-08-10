import { createFileRoute, Link } from "@tanstack/react-router";
import { canonical, socialMeta } from "@/lib/seo-meta";
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
  Sparkles,
  ShieldCheck,
  FolderDown,
  LogIn,
  Globe,
  RefreshCw,
  History,
  Trash2,
} from "lucide-react";
import {
  getLatestApkVariants,
  type LatestApk,
  type MinSupported,
} from "@/lib/apk.functions";
import { PublicHeader } from "@/components/PublicHeader";
import { PublicFooter } from "@/components/PublicFooter";
import { RouteLoadError } from "@/components/RouteLoadError";
import { Skeleton } from "@/components/ui/skeleton";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { trackApkDownload } from "@/lib/apk-download-track";
import { peekUserIdSync, scopedKey } from "@/lib/user-scoped-storage";

/** Satu entri riwayat salin: label yang dikenali user + teks aslinya. */
type CopyEntry = { label: string; text: string; at: number };

const COPY_HISTORY_MAX = 5;

function copyHistoryKey() {
  return scopedKey("mcm:download:copyHistory", peekUserIdSync());
}

function readCopyHistory(): CopyEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(copyHistoryKey());
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is CopyEntry =>
        !!e &&
        typeof e === "object" &&
        typeof (e as CopyEntry).label === "string" &&
        typeof (e as CopyEntry).text === "string",
    );
  } catch {
    return [];
  }
}

function writeCopyHistory(list: CopyEntry[]) {
  try {
    window.localStorage.setItem(copyHistoryKey(), JSON.stringify(list));
  } catch {
    /* private mode / kuota penuh — riwayat bersifat opsional */
  }
}

export const Route = createFileRoute("/download/")({
  head: () => ({
    meta: socialMeta({
      title: "Unduh APK — Ace Storage & Ace Chat",
      description:
        "Unduh APK Android Ace Storage (fitur lengkap) atau Ace Chat (khusus komunikasi).",
      url: "/download",
    }),
    links: [canonical("/download")],
  }),
  component: DownloadPage,
  errorComponent: ({ error }: { error: unknown }) => (
    <RouteLoadError error={error} message="Gagal memuat informasi unduhan." />
  ),
  notFoundComponent: () => (
    <div className="p-ms-6 text-center text-ms-sm">Halaman tidak ditemukan.</div>
  ),
});

/** Tombol salin cepat: link unduhan APK + link halaman (lokasi) saat ini. */
function QuickCopyBar({
  storageUrl,
  chatUrl,
}: {
  storageUrl: string | null;
  chatUrl: string | null;
}) {
  const [copied, setCopied] = useState<
    "apk" | "loc" | "storage" | "chat" | null
  >(null);
  const [history, setHistory] = useState<CopyEntry[]>([]);

  // Riwayat dibaca setelah mount agar aman terhadap SSR/hydration.
  useEffect(() => setHistory(readCopyHistory()), []);

  const remember = useCallback((label: string, text: string) => {
    if (!text) return;
    setHistory((prev) => {
      const next = [
        { label, text, at: Date.now() },
        ...prev.filter((e) => e.text !== text),
      ].slice(0, COPY_HISTORY_MAX);
      writeCopyHistory(next);
      return next;
    });
  }, []);

  const run = async (
    kind: "apk" | "loc" | "storage" | "chat",
    text: string,
    label: string,
  ) => {
    const ok = await copyToClipboard(text);
    if (!ok) {
      toast.error("Gagal menyalin link");
      return;
    }
    setCopied(kind);
    remember(label, text);
    toast.success(`${label} disalin`);
    setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1500);
  };

  const apkText = [
    storageUrl ? `Ace Storage: ${storageUrl}` : null,
    chatUrl ? `Ace Chat: ${chatUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const locUrl =
    typeof window !== "undefined" ? window.location.href : "/download";

  // Pesan siap kirim: link unduhan tiap varian + link halaman (lokasi).
  const waText = [
    "Halo! Berikut link aplikasi Ace Storage:",
    "",
    apkText || "(link APK belum tersedia)",
    "",
    `Halaman unduh: ${locUrl}`,
  ].join("\n");

  const openWa = async () => {
    // Salin dulu sebagai jaring pengaman: sebagian WhatsApp Android
    // mengabaikan teks prefill saat dibuka dari WebView.
    await copyToClipboard(waText);
    remember("Pesan WhatsApp (APK + lokasi)", waText);
    const url = `https://wa.me/?text=${encodeURIComponent(waText)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    toast.success("WhatsApp dibuka — pesan juga sudah disalin");
  };

  return (
    <div className="dl-fade-up flex flex-col gap-ms-2">
      {/* Salin per varian: hanya link produk yang dipilih, tanpa varian lain. */}
      <div className="grid grid-cols-1 gap-ms-2 min-[380px]:grid-cols-2">
        <button
          type="button"
          disabled={!storageUrl}
          onClick={() =>
            void run("storage", storageUrl ?? "", "Link Ace Storage")
          }
          className="flex min-h-11 items-center justify-center gap-ms-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-ms-2 text-ms-2xs font-semibold transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
          aria-label="Salin link APK Ace Storage saja"
        >
          {copied === "storage" ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-success" />
          ) : (
            <Smartphone className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate">
            {copied === "storage" ? "Tersalin" : "Salin link Storage"}
          </span>
        </button>
        <button
          type="button"
          disabled={!chatUrl}
          onClick={() => void run("chat", chatUrl ?? "", "Link Ace Chat")}
          className="flex min-h-11 items-center justify-center gap-ms-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-ms-2 text-ms-2xs font-semibold transition-colors hover:bg-sky-500/20 disabled:opacity-50"
          aria-label="Salin link APK Ace Chat saja"
        >
          {copied === "chat" ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-success" />
          ) : (
            <MessageCircle className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate">
            {copied === "chat" ? "Tersalin" : "Salin link Chat"}
          </span>
        </button>
      </div>
      <div className="grid grid-cols-1 gap-ms-2 min-[380px]:grid-cols-2">
      <button
        type="button"
        disabled={!apkText}
        onClick={() => void run("apk", apkText, "Link unduhan APK")}
        className="flex min-h-11 items-center justify-center gap-ms-1.5 rounded-lg border bg-background px-ms-2 text-ms-2xs font-semibold transition-colors hover:bg-muted disabled:opacity-50"
        aria-label="Salin semua link unduhan APK (Storage dan Chat)"
      >
        {copied === "apk" ? (
          <Check className="h-3.5 w-3.5 shrink-0 text-success" />
        ) : (
          <Link2 className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="truncate">
          {copied === "apk" ? "Tersalin" : "Salin semua link"}
        </span>
      </button>
      <button
        type="button"
        onClick={() => void run("loc", locUrl, "Link lokasi halaman")}
        className="flex min-h-11 items-center justify-center gap-ms-1.5 rounded-lg border bg-background px-ms-2 text-ms-2xs font-semibold transition-colors hover:bg-muted"
        aria-label="Salin link lokasi halaman ini"
      >
        {copied === "loc" ? (
          <Check className="h-3.5 w-3.5 shrink-0 text-success" />
        ) : (
          <Link2 className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="truncate">
          {copied === "loc" ? "Tersalin" : "Salin link lokasi"}
        </span>
      </button>
      </div>
      <button
        type="button"
        onClick={() => void openWa()}
        className="flex min-h-11 items-center justify-center gap-ms-1.5 rounded-lg bg-wa px-ms-3 text-ms-2xs font-semibold text-wa-foreground transition-opacity hover:opacity-90"
        aria-label="Buka WhatsApp dengan pesan berisi link unduhan dan link lokasi"
      >
        <MessageCircle className="h-4 w-4 shrink-0" />
        <span className="truncate">Kirim lewat WhatsApp</span>
      </button>
      {history.length > 0 && (
        <section
          aria-label="Riwayat tautan yang disalin"
          className="rounded-xl border border-dashed bg-muted/30 p-ms-2.5"
        >
          <div className="flex items-center justify-between gap-ms-2">
            <h3 className="flex items-center gap-ms-1.5 text-ms-2xs font-semibold text-muted-foreground">
              <History className="h-3.5 w-3.5 shrink-0" />
              Terakhir disalin
            </h3>
            <button
              type="button"
              onClick={() => {
                setHistory([]);
                writeCopyHistory([]);
                toast.success("Riwayat salin dihapus");
              }}
              className="is-inline-link inline-flex items-center gap-1 text-ms-2xs font-semibold text-muted-foreground hover:text-foreground"
              aria-label="Hapus riwayat tautan yang disalin"
            >
              <Trash2 className="h-3.5 w-3.5 shrink-0" /> Hapus
            </button>
          </div>
          <ul className="mt-ms-2 space-y-1.5">
            {history.map((e) => (
              <li key={`${e.text}-${e.at}`}>
                <button
                  type="button"
                  onClick={() => {
                    void copyToClipboard(e.text).then((ok) =>
                      ok
                        ? toast.success(`${e.label} disalin ulang`)
                        : toast.error("Gagal menyalin link"),
                    );
                  }}
                  className="flex w-full items-center gap-ms-2 rounded-lg border bg-background px-ms-2 py-1.5 text-left text-ms-2xs transition-colors hover:bg-muted"
                  aria-label={`Salin ulang ${e.label}`}
                >
                  <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {e.label}
                    </span>
                    <span className="block truncate font-mono text-muted-foreground">
                      {e.text.split("\n")[0]}
                    </span>
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {new Date(e.at).toLocaleTimeString("id-ID", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Salin teks ke clipboard dengan fallback textarea (Android WebView lama). */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  } catch {
    return false;
  }
}

function DownloadPage() {
  const fetchApk = useServerFn(getLatestApkVariants);
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["latest-apk-variants"],
    queryFn: () => fetchApk(),
    staleTime: 60_000,
  });

  return (
    <div data-dl-page className="flex min-h-dvh flex-col bg-background text-foreground">
      <PublicHeader />
      <main id="konten-utama" tabIndex={-1} className="mx-auto w-full max-w-md flex-1 px-ms-4 py-8">
        <div className="readable-panel flex flex-col gap-ms-4 p-ms-4">
        <div className="text-center">
          <h1 className="text-ms-base font-semibold tracking-tight">Unduh APK</h1>
          <p className="mt-0.5 text-ms-2xs text-muted-foreground">
            Pilih varian aplikasi Android yang ingin dipasang.
          </p>
        </div>

        <InstallFlow />

        {isLoading ? (
          <>
            <ApkCardSkeleton />
            <ApkCardSkeleton />
            <div className="sr-only" role="status">
              Memuat informasi APK…
            </div>
          </>
        ) : isError ? (
          <div
            role="alert"
            className="dl-fade-up rounded-2xl border border-destructive/40 bg-destructive/10 p-ms-4 text-ms-sm text-destructive"
          >
            <p>Tidak dapat memuat link unduhan.</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-2 inline-flex min-h-11 items-center text-ms-xs font-semibold underline underline-offset-4"
            >
              Coba lagi
            </button>
          </div>
        ) : (
          <>
            <ApkCard
              title="Ace Storage"
              subtitle="Fitur lengkap: gudang, ecer, hutang piutang, chat."
              accent="emerald"
              icon={<Smartphone className="h-6 w-6" />}
              apk={data?.storage ?? null}
              variant="storage"
              min={data?.minSupported.storage ?? null}
            />
            <ApkCard
              title="Ace Chat"
              subtitle="Hanya komunikasi. Ringan, terpisah, akun sama."
              accent="sky"
              icon={<MessageCircle className="h-6 w-6" />}
              apk={data?.chat ?? null}
              variant="chat"
              min={data?.minSupported.chat ?? null}
              highlight
            />
            <InstallDetail onRetry={() => refetch()} refreshing={isFetching} />
            <QuickCopyBar
              storageUrl={data?.storage?.url ?? null}
              chatUrl={data?.chat?.url ?? null}
            />
          </>
        )}
        </div>
      </main>
    <PublicFooter />
    </div>
  );
}

const STEPS = [
  {
    icon: Smartphone,
    title: "1. Pilih varian",
    body: "Ace Storage untuk operasional lengkap (gudang, ecer, hutang piutang, chat). Ace Chat kalau hanya butuh komunikasi. Keduanya boleh dipasang bersamaan di satu HP dengan akun yang sama.",
  },
  {
    icon: Download,
    title: "2. Unduh berkas APK",
    body: "Tekan tombol unduh pada kartu varian. Ukuran dan versi build ditampilkan di tombol supaya bisa dipastikan sebelum mengunduh.",
  },
  {
    icon: ShieldCheck,
    title: "3. Izinkan instalasi",
    body: "Android akan bertanya soal “sumber tidak dikenal”. Buka Izinkan dari sumber ini untuk aplikasi browser atau pengelola berkas yang dipakai, lalu kembali.",
  },
  {
    icon: FolderDown,
    title: "4. Pasang",
    body: "Buka berkas dari notifikasi unduhan atau folder Download, tekan Pasang, tunggu sampai selesai.",
  },
  {
    icon: LogIn,
    title: "5. Masuk akun",
    body: "Buka aplikasi, masuk dengan akun yang sama seperti di web. Semua data (stok, hutang piutang, chat) langsung tersinkron.",
  },
] as const;

function InstallFlow() {
  return (
    <section
      aria-labelledby="alur-pasang"
      className="rounded-2xl border bg-muted/40 p-ms-4"
    >
      <h2 id="alur-pasang" className="text-ms-sm font-semibold">
        Alur pemasangan
      </h2>
      <p className="mt-0.5 text-ms-2xs text-muted-foreground">
        Lima langkah, dari pilih varian sampai siap dipakai.
      </p>
      <ol className="mt-ms-3 space-y-ms-3">
        {STEPS.map((s) => {
          const Icon = s.icon;
          return (
            <li key={s.title} className="flex gap-ms-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-ms-xs font-semibold leading-tight">{s.title}</p>
                <p className="mt-0.5 text-ms-2xs leading-relaxed text-muted-foreground">
                  {s.body}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ApkCardSkeleton() {
  return (
    <div
      aria-hidden
      className="dl-fade-up w-full rounded-2xl border bg-card p-ms-4 shadow-sm sm:p-ms-5"
    >
      <div className="mb-ms-3 flex items-center gap-ms-3">
        <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3 w-full" />
        </div>
      </div>
      <Skeleton className="h-11 w-full rounded-xl" />
      <div className="mt-ms-3 space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
      <div className="mt-ms-3 grid grid-cols-1 gap-ms-2 min-[380px]:grid-cols-2">
        <Skeleton className="h-10 rounded-lg" />
        <Skeleton className="h-10 rounded-lg" />
      </div>
    </div>
  );
}

function InstallDetail({
  onRetry,
  refreshing = false,
}: {
  onRetry: () => void;
  refreshing?: boolean;
}) {
  return (
    <section className="dl-fade-up rounded-2xl border border-dashed bg-muted/30 p-ms-4">
      <h2 className="text-ms-sm font-semibold">Catatan penting</h2>
      <ul className="mt-ms-2 list-disc space-y-1 pl-4 text-ms-2xs leading-relaxed text-muted-foreground">
        <li>
          Kedua APK memakai identitas aplikasi berbeda, jadi bisa terpasang
          berdampingan tanpa saling menimpa.
        </li>
        <li>
          Memperbarui versi cukup pasang APK baru di atas yang lama — data di HP
          tidak terhapus.
        </li>
        <li>
          “Salin link file” hanya berlaku ± 1 jam. Untuk dibagikan ke orang lain,
          gunakan “Salin link halaman”.
        </li>
        <li>
          Jika muncul “Aplikasi tidak terpasang”, hapus dulu versi lama yang
          berasal dari sumber berbeda, lalu pasang ulang.
        </li>
      </ul>
      <div className="mt-ms-3 grid grid-cols-1 gap-ms-2 min-[380px]:grid-cols-2">
        <button
          type="button"
          onClick={onRetry}
          disabled={refreshing}
          className="inline-flex min-h-10 items-center justify-center gap-ms-1.5 rounded-lg border bg-background px-ms-2 text-ms-2xs font-medium transition-colors hover:bg-muted disabled:opacity-70"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 shrink-0 ${refreshing ? "animate-spin" : ""}`}
          />
          <span className="truncate">
            {refreshing ? "Memeriksa…" : "Periksa versi terbaru"}
          </span>
        </button>
        <Link
          to="/"
          className="inline-flex min-h-10 items-center justify-center gap-ms-1.5 rounded-lg border bg-background px-ms-2 text-ms-2xs font-medium transition-colors hover:bg-muted"
        >
          <Globe className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Pakai versi web dulu</span>
        </Link>
      </div>
    </section>
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
  highlight = false,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  accent: "emerald" | "sky";
  apk: LatestApk;
  variant: "storage" | "chat";
  min: MinSupported | null;
  highlight?: boolean;
}) {
  const [starting, setStarting] = useState(false);
  const badge =
    accent === "emerald"
      ? "bg-success/10 text-success dark:text-success"
      : "bg-sky-600/10 text-sky-700 dark:text-sky-300";
  const btn =
    accent === "emerald"
      ? "bg-success hover:bg-success"
      : "bg-sky-600 hover:bg-sky-700";
  return (
    <div
      className={`dl-fade-up relative w-full overflow-hidden rounded-2xl border bg-card p-ms-4 shadow-sm transition-shadow sm:p-ms-5 ${
        highlight
          ? "border-sky-400/70 ring-2 ring-sky-400/40 shadow-md dark:border-sky-500/50"
          : ""
      }`}
    >
      {highlight && (
        <span className="mb-ms-2 inline-flex max-w-full items-center gap-ms-1 rounded-full bg-sky-600 px-ms-2 py-0.5 text-ms-2xs font-semibold text-white shadow">
          <Sparkles className="h-3 w-3 shrink-0" />
          <span className="truncate">Baru — bisa dipasang bersama</span>
        </span>
      )}
      <div className="mb-ms-3 flex items-center gap-ms-3">
        <div className={`shrink-0 rounded-xl p-ms-2.5 ${badge}`}>{icon}</div>
        <div className="min-w-0">
          <h2 className="truncate text-ms-sm font-semibold leading-tight">
            {title}
          </h2>
          <p className="mt-0.5 text-ms-2xs leading-snug text-muted-foreground">
            {subtitle}
          </p>
        </div>
      </div>
      {!apk ? (
        <div className="rounded-lg border border-dashed bg-muted/40 p-ms-3 text-ms-2xs text-muted-foreground">
          <p className="font-semibold text-foreground">Build belum diunggah</p>
          <p className="mt-1 leading-relaxed">
            Varian ini belum punya berkas APK aktif. Sementara menunggu, jalankan{" "}
            {title} lewat versi web di browser — data dan akunnya sama persis.
          </p>
          <div className="mt-ms-3 grid grid-cols-1 gap-ms-2 min-[380px]:grid-cols-2">
            <Link
              to="/"
              className="inline-flex min-h-10 items-center justify-center gap-ms-1.5 rounded-lg border bg-background px-ms-2 font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Globe className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Buka versi web</span>
            </Link>
            <Link
              to="/download/$variant"
              params={{ variant }}
              className="inline-flex min-h-10 items-center justify-center gap-ms-1.5 rounded-lg border bg-background px-ms-2 font-medium text-foreground transition-colors hover:bg-muted"
            >
              <span className="truncate">Riwayat & changelog</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            </Link>
          </div>
        </div>
      ) : (
        <>
          {apk.belowMinimum && (
            <div className="mb-3 flex items-start gap-ms-1.5 rounded-lg border border-warning bg-warning p-ms-2.5 text-ms-2xs leading-snug text-warning dark:border-warning/60 dark:bg-warning/40 dark:text-warning">
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
            onClick={() => {
              trackApkDownload(variant, "button");
              setStarting(true);
              setTimeout(() => setStarting(false), 2500);
            }}
            aria-busy={starting}
            className={`flex min-h-11 w-full items-center justify-center gap-ms-2 rounded-xl px-ms-3 py-ms-2.5 text-center text-ms-xs font-semibold leading-snug text-white shadow transition-all duration-200 active:scale-[0.98] ${btn} ${starting ? "opacity-90" : ""}`}
          >
            {starting ? (
              <>
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                Menyiapkan unduhan…
              </>
            ) : (
              <>
                <Download className="h-4 w-4 shrink-0" />
                <span className="truncate">
                  Unduh {title} ({apk.sizeMB ? `${apk.sizeMB} MB` : "ukuran ?"})
                </span>
              </>
            )}
          </a>
          <dl className="mt-ms-3 space-y-1 text-ms-2xs text-muted-foreground">
            {(apk.versionName || apk.versionCode !== null) && (
              <div className="flex items-baseline justify-between gap-ms-2">
                <dt className="shrink-0">Versi</dt>
                <dd className="min-w-0 truncate text-right font-mono">
                  {apk.versionName ?? "?"}
                  {apk.versionCode !== null && (
                    <span className="ml-1 text-muted-foreground/70">
                      (build {apk.versionCode})
                    </span>
                  )}
                </dd>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-ms-2">
              <dt className="shrink-0">Nama berkas</dt>
              <dd className="min-w-0 truncate text-right font-mono">{apk.name}</dd>
            </div>
            {apk.updatedAt && (
              <div className="flex items-baseline justify-between gap-ms-2">
                <dt className="shrink-0">Diperbarui</dt>
                <dd className="min-w-0 truncate text-right">
                  {new Date(apk.updatedAt).toLocaleString("id-ID")}
                </dd>
              </div>
            )}
          </dl>
          <Link
            to="/download/$variant"
            params={{ variant }}
            className="mt-ms-3 inline-flex min-h-9 items-center gap-ms-1 text-ms-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            Detail & changelog
            <ChevronRight className="h-3 w-3 shrink-0" />
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
    <div className="mt-ms-3 grid grid-cols-1 gap-ms-2 min-[380px]:grid-cols-2">
      <button
        type="button"
        onClick={() => {
          trackApkDownload(variant, "copy_page");
          void doCopy(pageUrl, "page", "Link halaman");
        }}
        className="flex min-h-10 items-center justify-center gap-ms-1.5 rounded-lg border bg-background px-ms-2 text-ms-2xs font-medium transition-colors hover:bg-muted"
        aria-label={`Salin link halaman ${title}`}
      >
        {copied === "page" ? (
          <Check className="h-3.5 w-3.5 shrink-0 text-success" />
        ) : (
          <Link2 className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="truncate">
          {copied === "page" ? "Tersalin" : "Salin link halaman"}
        </span>
      </button>
      <button
        type="button"
        onClick={() => {
          trackApkDownload(variant, "copy_file");
          void doCopy(apk.url, "file", "Link unduh langsung");
        }}
        className="flex min-h-10 items-center justify-center gap-ms-1.5 rounded-lg border bg-background px-ms-2 text-ms-2xs font-medium transition-colors hover:bg-muted"
        aria-label={`Salin link unduh langsung ${title}`}
        title="Berlaku ± 1 jam sebelum kedaluwarsa"
      >
        {copied === "file" ? (
          <Check className="h-3.5 w-3.5 shrink-0 text-success" />
        ) : (
          <Link2 className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="truncate">
          {copied === "file" ? "Tersalin" : "Salin link file"}
        </span>
      </button>
    </div>
  );
}