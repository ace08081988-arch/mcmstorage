import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PublicFooter } from "@/components/PublicFooter";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Harga — MCM Storage" },
      {
        name: "description",
        content:
          "Paket dan harga MCM Storage. Saat ini semua fitur dapat digunakan secara gratis untuk pengguna terdaftar.",
      },
      { property: "og:title", content: "Harga — MCM Storage" },
      {
        property: "og:description",
        content:
          "Paket dan harga MCM Storage — pengelola pesanan, gudang, dan komunikasi pelanggan.",
      },
    ],
    links: [{ rel: "canonical", href: "https://mcmstorage.lovable.app/pricing" }],
  }),
  component: PricingPage,
});

const freeFeatures = [
  "Hingga 30 barang gudang",
  "Hingga 50 penjualan / 30 hari",
  "1 kontak pegawai",
  "1 perangkat tepercaya",
  "Pesanan, ECER, request, label",
  "Baca chat (tanpa kirim)",
];

const proFeatures = [
  "Barang gudang & penjualan tak terbatas",
  "Modul Hutang–Piutang lengkap",
  "Kirim pesan chat internal",
  "Notifikasi push",
  "Pegawai & perangkat tak terbatas",
  "Otomatis berbagi ke seluruh pegawai",
];

const FALLBACK = {
  pro_price_monthly_idr: 99000,
  pro_price_yearly_idr: 990000,
  trial_days: 14,
};

function formatIDR(n: number) {
  return new Intl.NumberFormat("id-ID").format(n);
}

function yearlySavingsPct(monthly: number, yearly: number) {
  if (!monthly || !yearly) return 0;
  const full = monthly * 12;
  if (full <= 0) return 0;
  const pct = Math.round(((full - yearly) / full) * 100);
  return Math.max(0, pct);
}

function PricingPage() {
  const { data: settings } = useQuery({
    queryKey: ["app_settings", "pricing"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("pro_price_monthly_idr, pro_price_yearly_idr, trial_days")
        .eq("id", true)
        .maybeSingle();
      if (error) return FALLBACK;
      return data ?? FALLBACK;
    },
    staleTime: 5 * 60 * 1000,
  });

  const monthly = settings?.pro_price_monthly_idr ?? FALLBACK.pro_price_monthly_idr;
  const yearly = settings?.pro_price_yearly_idr ?? FALLBACK.pro_price_yearly_idr;
  const trialDays = settings?.trial_days ?? FALLBACK.trial_days;
  const savings = yearlySavingsPct(monthly, yearly);

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl px-4 py-12">
        <header className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Harga &amp; Paket
          </h1>
          <p className="mt-3 text-muted-foreground">
            MCM Storage dioperasikan oleh <strong>BAROKAH RIZKI</strong>.
            Mulai gratis. Upgrade ke Pro saat usaha Anda berkembang.
          </p>
        </header>

        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Free</h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                Selamanya
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Cukup untuk usaha kecil yang baru mulai.
            </p>
            <p className="mt-4 text-3xl font-bold text-foreground">
              Rp 0
              <span className="text-base font-normal text-muted-foreground">
                /bulan
              </span>
            </p>
            <ul className="mt-6 space-y-2 text-sm text-foreground">
              {freeFeatures.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 text-primary" /> {f}
                </li>
              ))}
            </ul>
            <Link
              to="/auth"
              className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Mulai gratis
            </Link>
          </div>

          <div className="rounded-2xl border-2 border-primary bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Pro</h2>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                Uji coba {trialDays} hari gratis
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Buka modul keuangan, chat, dan kapasitas tanpa batas.
            </p>
            <p className="mt-4 text-3xl font-bold text-foreground">
              Rp {formatIDR(monthly)}
              <span className="text-base font-normal text-muted-foreground">
                /bulan
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              atau Rp {formatIDR(yearly)}/tahun
              {savings > 0 ? ` (hemat ~${savings}%)` : ""}
            </p>
            <ul className="mt-6 space-y-2 text-sm text-foreground">
              {proFeatures.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 text-primary" /> {f}
                </li>
              ))}
            </ul>
            <Link
              to="/langganan"
              className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Mulai uji coba {trialDays} hari
            </Link>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Pembayaran Pro dilakukan via transfer bank dan dikonfirmasi admin
          dalam beberapa jam kerja. Lihat{" "}
          <Link to="/terms" className="underline">
            Syarat &amp; Ketentuan
          </Link>{" "}
          dan{" "}
          <Link to="/refund" className="underline">
            Kebijakan Pengembalian
          </Link>
          .
        </p>
      </main>
      <PublicFooter />
    </div>
  );
}