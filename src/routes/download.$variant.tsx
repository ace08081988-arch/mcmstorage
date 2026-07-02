import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Download,
  Loader2,
  MessageCircle,
  Smartphone,
  AlertTriangle,
  History,
  QrCode as QrIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  getApkVariantDetail,
  type ApkRelease,
  type ApkVariant,
  type ApkVariantDetail,
  type MinSupported,
} from "@/lib/apk.functions";
import { PublicHeader } from "@/components/PublicHeader";
import { PublicFooter } from "@/components/PublicFooter";

const VALID: ApkVariant[] = ["storage", "chat"];

export const Route = createFileRoute("/download/$variant")({
  beforeLoad: ({ params }) => {
    if (!VALID.includes(params.variant as ApkVariant)) throw notFound();
  },
  head: ({ params }) => {
    const title =
      params.variant === "chat"
        ? "Detail rilis MCM Chat"
        : "Detail rilis MCM Storage";
    return {
      meta: [
        { title: `${title} — Unduh APK` },
        {
          name: "description",
          content: `Versi, tanggal rilis, ukuran, dan changelog ${title.replace(
            "Detail rilis ",
            "",
          )}.`,
        },
        { property: "og:title", content: `${title} — Unduh APK` },
      ],
    };
  },
  component: DetailPage,
  errorComponent: () => (
    <div className="p-6 text-center text-sm text-red-600">
      Gagal memuat detail rilis.
    </div>
  ),
  notFoundComponent: () => (
    <div className="p-6 text-center text-sm">Varian tidak ditemukan.</div>
  ),
});

function DetailPage() {
  const { variant } = Route.useParams();
  const v = variant as ApkVariant;
  const fetchDetail = useServerFn(getApkVariantDetail);
  const { data, isLoading, isError, refetch } = useQuery<ApkVariantDetail>({
    queryKey: ["apk-variant-detail", v],
    queryFn: () => fetchDetail({ data: { variant: v } }),
    staleTime: 60_000,
  });

  const accent: "emerald" | "sky" = v === "chat" ? "sky" : "emerald";
  const Icon = v === "chat" ? MessageCircle : Smartphone;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PublicHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-6">
        <Link
          to="/download"
          className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Kembali ke daftar unduhan
        </Link>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat detail rilis...
          </div>
        ) : isError || !data ? (
          <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
            <p>Tidak dapat memuat detail rilis.</p>
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
            <HeaderCard
              title={data.title}
              subtitle={data.subtitle}
              accent={accent}
              icon={<Icon className="h-6 w-6" />}
              latest={data.latest}
              min={data.minSupported}
            />

            <ChangelogCard changelog={data.changelog} />

            {v === "chat" && data.latest?.url && (
              <ApkDownloadQr
                url={data.latest.url}
                versionName={data.latest.versionName}
              />
            )}

            <ReleaseHistoryCard
              releases={data.releases}
              accent={accent}
              min={data.minSupported}
            />
          </>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}

