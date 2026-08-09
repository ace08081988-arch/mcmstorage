import { createFileRoute, Link } from "@tanstack/react-router";
import { canonical, socialMeta } from "@/lib/seo-meta";
import { jsonLdScript, organizationSchema } from "@/lib/structured-data";
import {
  Boxes,
  CheckCircle2,
  MessageCircle,
  Receipt,
  Smartphone,
  Wallet,
} from "lucide-react";

import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";
import { Button } from "@/components/ui/button";
const TITLE = "Ace Storage — Aplikasi kasir, stok, & hutang-piutang dari HP";
const DESC =
  "Ace Storage membantu pemilik toko mencatat penjualan, stok gudang, penyiapan pesanan, dan hutang-piutang pelanggan langsung dari HP, terhubung ke WhatsApp.";

export const Route = createFileRoute("/produk")({
  head: () => ({
    meta: socialMeta({ title: TITLE, description: DESC, url: "/produk" }),
    links: [canonical("/produk")],
    scripts: [
      jsonLdScript([
        {
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "Ace Storage",
          applicationCategory: "BusinessApplication",
          operatingSystem: "Android, Web",
          description: DESC,
          publisher: { "@id": "https://mcmstorage.app/#organization" },
        },
        organizationSchema(),
      ]),
    ],
  }),
  component: ProdukPage,
});

const FEATURES = [
  {
    icon: Boxes,
    title: "Stok gudang & ecer",
    body: "Catat pembelian, konversi karton ke ecer, dan lihat sisa stok yang selalu ikut berkurang otomatis setiap kali ada penjualan.",
  },
  {
    icon: Receipt,
    title: "Penyiapan pesanan",
    body: "Kirim link ke pegawai untuk unggah foto, berat, dan lokasi barang. Hasilnya langsung masuk jadi paket siap kirim.",
  },
  {
    icon: Wallet,
    title: "Hutang & piutang satu sumber",
    body: "Setiap penjualan otomatis jadi kas atau piutang. Saldo pelanggan sama di semua halaman, lengkap dengan jejak audit.",
  },
  {
    icon: MessageCircle,
    title: "Terhubung WhatsApp",
    body: "Kirim rincian pesanan, foto, sisa hutang, dan titik lokasi ke pelanggan langsung dari aplikasi.",
  },
  {
    icon: Smartphone,
    title: "Dirancang untuk HP",
    body: "Semua proses harian bisa dijalankan satu tangan dari HP Android, termasuk lewat aplikasi APK.",
  },
  {
    icon: CheckCircle2,
    title: "Laporan siap pakai",
    body: "Ringkasan penjualan, rekonsiliasi piutang, dan ekspor pesanan ke PDF dengan penomoran dokumen rapi.",
  },
];

const HERO_POINTS = ["Tanpa biaya", "Jalan di HP", "Kirim lewat WhatsApp"];

/**
 * Ringkasan alur kerja untuk sisi kanan hero.
 *
 * Sengaja BUKAN tangkapan layar palsu atau angka contoh: yang ditampilkan
 * hanya urutan langkah nyata yang memang ada di aplikasi, supaya calon
 * pengguna tidak dijanjikan tampilan/data yang tidak mereka temui.
 */
const HERO_FLOW = [
  { step: "1", label: "Pesanan masuk", note: "Dicatat dari kasir atau pesanan pelanggan" },
  { step: "2", label: "Pegawai menyiapkan", note: "Foto, berat, dan lokasi lewat link" },
  { step: "3", label: "Kirim ke pelanggan", note: "Rincian dan foto dikirim via WhatsApp" },
  { step: "4", label: "Stok & piutang ikut", note: "Sisa stok dan saldo hutang otomatis" },
];

