import { createFileRoute, Link } from "@tanstack/react-router";
import { canonical, socialMeta } from "@/lib/seo-meta";
import {
  BadgeCheck,
  CheckCircle2,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";

import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";
import { Button } from "@/components/ui/button";

const TITLE = "Harga Ace Storage — Gratis, tanpa pembayaran daring";
const DESC =
  "Ace Storage dipakai gratis tanpa kartu kredit dan tanpa pembayaran daring. Pemesanan dan permintaan akses dilakukan lewat WhatsApp bersama admin.";

export const Route = createFileRoute("/harga")({
  head: () => ({
    meta: socialMeta({ title: TITLE, description: DESC, url: "/harga" }),
    links: [canonical("/harga")],
  }),
  component: HargaPage,
});

const INCLUDED = [
  "Stok gudang, ecer, dan konversi karton",
  "Penyiapan pesanan lewat link pegawai",
  "Hutang & piutang satu sumber (SSOT) + audit",
  "Kirim rincian, foto, dan lokasi ke WhatsApp pelanggan",
  "Ringkasan penjualan, rekonsiliasi, dan ekspor PDF",
  "Aplikasi Android (APK) dan versi web",
];

const NOT_CHARGED = [
  "Tidak ada kartu kredit atau pembayaran daring",
  "Tidak ada biaya bulanan atau biaya tersembunyi",
  "Tidak ada fitur yang dikunci di balik paywall",
];

const STEPS = [
  {
    title: "Hubungi admin lewat WhatsApp",
    body: "Sampaikan nama toko, jenis usaha, dan berapa pegawai yang akan memakai aplikasi.",
  },
  {
    title: "Admin siapkan akses toko Anda",
    body: "Kami buatkan ruang toko terpisah agar data Anda tidak tercampur dengan pengguna lain.",
  },
  {
    title: "Masuk dan langsung pakai",
    body: "Login dengan email atau Google, lalu jalankan pencatatan harian dari HP hari itu juga.",
  },
];

function HargaPage() {
  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-ms-4 py-10">
        <section className="lux-plate px-ms-5 py-ms-6 text-center shadow-[0_24px_50px_-30px_rgba(0,0,0,0.6)]">
          <div className="lux-plate-sheen" aria-hidden="true" />
          <div className="relative">
            <span className="inline-flex items-center gap-ms-1.5 rounded-full border border-primary-foreground/25 bg-primary-foreground/10 px-ms-2.5 py-1 text-ms-2xs font-bold uppercase leading-none tracking-[0.2em] text-primary-foreground/85 backdrop-blur-sm">
              Harga
            </span>
            <h1 className="mt-ms-3 text-ms-3xl font-extrabold leading-tight tracking-tight">
              Gratis dipakai, tanpa pembayaran daring
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-ms-base text-primary-foreground/85">
              Ace Storage tidak menjual paket langganan di dalam aplikasi. Semua
              fitur terbuka penuh, dan pemesanan akses dilakukan langsung
              bersama admin lewat WhatsApp.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-ms-3">
              <Button asChild size="lg" variant="secondary" className="rounded-full px-ms-5 font-semibold shadow-sm">
                <Link to="/auth">Mulai gratis sekarang</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="rounded-full border-primary-foreground/40 bg-transparent px-ms-5 font-semibold text-primary-foreground hover:bg-primary-foreground/10"
              >
                <Link to="/produk">Lihat fitur</Link>
              </Button>
            </div>
            <p className="mt-3 text-ms-xs text-primary-foreground/75">
              Tanpa kartu kredit. Tanpa biaya tersembunyi.
            </p>
          </div>
        </section>

        <section className="mt-10 grid gap-ms-3 sm:grid-cols-2">
          <article className="lux-card p-ms-5">
            <p className="lux-eyebrow">Paket tunggal</p>
            <div className="mt-1.5 flex items-baseline gap-ms-2">
              <span className="text-ms-3xl font-extrabold tracking-tight text-foreground">
                Rp0
              </span>
              <span className="text-ms-sm text-muted-foreground">/ bulan</span>
            </div>
            <div className="lux-hairline mt-ms-3" aria-hidden="true" />
            <ul className="mt-3 space-y-2 text-ms-sm text-muted-foreground">
              {INCLUDED.map((x) => (
                <li key={x} className="flex items-start gap-ms-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>{x}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="lux-card p-ms-5">
            <p className="lux-eyebrow">Yang tidak kami tagih</p>
            <h2 className="mt-1.5 text-ms-lg font-semibold text-foreground">
              Tidak ada checkout daring
            </h2>
            <div className="lux-hairline mt-ms-3" aria-hidden="true" />
            <ul className="mt-3 space-y-2 text-ms-sm text-muted-foreground">
              {NOT_CHARGED.map((x) => (
                <li key={x} className="flex items-start gap-ms-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>{x}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-ms-xs text-muted-foreground">
              Bila suatu saat ada layanan berbayar, kami umumkan lebih dulu dan
              tidak pernah menagih otomatis.
            </p>
          </article>
        </section>

        <section className="mt-10">
          <p className="lux-eyebrow">Cara pemesanan</p>
          <h2 className="mt-1.5 text-ms-lg font-semibold text-foreground">
            Pesan akses lewat WhatsApp
          </h2>
          <div className="lux-hairline mt-ms-3" aria-hidden="true" />
          <ol className="mt-4 grid gap-ms-3 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="lux-card p-ms-4">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/12 text-ms-sm font-bold text-primary ring-1 ring-inset ring-primary/25">
                  {i + 1}
                </span>
                <h3 className="mt-2 text-ms-sm font-semibold text-foreground">{s.title}</h3>
                <p className="mt-1 text-ms-sm text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
          <div className="lux-card mt-ms-3 flex flex-col gap-ms-3 p-ms-4 sm:flex-row sm:items-center">
            <MessageCircle className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <p className="text-ms-sm text-muted-foreground">
              Belum punya kontak admin? Kirim email ke{" "}
              <a href="mailto:admin@mcmstorage.biz?subject=Permintaan%20Akses%20MCM%20Storage" className="font-medium text-primary underline">
                admin@mcmstorage.biz
              </a>{" "}
              dan kami balas dengan nomor WhatsApp resmi beserta langkah
              pendaftarannya.
            </p>
          </div>
        </section>

        <section className="mt-10">
          <p className="lux-eyebrow">Pertanyaan umum</p>
          <h2 className="mt-1.5 text-ms-lg font-semibold text-foreground">
            Sering ditanyakan
          </h2>
          <div className="lux-hairline mt-ms-3" aria-hidden="true" />
          <div className="mt-4 grid gap-ms-3 sm:grid-cols-2">
            <article className="lux-card p-ms-4">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/12 text-primary ring-1 ring-inset ring-primary/25">
                <Wallet className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-2 text-ms-sm font-semibold text-foreground">
                Benar-benar gratis?
              </h3>
              <p className="mt-1 text-ms-sm text-muted-foreground">
                Ya. Saat ini tidak ada pembayaran daring di dalam aplikasi dan
                tidak ada fitur yang terkunci.
              </p>
            </article>
            <article className="lux-card p-ms-4">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/12 text-primary ring-1 ring-inset ring-primary/25">
                <BadgeCheck className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-2 text-ms-sm font-semibold text-foreground">
                Data saya aman?
              </h3>
              <p className="mt-1 text-ms-sm text-muted-foreground">
                Setiap toko punya ruang data terpisah dengan kontrol akses.
                Rinciannya ada di halaman{" "}
                <Link to="/trust" className="text-primary underline">
                  Keamanan &amp; privasi
                </Link>
                .
              </p>
            </article>
          </div>
        </section>

        <section className="lux-card mt-10 p-ms-5 text-center">
          <p className="lux-eyebrow">Mulai</p>
          <h2 className="mt-1.5 text-ms-lg font-semibold text-foreground">
            Coba hari ini tanpa biaya
          </h2>
          <p className="mt-2 text-ms-sm text-muted-foreground">
            Buat akun, lalu hubungi admin lewat WhatsApp untuk penyiapan toko Anda.
          </p>
          <div className="lux-hairline mt-ms-4" aria-hidden="true" />
          <div className="mt-4 flex flex-wrap items-center justify-center gap-ms-3">
            <Button asChild className="rounded-full px-ms-5">
              <Link to="/auth">Buat akun gratis</Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full border-primary/40 px-ms-5">
              <Link to="/download">Unduh aplikasi Android</Link>
            </Button>
          </div>
          <p className="mt-3 inline-flex items-center justify-center gap-ms-1.5 text-ms-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            Gratis, tanpa pembayaran daring.
          </p>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
