import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicFooter } from "@/components/PublicFooter";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Syarat & Ketentuan — MCM Storage" },
      {
        name: "description",
        content:
          "Syarat dan Ketentuan penggunaan MCM Storage, dioperasikan oleh BAROKAH RIZKI. Termasuk pengungkapan Paddle sebagai Merchant of Record.",
      },
      { property: "og:title", content: "Syarat & Ketentuan — MCM Storage" },
      {
        property: "og:description",
        content:
          "Syarat dan Ketentuan penggunaan MCM Storage, dioperasikan oleh BAROKAH RIZKI.",
      },
    ],
    links: [{ rel: "canonical", href: "https://mcmstorage.lovable.app/terms" }],
  }),
  component: TermsPage,
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

function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl px-4 py-10">
        <header className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Syarat &amp; Ketentuan
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Terakhir diperbarui: {UPDATED_AT}
          </p>
        </header>

        <div className="space-y-4">
          <Section title="1. Penjual">
            <p>
              Layanan MCM Storage (selanjutnya "<strong>Layanan</strong>")
              disediakan dan dioperasikan oleh <strong>BAROKAH RIZKI</strong>{" "}
              (selanjutnya "<strong>kami</strong>", "<strong>kita</strong>",
              atau "<strong>Penjual</strong>"). Dengan menggunakan Layanan,
              Anda menyatakan berkontrak dengan BAROKAH RIZKI.
            </p>
          </Section>

          <Section title="2. Penerimaan syarat">
            <p>
              Dengan terus mengakses, mendaftarkan akun, atau menggunakan
              Layanan, Anda menyatakan setuju terikat dengan Syarat &amp;
              Ketentuan ini. Jika Anda tidak menyetujuinya, mohon hentikan
              penggunaan Layanan.
            </p>
          </Section>

          <Section title="3. Deskripsi layanan">
            <p>
              MCM Storage adalah aplikasi pengelolaan pesanan harian, stok
              gudang, hutang–piutang, dan komunikasi cepat ke pelanggan/
              pemasok melalui WhatsApp dan email. Akses dibatasi untuk
              pengguna yang sudah login.
            </p>
          </Section>

          <Section title="4. Akun dan tanggung jawab pengguna">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Anda wajib memberikan data yang benar dan menjaga kerahasiaan
                kredensial akun.
              </li>
              <li>
                Anda bertanggung jawab atas seluruh aktivitas yang terjadi
                pada akun Anda.
              </li>
              <li>
                Jika Anda menggunakan Layanan atas nama organisasi, Anda
                menyatakan memiliki wewenang untuk mengikat organisasi
                tersebut pada syarat ini.
              </li>
            </ul>
          </Section>

          <Section title="5. Penggunaan yang dilarang">
            <p>Anda dilarang menggunakan Layanan untuk:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Kegiatan yang melanggar hukum, penipuan, atau spam.
              </li>
              <li>
                Melanggar hak kekayaan intelektual pihak lain.
              </li>
              <li>
                Mengganggu keamanan Layanan: penyebaran malware, scraping
                massal, probing kerentanan, atau usaha menerobos batasan
                teknis.
              </li>
              <li>
                Mengirim komunikasi yang tidak diminta dengan cara yang
                melanggar peraturan pemasaran setempat.
              </li>
            </ul>
          </Section>

          <Section title="6. Kekayaan intelektual">
            <p>
              Semua hak atas Layanan — termasuk perangkat lunak, dokumentasi,
              merek dagang, dan tampilan antarmuka — tetap menjadi milik
              BAROKAH RIZKI dan pemberi lisensinya. Anda diberikan lisensi
              terbatas, non-eksklusif, dan tidak dapat dialihkan untuk
              menggunakan Layanan sesuai paket yang Anda pilih.
            </p>
          </Section>

          <Section title="7. Pembayaran, langganan, dan pajak">
            <p>
              Untuk paket berbayar, pembayaran, penagihan, perpanjangan
              langganan, pajak, mata uang, faktur, pembatalan, dan
              pengembalian dana diproses oleh <strong>Paddle.com</strong>{" "}
              sebagai <strong>Merchant of Record</strong> kami. Dengan
              melakukan pembelian, Anda juga menyetujui{" "}
              <a
                href="https://www.paddle.com/legal/checkout-buyer-terms"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Paddle Checkout Buyer Terms
              </a>
              . Detail mengenai pengembalian dana ada di{" "}
              <Link to="/refund" className="underline">
                Kebijakan Pengembalian
              </Link>
              .
            </p>
          </Section>

          <Section title="8. Paddle sebagai Merchant of Record">
            <p>
              <em>
                Our order process is conducted by our online reseller
                Paddle.com. Paddle.com is the Merchant of Record for all our
                orders. Paddle provides all customer service inquiries and
                handles returns.
              </em>
            </p>
            <p>
              Proses pemesanan kami dijalankan oleh reseller daring kami,
              Paddle.com. Paddle.com adalah Merchant of Record untuk semua
              pesanan kami. Paddle menangani pertanyaan layanan pelanggan
              terkait pembayaran serta proses pengembalian dana.
            </p>
          </Section>

          <Section title="9. Ketersediaan layanan">
            <p>
              Layanan diberikan "sebagaimana adanya" dan "sebagaimana
              tersedia". Kami berusaha menjaga ketersediaan dan kinerja,
              namun tidak menjamin Layanan akan selalu tanpa gangguan, bebas
              kesalahan, atau tersedia 100% setiap saat.
            </p>
          </Section>

          <Section title="10. Konten pengguna">
            <p>
              Data operasional yang Anda masukkan (pesanan, stok, pemasok,
              dsb.) tetap milik Anda. Anda memberikan kami lisensi terbatas
              untuk menyimpan dan memproses konten tersebut semata-mata
              untuk menjalankan Layanan.
            </p>
          </Section>

          <Section title="11. Penangguhan dan pemutusan">
            <p>
              Kami dapat menangguhkan atau mengakhiri akses Anda ke Layanan
              bila terjadi:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Pelanggaran material atas syarat ini;</li>
              <li>Gagal bayar untuk paket berbayar;</li>
              <li>Indikasi risiko keamanan, penipuan, atau penyalahgunaan;</li>
              <li>
                Pelanggaran berulang atau serius terhadap kebijakan
                penggunaan.
              </li>
            </ul>
            <p>
              Setelah pemutusan, Anda diberi waktu wajar untuk mengekspor
              data sebelum dihapus, kecuali peraturan mewajibkan retensi
              lebih lama.
            </p>
          </Section>

          <Section title="12. Batasan tanggung jawab">
            <p>
              Sepanjang diizinkan hukum, tanggung jawab agregat kami atas
              klaim apa pun terkait Layanan dibatasi sebesar biaya yang Anda
              bayarkan kepada kami dalam 12 bulan terakhir. Kami tidak
              bertanggung jawab atas kerugian tidak langsung, konsekuensial,
              kehilangan keuntungan, atau kehilangan data. Pengecualian ini
              tidak berlaku untuk hal-hal yang tidak dapat dikecualikan
              menurut hukum.
            </p>
          </Section>

          <Section title="13. Hukum yang berlaku">
            <p>
              Syarat ini diatur dan ditafsirkan menurut hukum Republik
              Indonesia. Sengketa yang timbul akan diselesaikan terlebih
              dahulu secara musyawarah; apabila tidak tercapai, melalui
              pengadilan yang berwenang di Indonesia.
            </p>
          </Section>

          <Section title="14. Perubahan syarat">
            <p>
              Kami dapat memperbarui Syarat &amp; Ketentuan ini dari waktu
              ke waktu. Versi terbaru selalu tersedia di halaman ini dengan
              tanggal "Terakhir diperbarui" di bagian atas.
            </p>
          </Section>

          <Section title="15. Kontak">
            <p>
              Pertanyaan tentang syarat ini dapat dikirim ke{" "}
              <a href="mailto:admin@mcmstorage.biz" className="underline">
                admin@mcmstorage.biz
              </a>
              . Untuk pertanyaan terkait transaksi atau pengembalian dana,
              silakan hubungi Paddle melalui{" "}
              <a
                href="https://paddle.net"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                paddle.net
              </a>
              .
            </p>
          </Section>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}