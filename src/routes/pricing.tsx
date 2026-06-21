import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { PublicFooter } from "@/components/PublicFooter";

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

const features = [
  "Pengelolaan pesanan harian",
  "Stok gudang & varian produk",
  "Hutang–piutang pelanggan & pemasok",
  "Kirim pesan cepat via WhatsApp & email",
  "Multi-device dengan sinkronisasi",
  "Chat internal antar tim",
];

function PricingPage() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl px-4 py-12">
        <header className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Harga &amp; Paket
          </h1>
          <p className="mt-3 text-muted-foreground">
            MCM Storage dioperasikan oleh <strong>BAROKAH RIZKI</strong>.
            Saat ini seluruh fitur dapat digunakan secara gratis untuk
            pengguna terdaftar.
          </p>
        </header>

        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border-2 border-primary bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Free</h2>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                Aktif saat ini
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Akses penuh ke semua fitur.
            </p>
            <p className="mt-4 text-3xl font-bold text-foreground">
              Rp 0
              <span className="text-base font-normal text-muted-foreground">
                /bulan
              </span>
            </p>
            <ul className="mt-6 space-y-2 text-sm text-foreground">
              {features.map((f) => (
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

          <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Pro</h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                Segera hadir
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Paket berbayar dengan kuota lebih besar dan dukungan prioritas
              akan diluncurkan menyusul.
            </p>
            <p className="mt-4 text-3xl font-bold text-muted-foreground">
              —
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Harga akan diumumkan saat tersedia.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 text-muted-foreground" />{" "}
                Semua fitur Free
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 text-muted-foreground" />{" "}
                Dukungan prioritas
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 text-muted-foreground" />{" "}
                Kuota lanjutan
              </li>
            </ul>
            <button
              disabled
              className="mt-6 w-full cursor-not-allowed rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-muted-foreground"
            >
              Segera hadir
            </button>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Pembelian paket berbayar (saat tersedia) akan diproses oleh{" "}
          <strong>Paddle.com</strong> sebagai Merchant of Record. Lihat{" "}
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