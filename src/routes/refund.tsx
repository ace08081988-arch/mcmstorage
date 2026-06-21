import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicFooter } from "@/components/PublicFooter";

export const Route = createFileRoute("/refund")({
  head: () => ({
    meta: [
      { title: "Kebijakan Pengembalian Dana — MCM Storage" },
      {
        name: "description",
        content:
          "MCM Storage menawarkan jaminan uang kembali 30 hari. Pengembalian dana diproses melalui Paddle (paddle.net).",
      },
      { property: "og:title", content: "Kebijakan Pengembalian Dana — MCM Storage" },
      {
        property: "og:description",
        content:
          "Jaminan uang kembali 30 hari untuk pembelian MCM Storage, diproses oleh Paddle.",
      },
    ],
    links: [{ rel: "canonical", href: "https://mcmstorage.lovable.app/refund" }],
  }),
  component: RefundPage,
});

const UPDATED_AT = "21 Juni 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <div className="mt-2 space-y-2 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}

function RefundPage() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl px-4 py-10">
        <header className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Kebijakan Pengembalian Dana
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Terakhir diperbarui: {UPDATED_AT} · Dioperasikan oleh{" "}
            <strong>BAROKAH RIZKI</strong>
          </p>
        </header>

        <div className="space-y-4">
          <Section title="Jaminan uang kembali 30 hari">
            <p>
              Kami menawarkan <strong>jaminan uang kembali 30 hari</strong>{" "}
              untuk setiap pembelian paket berbayar MCM Storage. Jika Anda
              tidak puas dengan layanan, Anda dapat meminta pengembalian dana
              penuh dalam waktu 30 hari sejak tanggal pembelian, tanpa perlu
              menjelaskan alasan secara rinci.
            </p>
          </Section>

          <Section title="Cara meminta pengembalian dana">
            <p>
              Semua transaksi diproses oleh <strong>Paddle.com</strong>{" "}
              sebagai Merchant of Record kami. Permintaan pengembalian dana
              dilakukan melalui Paddle:
            </p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                Buka{" "}
                <a
                  href="https://paddle.net"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  paddle.net
                </a>{" "}
                dan masukkan email yang Anda gunakan saat membayar.
              </li>
              <li>
                Pilih transaksi MCM Storage yang ingin Anda batalkan, lalu
                ajukan permintaan pengembalian dana.
              </li>
              <li>
                Sebagai alternatif, Anda juga dapat menghubungi kami di{" "}
                <a href="mailto:admin@mcmstorage.biz" className="underline">
                  admin@mcmstorage.biz
                </a>{" "}
                dan kami akan meneruskan permintaan Anda ke Paddle.
              </li>
            </ol>
          </Section>

          <Section title="Waktu pemrosesan">
            <p>
              Setelah permintaan disetujui, Paddle umumnya memproses
              pengembalian dana dalam waktu 3–10 hari kerja, tergantung
              metode pembayaran dan bank penerbit. Dana akan dikembalikan ke
              metode pembayaran asli.
            </p>
          </Section>

          <Section title="Pembatalan langganan">
            <p>
              Anda dapat membatalkan langganan kapan saja melalui portal
              pelanggan Paddle. Setelah dibatalkan, langganan tetap aktif
              hingga akhir periode tagihan yang sudah dibayarkan, dan tidak
              akan diperpanjang otomatis pada periode berikutnya.
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