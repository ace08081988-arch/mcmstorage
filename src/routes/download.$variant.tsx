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
  Copy,
  Check,
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
    <div className="p-ms-6 text-center text-ms-sm text-red-600">
      Gagal memuat detail rilis.
    </div>
  ),
  notFoundComponent: () => (
    <div className="p-ms-6 text-center text-ms-sm">Varian tidak ditemukan.</div>
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
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-ms-4 px-ms-4 py-ms-6">
        <Link
          to="/download"
          className="inline-flex w-fit items-center gap-ms-1 text-ms-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Kembali ke daftar unduhan
        </Link>

        {isLoading ? (
          <div className="flex items-center justify-center gap-ms-2 rounded-2xl border border-dashed p-ms-6 text-ms-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat detail rilis...
          </div>
        ) : isError || !data ? (
          <div className="rounded-2xl border border-red-300 bg-red-50 p-ms-4 text-ms-sm text-red-700 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
            <p>Tidak dapat memuat detail rilis.</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-2 text-ms-xs font-semibold underline"
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
                versionCode={data.latest.versionCode}
                onExpired={() => refetch()}
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
      ? "bg-success/10 text-success dark:text-success"
      : "bg-sky-600/10 text-sky-700 dark:text-sky-300";
  const btn =
    accent === "emerald"
      ? "bg-success hover:bg-success"
      : "bg-sky-600 hover:bg-sky-700";

  return (
    <div className="rounded-2xl border bg-card p-ms-5 shadow-sm">
      <div className="mb-3 flex items-center gap-ms-3">
        <div className={`rounded-xl p-ms-3 ${badge}`}>{icon}</div>
        <div>
          <h1 className="text-ms-base font-semibold leading-tight">{title}</h1>
          <p className="text-ms-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>

      {!latest ? (
        <div className="rounded-lg border border-dashed p-ms-4 text-center text-ms-xs text-muted-foreground">
          Belum ada rilis APK yang tersedia untuk varian ini.
        </div>
      ) : (
        <>
          {latest.belowMinimum && (
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
                .
                {min?.reason && (
                  <span className="mt-0.5 block opacity-80">
                    Alasan: {min.reason}
                  </span>
                )}
              </div>
            </div>
          )}
          <div className="flex items-stretch gap-ms-2">
            <a
              href={latest.url}
              className={`flex flex-1 items-center justify-center gap-ms-2 rounded-xl px-ms-4 py-ms-3 text-ms-sm font-semibold text-white shadow transition ${btn}`}
            >
              <Download className="h-4 w-4" />
              Unduh versi terbaru
              {latest.sizeMB ? ` (${latest.sizeMB} MB)` : ""}
            </a>
            <CopyLinkButton
              url={latest.url}
              label={`MCM Chat${latest.versionName ? ` v${latest.versionName}` : ""}`}
              variant="solid"
            />
          </div>
          <dl className="mt-3 space-y-1 text-ms-2xs text-muted-foreground">
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
    <section className="rounded-2xl border bg-card p-ms-5 shadow-sm">
      <h2 className="mb-2 text-ms-sm font-semibold">Changelog</h2>
      {changelog ? (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-ms-3 text-ms-2xs leading-relaxed text-foreground">
          {changelog}
        </pre>
      ) : (
        <p className="text-ms-2xs leading-relaxed text-muted-foreground">
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
      ? "text-success dark:text-success"
      : "text-sky-700 dark:text-sky-300";
  return (
    <section className="rounded-2xl border bg-card p-ms-5 shadow-sm">
      <h2 className="mb-2 text-ms-sm font-semibold">
        Riwayat rilis ({releases.length})
      </h2>
      {min && (min.min_version_name || min.min_version_code !== null) && (
        <p className="mb-2 flex items-center gap-ms-1 text-ms-2xs text-muted-foreground">
          <History className="h-3 w-3" />
          Minimum: {min.min_version_name ? `v${min.min_version_name}` : ""}
          {min.min_version_code !== null ? ` build ${min.min_version_code}` : ""}
        </p>
      )}
      <ul className="divide-y">
        {releases.map((r, i) => (
          <li key={r.name} className="flex items-center gap-ms-3 py-ms-2 text-ms-xs">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-ms-2">
                <span className="font-mono font-semibold">
                  {r.versionName ?? "?"}
                </span>
                {r.versionCode !== null && (
                  <span className="text-muted-foreground/70">
                    build {r.versionCode}
                  </span>
                )}
                {i === 0 && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-ms-2xs font-semibold uppercase text-muted-foreground">
                    terbaru
                  </span>
                )}
                {r.belowMinimum && (
                  <span className="inline-flex items-center gap-0.5 rounded bg-warning/15 px-1.5 py-0.5 text-ms-2xs font-semibold uppercase text-warning dark:text-warning">
                    <AlertTriangle className="h-2.5 w-2.5" />
                    lawas
                  </span>
                )}
              </div>
              <div className="text-ms-2xs text-muted-foreground">
                {r.updatedAt
                  ? new Date(r.updatedAt).toLocaleString("id-ID")
                  : "Tanggal tidak diketahui"}
                {r.sizeMB !== null ? ` • ${r.sizeMB} MB` : ""}
              </div>
            </div>
            {r.url && (
              <div className="flex shrink-0 items-center gap-ms-1">
                <a
                  href={r.url}
                  className={`text-ms-xs font-semibold ${
                    r.belowMinimum ? "text-warning dark:text-warning" : linkColor
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
                <CopyLinkButton
                  url={r.url}
                  label={`MCM Chat${r.versionName ? ` v${r.versionName}` : ""}`}
                  variant="ghost"
                />
              </div>
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
    <div className="flex justify-between gap-ms-2">
      <dt>{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

function CopyLinkButton({
  url,
  label,
  variant,
}: {
  url: string;
  label: string;
  variant: "solid" | "ghost";
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(`Link ${label} disalin — siap dibagikan.`);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Gagal menyalin link. Coba lagi.");
    }
  };
  if (variant === "solid") {
    return (
      <button
        type="button"
        onClick={onCopy}
        aria-label={`Salin link unduh ${label}`}
        title="Salin link unduh"
        className="inline-flex shrink-0 items-center justify-center gap-ms-1.5 rounded-xl border bg-background px-ms-3 text-ms-sm font-semibold hover:bg-accent"
      >
        {copied ? (
          <Check className="h-4 w-4 text-success" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
        <span className="hidden sm:inline">
          {copied ? "Tersalin" : "Salin"}
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={`Salin link unduh ${label}`}
      title="Salin link unduh"
      className="grid h-7 w-7 place-items-center rounded-md border hover:bg-accent"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-success" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </button>
  );
}

function ApkDownloadQr({
  url,
  versionName,
  versionCode,
  onExpired,
}: {
  url: string;
  versionName: string | null;
  versionCode: number | null;
  onExpired?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dataUrl, setDataUrl] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [now, setNow] = useState(() => Date.now());
  const expiredFiredRef = useRef<string | null>(null);

  // Ekstrak `exp` dari JWT signed URL Supabase Storage.
  const expiresAt = (() => {
    try {
      const u = new URL(url);
      const token = u.searchParams.get("token");
      if (!token) return null;
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const payload = JSON.parse(
        atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
      ) as { exp?: number };
      return typeof payload.exp === "number" ? payload.exp * 1000 : null;
    } catch {
      return null;
    }
  })();

  const remainingMs =
    expiresAt !== null ? Math.max(0, expiresAt - now) : null;
  const isExpired = remainingMs !== null && remainingMs <= 0;

  // Detak jam untuk countdown.
  useEffect(() => {
    if (expiresAt === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  // Auto-refresh saat halaman kembali fokus dan link sudah kedaluwarsa.
  useEffect(() => {
    if (expiresAt === null || !onExpired) return;
    const check = () => {
      if (Date.now() >= expiresAt && expiredFiredRef.current !== url) {
        expiredFiredRef.current = url;
        onExpired();
      }
    };
    check();
    const onFocus = () => check();
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [expiresAt, onExpired, url]);

  // Segera minta URL baru begitu countdown menyentuh nol.
  useEffect(() => {
    if (!isExpired || !onExpired) return;
    if (expiredFiredRef.current === url) return;
    expiredFiredRef.current = url;
    onExpired();
  }, [isExpired, onExpired, url]);

  const fmtRemaining = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };
  const warn = remainingMs !== null && remainingMs > 0 && remainingMs < 5 * 60_000;

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

  const qrFileName = (() => {
    const parts = ["mcm-chat-apk-qr"];
    if (versionName) parts.push(`v${versionName}`);
    if (versionCode !== null) parts.push(`b${versionCode}`);
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    parts.push(`${y}${m}${day}`);
    const raw = parts.join("-");
    // Sanitasi karakter yang tidak aman untuk nama berkas lintas OS.
    const safe = raw.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-");
    return `${safe}.png`;
  })();

  const savePng = () => {
    if (!dataUrl) {
      toast.error("QR belum siap. Coba lagi sebentar.");
      return;
    }
    try {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = qrFileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success("QR berhasil disimpan.", {
        description: qrFileName,
      });
    } catch {
      toast.error("Gagal menyimpan QR. Coba lagi.");
    }
  };

  return (
    <section className="rounded-2xl border bg-card p-ms-5 text-center shadow-sm">
      <div className="mb-2 flex items-center justify-center gap-ms-1.5 text-ms-sm font-semibold">
        <QrIcon className="h-4 w-4 text-sky-600" />
        Pindai untuk unduh APK Chat
      </div>
      <p className="mb-3 text-ms-2xs text-muted-foreground">
        Arahkan kamera HP ke QR code untuk membuka link unduh
        {versionName ? ` v${versionName}` : ""} langsung — tanpa mengetik URL.
      </p>
      <div className="flex justify-center">
        <canvas
          ref={canvasRef}
          className="rounded bg-white p-ms-2"
          aria-label="QR code unduh APK MCM Chat"
        />
      </div>
      {err && (
        <p className="mt-2 text-ms-2xs text-destructive">Gagal membuat QR: {err}</p>
      )}
      {remainingMs !== null && (
        <div
          className={`mt-3 inline-flex items-center gap-ms-1.5 rounded-full border px-ms-2.5 py-1 text-ms-2xs font-medium ${
            isExpired
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : warn
              ? "border-warning/40 bg-warning/10 text-warning dark:text-warning"
              : "border-success/40 bg-success/10 text-success dark:text-success"
          }`}
          role="status"
          aria-live="polite"
        >
          {isExpired ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              QR kedaluwarsa — memperbarui...
            </>
          ) : (
            <>
              <History className="h-3 w-3" />
              Kedaluwarsa dalam {fmtRemaining(remainingMs)}
            </>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={savePng}
        disabled={!dataUrl}
        className="mt-3 inline-flex items-center gap-ms-1 rounded-md border px-ms-2 py-1 text-ms-xs hover:bg-accent disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" /> Simpan QR (PNG)
      </button>
      <p className="mt-2 text-ms-2xs leading-relaxed text-muted-foreground/80">
        Link ini kedaluwarsa dalam ±1 jam. Muat ulang halaman untuk QR baru.
      </p>
    </section>
  );
}
