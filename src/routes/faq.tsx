import { createFileRoute, Link } from "@tanstack/react-router";
import { canonical, socialMeta } from "@/lib/seo-meta";

import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";
import { Button } from "@/components/ui/button";

const TITLE = "FAQ Ace Storage — Paket gratis, cara order, & kebijakan";
const DESC =
  "Jawaban singkat soal paket gratis Ace Storage, cara memesan akses lewat WhatsApp, dan kebijakan setelah pembayaran daring dihentikan.";

const FAQ: { q: string; a: string }[] = [
  {
    q: "Apakah Ace Storage benar-benar gratis?",
    a: "Ya. Saat ini seluruh fitur terbuka tanpa biaya bulanan, tanpa kartu kredit, dan tanpa fitur yang dikunci paywall.",
  },
  {
    q: "Bagaimana cara memesan akses?",
    a: "Buat akun lewat halaman Masuk, lalu hubungi admin melalui WhatsApp untuk penyiapan ruang toko Anda. Bila belum punya kontak admin, kirim email ke admin@mcmstorage.biz dan kami balas dengan nomor WhatsApp resmi.",
  },
  {
    q: "Apa yang perlu saya siapkan saat order?",
    a: "Sebutkan nama toko, jenis usaha, dan perkiraan jumlah pegawai yang akan memakai aplikasi. Admin memakai data itu untuk membuat ruang toko terpisah agar data Anda tidak tercampur.",
  },
  {
    q: "Kenapa pembayaran daring hilang dari aplikasi?",
    a: "Sistem pembayaran daring (checkout dan langganan) sudah dihentikan dan seluruh kodenya dilepas. Aplikasi kini dipakai gratis, jadi tidak ada lagi halaman langganan, checkout, atau verifikasi pembayaran.",
  },
  {
    q: "Saya pernah berlangganan sebelumnya — bagaimana statusnya?",
    a: "Tidak ada tagihan berjalan dan tidak ada penagihan otomatis. Catatan langganan lama hanya disimpan sebagai riwayat, dan seluruh fitur tetap bisa Anda pakai tanpa berlangganan.",
  },
  {
    q: "Apakah nanti akan ada biaya lagi?",
    a: "Bila suatu saat ada layanan berbayar, kami umumkan lebih dulu. Tidak akan ada penagihan otomatis tanpa persetujuan Anda.",
  },
  {
    q: "Bagaimana kebijakan pengembalian dana?",
    a: "Karena tidak ada pembayaran daring, tidak ada transaksi yang perlu dikembalikan. Rinciannya ada di halaman Kebijakan Pengembalian.",
  },
  {
    q: "Bagaimana keamanan data toko saya?",
    a: "Setiap toko punya ruang data terpisah dengan kontrol akses per pengguna. Penjelasan lengkap ada di halaman Keamanan & Privasi.",
  },
];

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: socialMeta({ title: TITLE, description: DESC, url: "/faq" }),
    links: [canonical("/faq")],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQ.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }),
      },
    ],
  }),
  component: FaqPage,
});

function FaqPage() {
  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-ms-4 py-10">
        <section className="lux-plate px-ms-5 py-ms-6 text-center shadow-[0_24px_50px_-30px_rgba(0,0,0,0.6)]">
          <div className="lux-plate-sheen" aria-hidden="true" />
          <div className="relative">
            <span className="inline-flex items-center gap-ms-1.5 rounded-full border border-primary-foreground/25 bg-primary-foreground/10 px-ms-2.5 py-1 text-ms-2xs font-bold uppercase leading-none tracking-[0.2em] text-primary-foreground/85 backdrop-blur-sm">
              FAQ
            </span>
            <h1 className="mt-ms-3 text-ms-3xl font-extrabold leading-tight tracking-tight">
              Pertanyaan yang sering ditanyakan
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-ms-base text-primary-foreground/85">
              Ringkasan singkat soal paket gratis, cara memesan akses, dan
              kebijakan setelah pembayaran daring dihentikan.
            </p>
          </div>
        </section>

        <section className="mt-10">
          <p className="lux-eyebrow">Jawaban singkat</p>
          <h2 className="mt-1.5 text-ms-lg font-semibold text-foreground">
            Gratis, order, &amp; kebijakan
          </h2>
          <div className="lux-hairline mt-ms-3" aria-hidden="true" />
          <div className="mt-4 grid gap-ms-3">
            {FAQ.map((f) => (
              <article key={f.q} className="lux-card p-ms-4">
                <h3 className="text-ms-sm font-semibold text-foreground">{f.q}</h3>
                <p className="mt-1 text-ms-sm text-muted-foreground">{f.a}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="lux-card mt-10 p-ms-5 text-center">
          <p className="lux-eyebrow">Masih bingung?</p>
          <h2 className="mt-1.5 text-ms-lg font-semibold text-foreground">
            Hubungi admin, kami bantu siapkan
          </h2>
          <p className="mt-2 text-ms-sm text-muted-foreground">
            Kirim email ke{" "}
            <a
              href="mailto:admin@mcmstorage.biz?subject=Pertanyaan%20MCM%20Storage"
              className="font-medium text-primary underline"
            >
              admin@mcmstorage.biz
            </a>{" "}
            dan kami balas dengan nomor WhatsApp resmi.
          </p>
          <div className="lux-hairline mt-ms-4" aria-hidden="true" />
          <div className="mt-4 flex flex-wrap items-center justify-center gap-ms-3">
            <Button asChild className="rounded-full px-ms-5">
              <Link to="/auth">Buat akun gratis</Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full border-primary/40 px-ms-5">
              <Link to="/harga">Lihat halaman Harga</Link>
            </Button>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
