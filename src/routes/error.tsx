import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
  head: () => ({ meta: [{ title: "Terjadi kesalahan" }] }),
  component: ErrorPage,
});

function ErrorPage() {
  const { title, message, code, from, kind = "unknown" } = Route.useSearch();
  const navigate = useNavigate();

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
      <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
        <div className="text-4xl">⚠️</div>
        <h1 className="text-xl font-bold">{heading}</h1>

        <div className="rounded-lg border bg-card p-3 text-sm">
          <div className="text-muted-foreground text-xs">Pesan</div>
          <div className="font-medium">{friendly}</div>
          {code && (
            <div className="mt-1 text-[10px] text-muted-foreground">
              Kode referensi: <code>{code}</code>
            </div>
          )}
        </div>

        <div className="rounded-lg border bg-card p-3">
          <div className="mb-2 text-xs font-semibold">Langkah berikutnya</div>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={() => {
              if (from) navigate({ to: from as any });
              else window.location.reload();
            }}
            className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            🔄 Coba lagi
          </button>
          <Link
            to="/"
            className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
          >
            🏠 Beranda
          </Link>
          {kind === "auth" && (
            <Link to="/auth" className="rounded-md border px-3 py-2 text-sm hover:bg-accent">
              🔐 Masuk
            </Link>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Detail teknis tidak ditampilkan untuk menjaga keamanan. Tim teknis dapat melihatnya di log.
        </p>
      </main>
    </div>
  );
}