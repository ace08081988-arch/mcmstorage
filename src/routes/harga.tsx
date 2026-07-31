import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";

import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  IDR_PER_USD,
  MANUAL_PRICE_IDR,
  PLANS,
  TRIAL_DAYS,
  formatIdr,
} from "@/lib/paddle";

const TITLE = "Harga & Paket — MCM Storage";
const DESC =
  "Paket gratis dan paket Pro MCM Storage: $6 per bulan atau $60 per tahun. Lihat perbandingan fitur, batas kuota, dan ketentuan pembatalan sebelum mendaftar.";

export const Route = createFileRoute("/harga")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://mcmstorage.biz/harga" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://mcmstorage.biz/harga" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Product",
          name: "MCM Storage Pro",
          description: DESC,
          brand: { "@type": "Brand", name: "Mcm" },
          offers: [
            {
              "@type": "Offer",
              name: "Pro Bulanan",
              price: "6.00",
              priceCurrency: "USD",
              url: "https://mcmstorage.biz/harga",
            },
            {
              "@type": "Offer",
              name: "Pro Tahunan",
              price: "60.00",
              priceCurrency: "USD",
              url: "https://mcmstorage.biz/harga",
            },
          ],
        }),
      },
    ],
  }),
  component: HargaPage,
});

const FREE_FEATURES = [
  "Kasir & pencatatan penjualan harian",
  "Stok gudang dasar dengan batas jumlah produk",
  "Catatan hutang & piutang pelanggan",
  "Chat dan kirim pesanan ke WhatsApp",
];

const PRO_FEATURES = [
  "Semua fitur paket gratis, tanpa batas kuota bawaan",
  "Penyiapan pesanan pegawai dengan lebih banyak link & perangkat",
  "Ekspor pesanan ke PDF dan penomoran dokumen resmi",
  "Rekonsiliasi piutang dan laporan audit saldo",
  "Notifikasi WhatsApp otomatis untuk kejadian penting",
  "Dukungan prioritas lewat WhatsApp",
];

const PLAN_DETAIL: Record<string, string> = {
  mcm_pro_monthly: "Ditagih setiap bulan. Batal kapan saja.",
  mcm_pro_yearly: "Ditagih setahun sekali, setara $5 per bulan.",
};

function HargaPage() {
  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-ms-4 py-10">
        <header className="text-center">
          <h1 className="text-ms-3xl font-bold tracking-tight text-foreground">
            Harga MCM Storage
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-ms-sm text-muted-foreground">
            Mulai gratis, lalu naik ke Pro saat toko Anda butuh kapasitas dan
            laporan lengkap. Harga di bawah dalam dolar AS (USD) dan sudah final —
            tidak ada biaya pemasangan.
          </p>
        </header>

        <section className="mt-8 grid gap-ms-4 sm:grid-cols-3">
          <article className="rounded-lg border border-border bg-card p-ms-5 shadow-sm">
            <h2 className="text-ms-lg font-semibold text-foreground">Gratis</h2>
            <p className="mt-1 text-ms-2xl font-bold text-foreground">$0</p>
            <p className="text-ms-xs text-muted-foreground">selamanya</p>
            <ul className="mt-4 space-ms-2 text-ms-sm text-muted-foreground">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-ms-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Button asChild variant="outline" className="mt-5 w-full">
              <Link to="/auth">Mulai gratis</Link>
            </Button>
          </article>

          {PLANS.map((plan) => (
            <article
              key={plan.priceId}
              className="rounded-lg border border-primary/40 bg-card p-ms-5 shadow-sm"
            >
              <div className="flex items-center gap-ms-2">
                <h2 className="text-ms-lg font-semibold text-foreground">{plan.name}</h2>
                {plan.note ? <Badge variant="secondary">{plan.note}</Badge> : null}
              </div>
              <p className="mt-1 text-ms-2xl font-bold text-foreground">
                {plan.amountLabel}
              </p>
              <p className="text-ms-xs text-muted-foreground">{plan.cycleLabel}</p>
              <p className="text-ms-xs text-muted-foreground">
                ± {formatIdr(plan.amountUsd * IDR_PER_USD)} · transfer bank{" "}
                {formatIdr(MANUAL_PRICE_IDR[plan.cycle])}
              </p>
              <p className="mt-2 text-ms-xs text-muted-foreground">
                {PLAN_DETAIL[plan.priceId]}
              </p>
              <ul className="mt-4 space-ms-2 text-ms-sm text-muted-foreground">
                {PRO_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-ms-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-5 w-full">
                <Link to="/auth">Coba gratis {TRIAL_DAYS} hari</Link>
              </Button>
            </article>
          ))}
        </section>

        <section className="mt-8 rounded-lg border border-border bg-card p-ms-5 shadow-sm">
          <h2 className="text-ms-lg font-semibold text-foreground">
            Yang perlu Anda ketahui sebelum membeli
          </h2>
          <ul className="mt-3 space-ms-2 text-ms-sm text-muted-foreground">
            <li>
              Setiap paket Pro dimulai dengan uji coba gratis {TRIAL_DAYS} hari.
              Tagihan pertama baru berjalan setelah masa uji coba berakhir, dan
              Anda bisa membatalkan sebelum itu tanpa biaya.
            </li>
            <li>
              Pembayaran kartu ditagih dalam dolar AS karena penyedia pembayaran
              belum mendukung Rupiah; nilai Rupiah yang tertera adalah estimasi
              kurs. Untuk membayar dalam Rupiah asli, tersedia transfer bank
              ({formatIdr(MANUAL_PRICE_IDR.monthly)} per bulan atau{" "}
              {formatIdr(MANUAL_PRICE_IDR.yearly)} per tahun) yang diverifikasi
              manual di dalam aplikasi.
            </li>
            <li>
              Pembayaran diproses oleh Paddle.com sebagai Merchant of Record untuk
              seluruh pesanan Mcm. Pajak yang berlaku dihitung oleh Paddle saat
              pembayaran.
            </li>
            <li>
              Langganan diperpanjang otomatis sesuai siklus yang Anda pilih sampai
              dibatalkan. Setelah dibatalkan, akses Pro tetap berjalan hingga akhir
              periode yang sudah dibayar.
            </li>
            <li>
              Kami memberi jaminan uang kembali 30 hari. Rincian ada di{" "}
              <Link to="/refund" className="underline">
                Kebijakan Pengembalian
              </Link>
              .
            </li>
            <li>
              Membuat akun gratis tidak memerlukan kartu; Anda bisa mencoba dulu
              sebelum berlangganan.
            </li>
          </ul>
          <p className="mt-4 text-ms-xs text-muted-foreground">
            Pertanyaan soal harga? Baca{" "}
            <Link to="/terms" className="underline">
              Syarat &amp; Ketentuan
            </Link>{" "}
            atau hubungi kami lewat kanal dukungan pada halaman{" "}
            <Link to="/trust" className="underline">
              Privasi &amp; Keamanan
            </Link>
            .
          </p>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
