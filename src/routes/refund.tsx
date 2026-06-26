import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicFooter } from "@/components/PublicFooter";

export const Route = createFileRoute("/refund")({
  head: () => ({
    meta: [
      { title: "Kebijakan Pengembalian Dana — MCM Storage" },
      {
        name: "description",
        content:
          "MCM Storage menawarkan jaminan uang kembali 14 hari untuk pembayaran Pro via transfer bank.",
      },
      { property: "og:title", content: "Kebijakan Pengembalian Dana — MCM Storage" },
      {
        property: "og:description",
        content:
          "Pengembalian dana paket Pro MCM Storage dilakukan via transfer bank dalam 14 hari setelah pembayaran disetujui.",
      },
    ],
    links: [{ rel: "canonical", href: "https://mcmstorage.lovable.app/refund" }],
  }),
  component: RefundPage,
});

const UPDATED_AT = "26 Juni 2026";

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
          <Section title="Jaminan uang kembali 14 hari">
            <p>
              Kami menawarkan <strong>jaminan uang kembali 14 hari</strong>{" "}
              untuk setiap pembayaran paket Pro MCM Storage. Jika Anda tidak
              puas dengan layanan, Anda dapat meminta pengembalian dana penuh
              dalam waktu 14 hari sejak pembayaran Anda kami setujui, tanpa
              perlu menjelaskan alasan secara rinci.
            </p>
          </Section>

          <Section title="Cara meminta pengembalian dana">
            <p>
              Pembayaran Pro saat ini dilakukan melalui <strong>transfer
              bank ke rekening kami</strong> dan dikonfirmasi secara manual
              oleh admin. Untuk meminta pengembalian dana:
            </p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                Kirim email ke{" "}
                <a href="mailto:admin@mcmstorage.biz" className="underline">
                  admin@mcmstorage.biz
                </a>{" "}
                dari alamat email yang terdaftar pada akun Anda, atau hubungi
                admin kami via WhatsApp dari halaman{" "}
                <Link to="/langganan" className="underline">
                  Langganan
                </Link>
                .
              </li>
              <li>
                Sertakan tanggal pembayaran, nominal, dan nama bank pengirim
                supaya kami dapat memverifikasi transaksi dengan cepat.
              </li>
              <li>
                Sebutkan rekening tujuan pengembalian (nama bank, nomor
                rekening, dan nama pemilik) — disarankan sama dengan
                rekening pengirim untuk menghindari penundaan.
              </li>
            </ol>
          </Section>

          <Section title="Waktu pemrosesan">
            <p>
              Setelah permintaan kami setujui, dana akan ditransfer kembali
              ke rekening yang Anda berikan dalam waktu paling lama{" "}
              <strong>7 hari kerja</strong>. Biaya transfer antar bank (jika
              ada) ditanggung oleh penerima.
            </p>
          </Section>

          <Section title="Pembatalan langganan">
            <p>
              Anda dapat berhenti memperpanjang langganan kapan saja —
              cukup tidak melakukan pembayaran berikutnya. Karena kami tidak
              menyimpan data kartu Anda dan tidak melakukan tagihan otomatis,
              langganan Pro berakhir secara otomatis pada tanggal{" "}
              <em>period_end</em> yang ditampilkan di halaman Langganan.
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