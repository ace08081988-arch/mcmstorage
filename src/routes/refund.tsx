import { createFileRoute, Link } from "@tanstack/react-router";
import { canonical, socialMeta } from "@/lib/seo-meta";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";

export const Route = createFileRoute("/refund")({
  head: () => ({
    meta: socialMeta({
      title: "Kebijakan Pengembalian Dana — Ace Storage",
      description:
        "Ace Storage saat ini gratis dan tidak memproses pembayaran daring, sehingga tidak ada transaksi yang perlu dikembalikan.",
      url: "/refund",
    }),
    links: [canonical("/refund")],
  }),
  component: RefundPage,
});

const UPDATED_AT = "21 Juni 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="lux-card p-ms-5">
      <h2 className="text-ms-lg font-semibold text-foreground">{title}</h2>
      <div className="mt-2 space-ms-2 text-ms-sm text-muted-foreground">{children}</div>
    </section>
  );
}

function RefundPage() {
  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-ms-4 py-10">
        <header className="mb-6">
          <h1 className="text-ms-3xl font-extrabold tracking-tight text-foreground">
            Kebijakan Pengembalian Dana
          </h1>
          <p className="mt-2 text-ms-sm text-muted-foreground">
            Terakhir diperbarui: {UPDATED_AT} · Dioperasikan oleh{" "}
            <strong>Ace Storage</strong>
          </p>
        </header>

        <div className="space-ms-4">
          <Section title="Tidak ada pembayaran daring">
            <p>
              Saat ini Ace Storage <strong>tidak memungut biaya</strong> dan
              tidak memproses pembayaran daring di dalam aplikasi, sehingga
              tidak ada transaksi yang perlu dikembalikan.
            </p>
          </Section>

          <Section title="Jika nanti ada paket berbayar">
            <p>
              Bila paket berbayar diaktifkan kembali, kebijakan pengembalian
              dana beserta cara pengajuannya akan diumumkan lebih dulu di
              halaman ini sebelum pembayaran pertama dapat dilakukan.
            </p>
          </Section>

          <Section title="Pertanyaan">
            <p>
              Untuk pertanyaan umum tentang akun atau penggunaan aplikasi,
              hubungi{" "}
              <a href="mailto:admin@mcmstorage.biz" className="underline">
                admin@mcmstorage.biz
              </a>
              . Lihat juga{" "}
              <Link to="/terms" className="underline">
                Syarat &amp; Ketentuan
              </Link>{" "}
              kami.
            </p>
          </Section>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}