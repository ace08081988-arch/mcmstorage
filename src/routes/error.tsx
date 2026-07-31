import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { friendlyError } from "@/lib/friendly-error";

const searchSchema = z.object({
  title: z.string().optional(),
  message: z.string().optional(),
  code: z.string().optional(),
  from: z.string().optional(),
  kind: z.enum(["auth", "data", "network", "unknown"]).optional(),
});

export const Route = createFileRoute("/error")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Terjadi kesalahan" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: ErrorPage,
});

function ErrorPage() {
  const { title, message, code, from, kind = "unknown" } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);

  const isSafeRelative = (s: string) => s.startsWith("/") && !s.startsWith("//");
  const retryTarget = from && isSafeRelative(from) ? from : kind === "auth" ? "/auth" : "/";

  async function handleRetry() {
    if (retrying) return;
    setRetrying(true);
    try {
      // Re-run all active loaders / queries so the failed fetch is retried.
      await router.invalidate();
      await navigate({ to: retryTarget as any, replace: true });
    } catch {
      // Last-resort fallback: hard reload the original page.
      if (typeof window !== "undefined") {
        window.location.href = isSafeRelative(retryTarget) ? retryTarget : "/";
      }
    } finally {
      setRetrying(false);
    }
  }

  const heading = title ?? (
    kind === "auth" ? "Gagal masuk / sesi berakhir"
    : kind === "data" ? "Gagal memuat data"
    : kind === "network" ? "Gangguan koneksi"
    : "Terjadi kesalahan"
  );

  const friendly = message
    ? friendlyError({ code, message })
    : "Terjadi kesalahan tak terduga.";

  const steps =
    kind === "auth" ? [
      "Pastikan email & kata sandi benar.",
      "Jika sesi berakhir, silakan masuk kembali.",
      "Coba reset kata sandi bila perlu.",
    ] : kind === "data" ? [
      "Tekan tombol Coba lagi di bawah.",
      "Periksa koneksi internet Anda.",
      "Jika masalah berlanjut, keluar lalu masuk kembali.",
    ] : kind === "network" ? [
      "Periksa koneksi internet (Wi-Fi / data seluler).",
      "Coba muat ulang halaman.",
      "Tunggu sebentar lalu coba lagi.",
    ] : [
      "Muat ulang halaman.",
      "Kembali ke beranda dan coba aksi sekali lagi.",
      "Jika terus berulang, hubungi admin.",
    ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto flex max-w-md flex-col gap-ms-4 p-ms-6">
        <div className="text-ms-4xl">⚠️</div>
        <h1 className="text-ms-xl font-bold">{heading}</h1>

        <div className="rounded-lg border bg-card p-ms-3 text-ms-sm">
          <div className="text-muted-foreground text-ms-xs">Pesan</div>
          <div className="font-medium">{friendly}</div>
          {code && (
            <div className="mt-1 text-ms-2xs text-muted-foreground">
              Kode referensi: <code>{code}</code>
            </div>
          )}
        </div>

        <div className="rounded-lg border bg-card p-ms-3">
          <div className="mb-2 text-ms-xs font-semibold">Langkah berikutnya</div>
          <ol className="list-decimal space-y-1 pl-5 text-ms-sm">
            {steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </div>

        <div className="flex flex-wrap gap-ms-2 pt-1">
          <button
            onClick={handleRetry}
            disabled={retrying}
            aria-busy={retrying}
            className="flex-1 rounded-md bg-primary px-ms-3 py-ms-2 text-ms-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {retrying ? "⏳ Mencoba ulang…" : "🔄 Coba lagi"}
          </button>
          <Link
            to="/"
            className="rounded-md border px-ms-3 py-ms-2 text-ms-sm hover:bg-accent"
          >
            🏠 Beranda
          </Link>
          {kind === "auth" && (
            <Link to="/auth" className="rounded-md border px-ms-3 py-ms-2 text-ms-sm hover:bg-accent">
              🔐 Masuk
            </Link>
          )}
        </div>

        <p className="text-ms-2xs text-muted-foreground">
          Detail teknis tidak ditampilkan untuk menjaga keamanan. Tim teknis dapat melihatnya di log.
        </p>
      </main>
    </div>
  );
}