function HeaderCard({
  title,
  subtitle,
  icon,
  accent,
  latest,
  min,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  accent: "emerald" | "sky";
  latest: ApkRelease | null;
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
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <div className={`rounded-xl p-3 ${badge}`}>{icon}</div>
        <div>
          <h1 className="text-base font-semibold leading-tight">{title}</h1>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>

      {!latest ? (
        <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
          Belum ada rilis APK yang tersedia untuk varian ini.
        </div>
      ) : (
        <>
          {latest.belowMinimum && (
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
                .
                {min?.reason && (
                  <span className="mt-0.5 block opacity-80">
                    Alasan: {min.reason}
                  </span>
                )}
              </div>
            </div>
          )}
          <a
            href={latest.url}
            className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow transition ${btn}`}
          >
            <Download className="h-4 w-4" />
            Unduh versi terbaru
            {latest.sizeMB ? ` (${latest.sizeMB} MB)` : ""}
          </a>
          <dl className="mt-3 space-y-1 text-[11px] text-muted-foreground">
            {(latest.versionName || latest.versionCode !== null) && (
              <Row label="Versi">
                <span className="font-mono">
                  {latest.versionName ?? "?"}
                  {latest.versionCode !== null && (
                    <span className="ml-1 text-muted-foreground/70">
                      (build {latest.versionCode})
                    </span>
                  )}
                </span>
              </Row>
            )}
            {latest.updatedAt && (
              <Row label="Tanggal rilis">
                {new Date(latest.updatedAt).toLocaleString("id-ID")}
              </Row>
            )}
            {latest.sizeMB !== null && (
              <Row label="Ukuran">{latest.sizeMB} MB</Row>
            )}
            <Row label="Nama berkas">
              <span className="truncate font-mono">{latest.name}</span>
            </Row>
          </dl>
        </>
      )}
    </div>
  );
}

function ChangelogCard({ changelog }: { changelog: string | null }) {
  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold">Changelog</h2>
      {changelog ? (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-[11px] leading-relaxed text-foreground">
          {changelog}
        </pre>
      ) : (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Belum ada catatan changelog. Unggah berkas{" "}
          <span className="font-mono">changelog-storage.md</span> atau{" "}
          <span className="font-mono">changelog-chat.md</span> ke bucket rilis
          untuk menampilkan di sini.
        </p>
      )}
    </section>
  );
}

function ReleaseHistoryCard({
  releases,
  accent,
  min,
}: {
  releases: ApkRelease[];
  accent: "emerald" | "sky";
  min: MinSupported | null;
}) {
  if (releases.length === 0) return null;
  const linkColor =
    accent === "emerald"
      ? "text-emerald-700 dark:text-emerald-300"
      : "text-sky-700 dark:text-sky-300";
  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold">
        Riwayat rilis ({releases.length})
      </h2>
      {min && (min.min_version_name || min.min_version_code !== null) && (
        <p className="mb-2 flex items-center gap-1 text-[11px] text-muted-foreground">
          <History className="h-3 w-3" />
          Minimum: {min.min_version_name ? `v${min.min_version_name}` : ""}
          {min.min_version_code !== null ? ` build ${min.min_version_code}` : ""}
        </p>
      )}
      <ul className="divide-y">
        {releases.map((r, i) => (
          <li key={r.name} className="flex items-center gap-3 py-2 text-xs">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono font-semibold">
                  {r.versionName ?? "?"}
                </span>
                {r.versionCode !== null && (
                  <span className="text-muted-foreground/70">
                    build {r.versionCode}
                  </span>
                )}
                {i === 0 && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                    terbaru
                  </span>
                )}
                {r.belowMinimum && (
                  <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-2.5 w-2.5" />
                    lawas
                  </span>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {r.updatedAt
                  ? new Date(r.updatedAt).toLocaleString("id-ID")
                  : "Tanggal tidak diketahui"}
                {r.sizeMB !== null ? ` • ${r.sizeMB} MB` : ""}
              </div>
            </div>
            {r.url && (
              <a
                href={r.url}
                className={`shrink-0 text-xs font-semibold ${
                  r.belowMinimum ? "text-amber-700 dark:text-amber-300" : linkColor
                } hover:underline`}
                onClick={(e) => {
                  if (
                    r.belowMinimum &&
                    !window.confirm(
                      "Build ini di bawah minimum yang direkomendasikan dan mungkin tidak kompatibel. Tetap unduh?",
                    )
                  ) {
                    e.preventDefault();
                  }
                }}
              >
                Unduh
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-2">
      <dt>{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

function ApkDownloadQr({
  url,
  versionName,
}: {
  url: string;
  versionName: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dataUrl, setDataUrl] = useState<string>("");
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const el = canvasRef.current;
    if (!el || !url) return;
    // Lazy-load: `qrcode` mem-bundle deps Node-only yang meng-crash workerd SSR.
    import("qrcode")
      .then(({ default: QRCode }) =>
        QRCode.toCanvas(el, url, {
          width: 220,
          margin: 1,
          errorCorrectionLevel: "M",
        }),
      )
      .then(() => {
        if (cancelled) return;
        setErr("");
        try {
          setDataUrl(el.toDataURL("image/png"));
        } catch {
          /* ignore */
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const savePng = () => {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `mcm-chat-apk-qr${versionName ? `-v${versionName}` : ""}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success("QR code disimpan.");
  };

  return (
    <section className="rounded-2xl border bg-card p-5 text-center shadow-sm">
      <div className="mb-2 flex items-center justify-center gap-1.5 text-sm font-semibold">
        <QrIcon className="h-4 w-4 text-sky-600" />
        Pindai untuk unduh APK Chat
      </div>
      <p className="mb-3 text-[11px] text-muted-foreground">
        Arahkan kamera HP ke QR code untuk membuka link unduh
        {versionName ? ` v${versionName}` : ""} langsung — tanpa mengetik URL.
      </p>
      <div className="flex justify-center">
        <canvas
          ref={canvasRef}
          className="rounded bg-white p-2"
          aria-label="QR code unduh APK MCM Chat"
        />
      </div>
      {err && (
        <p className="mt-2 text-[11px] text-destructive">Gagal membuat QR: {err}</p>
      )}
      <button
        type="button"
        onClick={savePng}
        disabled={!dataUrl}
        className="mt-3 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" /> Simpan QR (PNG)
      </button>
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground/80">
        Link ini kedaluwarsa dalam ±1 jam. Muat ulang halaman untuk QR baru.
      </p>
    </section>
  );
}
