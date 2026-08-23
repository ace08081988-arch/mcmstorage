import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PackageCheck } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";

/**
 * Halaman gabungan "Siap Kirim": mengelompokkan dua daftar yang sebelumnya
 * tersembunyi di bagian bawah Beranda —
 *   1. Produk Eceran Siap Kirim (ReadyEcerSection)
 *   2. Paket Request Siap Kirim (ReadyRequestSection)
 * plus daftar "Siapkan Sendiri" agar semua yang siap dikirim ada di satu layar.
 *
 * Diakses lewat tab paling kiri di bar bawah (menggantikan tab Beranda).
 */
const ReadyEcerSection = lazy(() =>
  import("@/components/ReadyEcerSection").then((m) => ({ default: m.ReadyEcerSection })),
);
const ReadyRequestSection = lazy(() =>
  import("@/components/ReadyRequestSection").then((m) => ({ default: m.ReadyRequestSection })),
);
const ReadySelfPrepSection = lazy(() =>
  import("@/components/ReadySelfPrepSection").then((m) => ({ default: m.ReadySelfPrepSection })),
);

export const Route = createFileRoute("/_authenticated/siap-kirim")({
  component: SiapKirimPage,
  head: () => ({
    meta: [
      { title: "Siap Kirim — Ace Storage" },
      {
        name: "description",
        content:
          "Daftar produk eceran dan paket request yang sudah siap dikirim ke pelanggan dalam satu halaman.",
      },
      { property: "og:title", content: "Siap Kirim — Ace Storage" },
      {
        property: "og:description",
        content: "Produk ecer dan paket request siap kirim dalam satu halaman.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function SiapKirimPage() {
  return (
    <div className="min-h-screen bg-background pb-[var(--app-bottom-nav-h,4.5rem)]">
      <PageHeader
        icon={PackageCheck}
        title="Siap Kirim"
        subtitle="Produk ecer & paket request"
        backTo="/"
        backLabel="← Beranda"
      />
      <main className="app-gutter app-safe-x mx-auto max-w-3xl space-ms-5 py-ms-4">
        <header className="hidden items-center gap-ms-2 md:flex">
          <PackageCheck className="h-5 w-5 text-primary" aria-hidden />
          <h1 className="text-ms-lg font-semibold">Siap Kirim</h1>
        </header>
        <Suspense
          fallback={
            <div className="rounded-lg border border-primary/10 bg-card px-ms-3 py-ms-4 text-center text-ms-2xs text-muted-foreground">
              Memuat…
            </div>
          }
        >
          <div className="space-ms-5">
            <ReadyEcerSection />
            <ReadyRequestSection />
            <ReadySelfPrepSection />
          </div>
        </Suspense>
      </main>
    </div>
  );
}
