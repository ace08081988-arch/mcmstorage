import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePaddleCheckout } from "@/hooks/usePaddleCheckout";
import { useSubscription } from "@/hooks/useSubscription";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";

export const Route = createFileRoute("/_authenticated/pricing")({
  component: PricingPage,
  head: () => ({
    meta: [
      { title: "Paket & Harga — MCM Storage" },
      {
        name: "description",
        content:
          "Pilih paket MCM Storage Pro untuk akses penuh ke semua fitur premium.",
      },
    ],
  }),
});

function PricingPage() {
  const router = useRouter();
  const { openCheckout, loading } = usePaddleCheckout();
  const [userId, setUserId] = useState<string | undefined>();
  const [userEmail, setUserEmail] = useState<string | undefined>();
  const { subscription, isActive } = useSubscription(userId);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id);
      setUserEmail(data.user?.email ?? undefined);
    });

    const url = new URL(window.location.href);
    if (url.searchParams.get("checkout") === "success") {
      toast.success("Terima kasih! Pembayaran sedang diproses.");
      url.searchParams.delete("checkout");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const handleSubscribe = async () => {
    if (!userId) {
      toast.error("Silakan masuk terlebih dahulu.");
      router.navigate({ to: "/auth" });
      return;
    }
    try {
      await openCheckout({
        priceId: "pro_monthly",
        customerEmail: userEmail,
        customData: { userId },
      });
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "Gagal membuka checkout");
    }
  };

  const features = [
    "Akses semua fitur premium",
    "Pengelolaan gudang tanpa batas",
    "Multi-device & sinkronisasi",
    "Dukungan prioritas",
  ];

  return (
    <div className="min-h-screen bg-background">
      <PaymentTestModeBanner />
      <div className="mx-auto max-w-3xl px-4 py-12">
        <header className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Pilih paket Anda
          </h1>
          <p className="mt-3 text-muted-foreground">
            Mulai dari paket Pro untuk membuka semua fitur MCM Storage.
          </p>
        </header>

        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {/* Free */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground">Free</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Untuk mencoba aplikasi.
            </p>
            <p className="mt-4 text-3xl font-bold text-foreground">$0</p>
            <p className="text-sm text-muted-foreground">selamanya</p>
            <ul className="mt-6 space-y-2 text-sm text-foreground">
              <li className="flex gap-2">
                <Check className="h-4 w-4 text-primary mt-0.5" /> Fitur dasar
              </li>
              <li className="flex gap-2">
                <Check className="h-4 w-4 text-primary mt-0.5" /> Akses gudang
              </li>
            </ul>
            <button
              disabled
              className="mt-6 w-full rounded-md border border-border bg-muted px-4 py-2 text-sm font-medium text-muted-foreground"
            >
              Paket saat ini
            </button>
          </div>

          {/* Pro */}
          <div className="rounded-2xl border-2 border-primary bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Pro</h2>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                Rekomendasi
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Buka semua fitur premium.
            </p>
            <p className="mt-4 text-3xl font-bold text-foreground">
              $9.99<span className="text-base font-normal text-muted-foreground">/bulan</span>
            </p>
            <ul className="mt-6 space-y-2 text-sm text-foreground">
              {features.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="h-4 w-4 text-primary mt-0.5" /> {f}
                </li>
              ))}
            </ul>
            {isActive ? (
              <button
                disabled
                className="mt-6 w-full rounded-md bg-primary/20 px-4 py-2 text-sm font-medium text-primary"
              >
                Sudah berlangganan{subscription?.cancel_at_period_end ? " (akan berakhir)" : ""}
              </button>
            ) : (
              <button
                onClick={handleSubscribe}
                disabled={loading}
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {loading ? "Membuka checkout..." : "Berlangganan Pro"}
              </button>
            )}
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Pembayaran diproses dengan aman. Anda bisa membatalkan kapan saja.
        </p>
      </div>
    </div>
  );
}