function HeroFlow() {
  return (
    <div className="mx-auto w-full max-w-sm rounded-2xl border border-primary-foreground/20 bg-primary-foreground/[0.07] p-ms-4 text-left backdrop-blur-sm lg:mx-0">
      <p className="text-ms-2xs font-bold uppercase tracking-[0.18em] text-primary-foreground/70">
        Alur harian
      </p>
      <ol className="mt-ms-3 space-ms-3">
        {HERO_FLOW.map((f) => (
          <li key={f.step} className="flex items-start gap-ms-3">
            <span
              className="grid size-7 shrink-0 place-items-center rounded-full border border-primary-foreground/30 bg-primary-foreground/10 text-ms-2xs font-bold text-primary-foreground"
              aria-hidden="true"
            >
              {f.step}
            </span>
            <span className="min-w-0">
              <span className="block text-ms-sm font-semibold leading-snug text-primary-foreground">
                {f.label}
              </span>
              <span className="block text-ms-xs leading-relaxed text-primary-foreground/75">
                {f.note}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const AUDIENCE = [
  "Toko grosir dan sembako yang melayani pesanan harian",
  "Pemilik usaha yang memakai WhatsApp sebagai kanal utama pelanggan",
  "Usaha dengan pegawai lapangan yang menyiapkan dan mengantar barang",
  "Pemilik toko yang perlu memantau hutang pelanggan tanpa buku tulis",
];

function ProdukPage() {
  return (
    <div className="min-h-app-vh bg-background">
      <PublicHeader />
      <main id="konten-utama" tabIndex={-1} className="app-safe-x mx-auto max-w-6xl px-ms-4 py-10">
        {/* Hero: satu kolom terpusat di HP, dua kolom di ≥lg supaya layar
            desktop tidak menyisakan pita kosong lebar di kiri-kanan. */}
        <section className="lux-plate px-ms-5 py-ms-6 shadow-[0_24px_50px_-30px_rgba(0,0,0,0.6)] sm:px-ms-6 lg:px-ms-8 lg:py-ms-8">
          <div className="lux-plate-sheen" aria-hidden="true" />
          <div className="relative grid items-center gap-ms-6 text-center lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-ms-8 lg:text-left">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-ms-1.5 rounded-full border border-primary-foreground/25 bg-primary-foreground/10 px-ms-2.5 py-1 text-ms-2xs font-bold uppercase leading-none tracking-[0.2em] text-primary-foreground/85 backdrop-blur-sm">
                Ace Storage
              </span>
              <h1 className="mt-ms-3 text-ms-3xl font-extrabold leading-tight tracking-tight text-balance">
                Jalankan seluruh toko Anda dari satu aplikasi
              </h1>
              <p className="mx-auto mt-3 max-w-xl text-ms-base text-primary-foreground/85 lg:mx-0">
                Ace Storage menyatukan kasir, stok gudang, penyiapan pesanan pegawai,
                dan catatan hutang-piutang pelanggan — semuanya bisa dijalankan dari
                HP dan dikirim ke pelanggan lewat WhatsApp.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-ms-3 lg:justify-start">
                <Button asChild size="lg" variant="secondary" className="rounded-full px-ms-5 font-semibold shadow-sm">
                  <Link to="/auth">Coba gratis</Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="rounded-full border-primary-foreground/35 bg-transparent px-ms-5 font-semibold text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
                >
                  <Link to="/download">Unduh aplikasi</Link>
                </Button>
              </div>
              <p className="mt-3 text-ms-xs text-primary-foreground/75">
                Semua fitur tersedia gratis untuk saat ini.
              </p>
              <ul className="mx-auto mt-5 flex max-w-md flex-wrap items-center justify-center gap-x-4 gap-y-2 text-ms-2xs font-medium text-primary-foreground/80 lg:mx-0 lg:justify-start">
                {HERO_POINTS.map((h) => (
                  <li key={h} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {h}
                  </li>
                ))}
              </ul>
            </div>
            <HeroFlow />
          </div>
        </section>

        <section className="mt-10">
          <p className="lux-eyebrow">Fitur</p>
          <h2 className="mt-1.5 text-ms-lg font-semibold text-foreground">
            Apa yang bisa Anda lakukan
          </h2>
          <div className="lux-hairline mt-ms-3" aria-hidden="true" />
          <div className="mt-4 grid gap-ms-3 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <article
                key={f.title}
                className="lux-card group h-full p-ms-4 transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[0_18px_40px_-28px_rgba(0,0,0,0.7)]"
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/12 text-primary ring-1 ring-inset ring-primary/25 transition-colors group-hover:bg-primary/20">
                  <f.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-2.5 text-ms-sm font-semibold leading-snug text-foreground">
                  {f.title}
                </h3>
                <p className="mt-1 text-ms-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="lux-card mt-10 p-ms-5 lg:p-ms-6">
          <p className="lux-eyebrow">Target pengguna</p>
          <h2 className="mt-1.5 text-ms-lg font-semibold text-foreground">Cocok untuk siapa</h2>
          <ul className="mt-3 grid gap-ms-2 text-ms-sm text-muted-foreground lg:grid-cols-2 lg:gap-x-ms-6">
            {AUDIENCE.map((a) => (
              <li key={a} className="flex items-start gap-ms-2">
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="lux-card mt-10 p-ms-5 text-center">
          <p className="lux-eyebrow">Mulai</p>
          <h2 className="mt-1.5 text-ms-lg font-semibold text-foreground">
            Siap merapikan pencatatan toko?
          </h2>
          <p className="mt-2 text-ms-sm text-muted-foreground">
            Buat akun gratis dan pakai seluruh fitur tanpa biaya.
          </p>
          <div className="lux-hairline mt-ms-4" aria-hidden="true" />
          <div className="mt-4 flex flex-wrap items-center justify-center gap-ms-3">
            <Button asChild className="rounded-full px-ms-5">
              <Link to="/auth">Buat akun</Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full px-ms-5 border-primary/40">
              <Link to="/download">Unduh aplikasi Android</Link>
            </Button>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
