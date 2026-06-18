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
        <p className="mt-2 text-sm text-muted-foreground">
          Halaman ini dikelola oleh tim MCM Storage untuk menjawab pertanyaan
          umum seputar keamanan dan privasi aplikasi MCM Storage. Konten di
          sini adalah deskripsi praktik kami sendiri dan{" "}
          <strong>bukan sertifikasi atau verifikasi independen</strong> dari
          pihak ketiga.
        </p>
      </header>

      <div className="space-y-4">
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

        <Section title="Permintaan data & kontak">
          <p>
            Untuk pertanyaan terkait data akun Anda, koreksi data, atau
            permintaan penghapusan akun, silakan hubungi admin MCM Storage
            melalui kanal internal yang biasa Anda gunakan.
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
