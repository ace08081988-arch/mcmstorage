import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicFooter } from "@/components/PublicFooter";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Syarat & Ketentuan — MCM Storage" },
      {
        name: "description",
        content:
          "Syarat dan Ketentuan penggunaan MCM Storage, dioperasikan oleh BAROKAH RIZKI. Termasuk ketentuan langganan Pro dan pembayaran via transfer bank.",
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
              Paket Pro dibayar dengan <strong>transfer bank</strong> ke
              rekening resmi MCM Storage yang ditampilkan di halaman{" "}
              <Link to="/langganan" className="underline">
                Langganan
              </Link>
              . Setiap pembayaran dikonfirmasi secara manual oleh admin
              kami, dan langganan Anda akan diperpanjang setelah pembayaran
              disetujui. Kami tidak menyimpan data kartu Anda dan{" "}
              <strong>tidak melakukan tagihan otomatis</strong> — langganan
              berakhir secara otomatis di tanggal <em>period_end</em>{" "}
              kecuali Anda melakukan pembayaran berikutnya.
            </p>
            <p>
              Harga, periode tagihan, dan ketentuan pengembalian dana
              dijelaskan pada halaman{" "}
              <Link to="/pricing" className="underline">
                Harga
              </Link>{" "}
              dan{" "}
              <Link to="/refund" className="underline">
                Kebijakan Pengembalian
              </Link>
              . Pajak yang timbul atas pembayaran (jika ada) menjadi
              tanggung jawab masing-masing pihak sesuai peraturan yang
              berlaku di yurisdiksi Anda.
            </p>
          </Section>

          <Section title="8. Konfirmasi manual & bukti transfer">
            <p>
              Saat melakukan pembayaran, Anda diminta mengunggah bukti
              transfer (screenshot/PDF) melalui halaman Langganan. Bukti
              tersebut digunakan hanya untuk verifikasi pembayaran dan
              disimpan secara aman di penyimpanan privat kami. Admin dapat
              menolak pembayaran yang tidak dapat diverifikasi dan akan
              memberitahukan alasan penolakannya pada catatan transaksi
              Anda.
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
              hubungi admin kami melalui email atau WhatsApp dari halaman{" "}
              <Link to="/langganan" className="underline">
                Langganan
              </Link>
              .
            </p>
          </Section>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}