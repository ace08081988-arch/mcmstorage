import { createFileRoute, Link } from "@tanstack/react-router";
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
const TITLE = "MCM Storage — Aplikasi kasir, stok, & hutang-piutang dari HP";
const DESC =
  "MCM Storage membantu pemilik toko mencatat penjualan, stok gudang, penyiapan pesanan, dan hutang-piutang pelanggan langsung dari HP, terhubung ke WhatsApp.";

export const Route = createFileRoute("/produk")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://mcmstorage.biz/produk" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://mcmstorage.biz/produk" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "MCM Storage",
          applicationCategory: "BusinessApplication",
          operatingSystem: "Android, Web",
          description: DESC,
          publisher: { "@type": "Organization", name: "Mcm" },
        }),
      },
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
        <section className="text-center">
          <h1 className="text-ms-3xl font-bold tracking-tight text-foreground">
            Jalankan seluruh toko Anda dari satu aplikasi
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-ms-base text-muted-foreground">
            MCM Storage menyatukan kasir, stok gudang, penyiapan pesanan pegawai,
            dan catatan hutang-piutang pelanggan — semuanya bisa dijalankan dari
            HP dan dikirim ke pelanggan lewat WhatsApp.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-ms-3">
            <Button asChild size="lg">
              <Link to="/auth">Coba gratis</Link>
            </Button>
          </div>
          <p className="mt-3 text-ms-xs text-muted-foreground">
            Semua fitur tersedia gratis untuk saat ini.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-ms-lg font-semibold text-foreground">
            Apa yang bisa Anda lakukan
          </h2>
          <div className="mt-4 grid gap-ms-3 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <article
                key={f.title}
                className="rounded-lg border border-border bg-card p-ms-4 shadow-sm"
              >
                <f.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                <h3 className="mt-2 text-ms-sm font-semibold text-foreground">
                  {f.title}
                </h3>
                <p className="mt-1 text-ms-sm text-muted-foreground">{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-10 rounded-lg border border-border bg-card p-ms-5 shadow-sm">
          <h2 className="text-ms-lg font-semibold text-foreground">Cocok untuk siapa</h2>
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

        <section className="mt-10 rounded-lg border border-primary/40 bg-card p-ms-5 text-center shadow-sm">
          <h2 className="text-ms-lg font-semibold text-foreground">
            Siap merapikan pencatatan toko?
          </h2>
          <p className="mt-2 text-ms-sm text-muted-foreground">
            Buat akun gratis dulu, tingkatkan ke Pro kapan saja saat toko Anda butuh
            kapasitas lebih besar.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-ms-3">
            <Button asChild>
              <Link to="/auth">Buat akun</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/download">Unduh aplikasi Android</Link>
            </Button>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
