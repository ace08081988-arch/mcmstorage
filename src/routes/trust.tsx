import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/trust")({
  head: () => ({
    meta: [
      { title: "Trust & Privacy — MCM Storage" },
      {
        name: "description",
        content:
          "Bagaimana MCM Storage menjaga data pesanan, pemasok, dan akun pengguna: autentikasi, akses, subprocessor, dan kontak.",
      },
      { property: "og:title", content: "Trust & Privacy — MCM Storage" },
      {
        property: "og:description",
        content:
          "Bagaimana MCM Storage menjaga data pesanan, pemasok, dan akun pengguna.",
      },
    ],
  }),
  component: TrustPage,
});

const TRUST_DOC_VERSION = "1.2.0";
const TRUST_DOC_EFFECTIVE_FROM = "2026-06-18";
const TRUST_DOC_UPDATED_AT = "2026-06-18";
const TRUST_DOC_TIMEZONE = "Asia/Jakarta";
const TRUST_DOC_TIMEZONE_LABEL = "WIB (UTC+7)";

function formatTrustDate(isoDate: string) {
  return new Date(`${isoDate}T00:00:00+07:00`).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TRUST_DOC_TIMEZONE,
  });
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <div className="mt-2 space-y-2 text-sm text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function TrustPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Trust &amp; Privacy
        </h1>
        <dl className="mt-3 grid gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground sm:grid-cols-3">
          <div>
            <dt className="font-medium text-foreground">Versi dokumen</dt>
            <dd>v{TRUST_DOC_VERSION}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Berlaku sejak</dt>
            <dd>
              <time dateTime={TRUST_DOC_EFFECTIVE_FROM}>
                {formatTrustDate(TRUST_DOC_EFFECTIVE_FROM)}
              </time>
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Terakhir diperbarui</dt>
            <dd>
              <time dateTime={TRUST_DOC_UPDATED_AT}>
                {formatTrustDate(TRUST_DOC_UPDATED_AT)}
              </time>
            </dd>
          </div>
          <div className="sm:col-span-3">
            <dt className="font-medium text-foreground">Zona waktu</dt>
            <dd>
              Semua tanggal di halaman ini mengikuti{" "}
              <strong>{TRUST_DOC_TIMEZONE_LABEL}</strong> —{" "}
              {TRUST_DOC_TIMEZONE}.
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-sm text-muted-foreground">
          Halaman ini dikelola oleh tim MCM Storage untuk menjawab pertanyaan
          umum seputar keamanan dan privasi aplikasi MCM Storage. Konten di
          sini adalah deskripsi praktik kami sendiri dan{" "}
          <strong>bukan sertifikasi atau verifikasi independen</strong> dari
          pihak ketiga.
        </p>
      </header>

      <div className="space-y-4">
        <Section title="Ringkasan kebijakan privasi">
          <p>
            MCM Storage memproses data operasional bisnis Anda (pesanan,
            stok, pemasok, pelanggan) hanya untuk menjalankan fitur
            aplikasi. Akses dibatasi ke akun pemilik melalui Row-Level
            Security, data tidak dijual atau dipakai untuk profil iklan,
            dan komunikasi keluar (WhatsApp/Email) dikirim dari akun
            perangkat Anda sendiri, bukan dari server kami.
          </p>
        </Section>

        <Section title="Tentang aplikasi">
          <p>
            MCM Storage adalah aplikasi internal untuk mengelola pesanan
            harian, stok gudang, dan komunikasi cepat ke pelanggan/pemasok
            melalui WhatsApp dan email. Akses dibatasi untuk pengguna yang
            login.
          </p>
        </Section>

        <Section title="Autentikasi & akses">
          <p>
            Login menggunakan email/password dan Google sign-in. Setiap data
            pesanan, pemasok, dan stok terikat ke akun pemiliknya melalui
            aturan akses di database (Row-Level Security), sehingga pengguna
            hanya dapat membaca dan mengubah data miliknya sendiri.
          </p>
        </Section>

        <Section title="Data yang kami simpan">
          <p>
            Data operasional yang Anda masukkan (pesanan, item gudang,
            pemasok, catatan, foto pesanan, alamat email CC/BCC pemasok)
            disimpan di backend kami untuk menjalankan fitur aplikasi. Kami
            tidak menjual data pengguna.
          </p>
        </Section>

        <Section title="Tujuan pemrosesan data">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Autentikasi & keamanan akun</strong> — memverifikasi
              login, menjaga sesi, dan membatasi akses ke data milik Anda.
            </li>
            <li>
              <strong>Operasional pesanan & gudang</strong> — menyimpan
              pesanan, item stok, pembelian, penjualan, dan riwayatnya.
            </li>
            <li>
              <strong>Komunikasi ke pelanggan/pemasok</strong> — menyiapkan
              pesan WhatsApp dan email (termasuk CC/BCC) yang Anda kirim
              dari perangkat sendiri.
            </li>
            <li>
              <strong>Keandalan layanan</strong> — log error teknis untuk
              memperbaiki bug dan menjaga aplikasi tetap berjalan.
            </li>
          </ul>
        </Section>

        <Section title="Dasar hukum pemrosesan">
          <p>
            Untuk pengguna di wilayah yang menerapkan UU Perlindungan Data
            Pribadi (UU PDP Indonesia) atau GDPR, dasar hukum pemrosesan
            kami adalah:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Pelaksanaan kontrak</strong> — memproses data yang
              diperlukan agar Anda dapat menggunakan akun dan fitur
              aplikasi.
            </li>
            <li>
              <strong>Kepentingan sah (legitimate interest)</strong> —
              menjaga keamanan akun, mencegah penyalahgunaan, dan menjaga
              kualitas layanan.
            </li>
            <li>
              <strong>Persetujuan</strong> — untuk data opsional yang Anda
              berikan secara sukarela (mis. foto pesanan, alamat CC/BCC
              tambahan); persetujuan dapat ditarik kapan saja.
            </li>
            <li>
              <strong>Kewajiban hukum</strong> — bila diwajibkan menyimpan
              atau mengungkap data oleh peraturan yang berlaku.
            </li>
          </ul>
        </Section>

        <Section title="Hak Anda atas data">
          <p>
            Anda berhak meminta akses, koreksi, pembaruan, pembatasan
            pemrosesan, penghapusan, atau ekspor data pribadi Anda, serta
            menarik persetujuan kapan saja. Permintaan akan kami tanggapi
            dalam waktu wajar sesuai peraturan yang berlaku.
          </p>
        </Section>

        <Section title="Subprocessor">
          <p>
            Untuk menjalankan layanan, MCM Storage menggunakan penyedia pihak
            ketiga berikut:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Lovable Cloud (Supabase)</strong> — hosting database,
              autentikasi, penyimpanan file, dan fungsi server.
            </li>
            <li>
              <strong>Google</strong> — penyedia login opsional (Google
              sign-in).
            </li>
            <li>
              <strong>Lovable</strong> — platform build &amp; hosting
              aplikasi.
            </li>
          </ul>
          <p>
            Daftar ini dapat berubah seiring berkembangnya aplikasi. Versi
            terbaru selalu ada di halaman ini.
          </p>
        </Section>

        <Section title="Komunikasi keluar (WhatsApp & Email)">
          <p>
            Tombol WhatsApp dan Email membuka aplikasi pesan/email di
            perangkat Anda dengan teks yang sudah disiapkan. Pengirimannya
            terjadi dari akun Anda sendiri di WhatsApp / klien email, bukan
            dari server MCM Storage.
          </p>
        </Section>

        <Section title="Cara menghubungi kami untuk permintaan data">
          <p>
            Untuk mengajukan permintaan terkait data Anda (akses, koreksi,
            penghapusan, ekspor, atau menarik persetujuan), gunakan salah
            satu kanal berikut:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Email:</strong>{" "}
              <a
                href="mailto:admin@mcmstorage.biz?subject=Permintaan%20Data%20Pribadi"
                className="underline"
              >
                admin@mcmstorage.biz
              </a>
            </li>
            <li>
              <strong>WhatsApp / kanal internal:</strong> hubungi admin MCM
              Storage yang biasa Anda gunakan untuk operasional harian.
            </li>
          </ul>
          <p>
            Mohon sertakan alamat email akun Anda dan jenis permintaan agar
            kami dapat memverifikasi identitas sebelum memproses. Kami
            berusaha menanggapi paling lama dalam <strong>30 hari</strong>{" "}
            sejak permintaan diterima.
          </p>
        </Section>
      </div>

      <footer className="mt-8 text-xs text-muted-foreground">
        <Link to="/" className="underline">
          ← Kembali ke beranda
        </Link>
      </footer>
    </main>
  );
}
