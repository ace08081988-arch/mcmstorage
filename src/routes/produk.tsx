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

const AUDIENCE = [
  "Toko grosir dan sembako yang melayani pesanan harian",
  "Pemilik usaha yang memakai WhatsApp sebagai kanal utama pelanggan",
  "Usaha dengan pegawai lapangan yang menyiapkan dan mengantar barang",
  "Pemilik toko yang perlu memantau hutang pelanggan tanpa buku tulis",
];

function ProdukPage() {
  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-ms-4 py-10">
        <section className="lux-plate px-ms-5 py-ms-6 text-center shadow-[0_24px_50px_-30px_rgba(0,0,0,0.6)]">
          <div className="lux-plate-sheen" aria-hidden="true" />
          <div className="relative">
            <span className="inline-flex items-center gap-ms-1.5 rounded-full border border-primary-foreground/25 bg-primary-foreground/10 px-ms-2.5 py-1 text-ms-2xs font-bold uppercase leading-none tracking-[0.2em] text-primary-foreground/85 backdrop-blur-sm">
              Ace Storage
            </span>
            <h1 className="mt-ms-3 text-ms-3xl font-extrabold leading-tight tracking-tight">
              Jalankan seluruh toko Anda dari satu aplikasi
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-ms-base text-primary-foreground/85">
              Ace Storage menyatukan kasir, stok gudang, penyiapan pesanan pegawai,
              dan catatan hutang-piutang pelanggan — semuanya bisa dijalankan dari
              HP dan dikirim ke pelanggan lewat WhatsApp.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-ms-3">
              <Button asChild size="lg" variant="secondary" className="rounded-full px-ms-5 font-semibold shadow-sm">
                <Link to="/auth">Coba gratis</Link>
              </Button>
            </div>
            <p className="mt-3 text-ms-xs text-primary-foreground/75">
              Semua fitur tersedia gratis untuk saat ini.
            </p>
          </div>
        </section>

        <section className="mt-10">
          <p className="lux-eyebrow">Fitur</p>
          <h2 className="mt-1.5 text-ms-lg font-semibold text-foreground">
            Apa yang bisa Anda lakukan
          </h2>
          <div className="lux-hairline mt-ms-3" aria-hidden="true" />
          <div className="mt-4 grid gap-ms-3 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <article
                key={f.title}
                className="lux-card p-ms-4 transition-transform duration-200 hover:-translate-y-0.5"
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/12 text-primary ring-1 ring-inset ring-primary/25">
                  <f.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-2 text-ms-sm font-semibold text-foreground">
                  {f.title}
                </h3>
                <p className="mt-1 text-ms-sm text-muted-foreground">{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="lux-card mt-10 p-ms-5">
          <p className="lux-eyebrow">Target pengguna</p>
          <h2 className="mt-1.5 text-ms-lg font-semibold text-foreground">Cocok untuk siapa</h2>
          <ul className="mt-3 space-ms-2 text-ms-sm text-muted-foreground">
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
