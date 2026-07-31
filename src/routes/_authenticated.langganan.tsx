/**
 * Halaman paket & checkout langganan MCM Storage Pro.
 * Status langganan dibaca dari tabel `subscriptions` (SSOT yang sama dengan
 * has_active_pro), checkout dibuka lewat overlay pembayaran bawaan.
 */
import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, Crown, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { PageContainer } from "@/components/layout/PageContainer";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PLANS,
  getPaddleEnvironment,
  getPaddlePriceId,
  initializePaddle,
  type PlanPriceId,
} from "@/lib/paddle";
import { createPortalSession } from "@/utils/payments.functions";

export const Route = createFileRoute("/_authenticated/langganan")({
  head: () => ({
    meta: [
      { title: "Langganan Pro · MCM Storage" },
      {
        name: "description",
        content:
          "Pilih paket MCM Storage Pro bulanan atau tahunan dan bayar langsung dari aplikasi.",
      },
      { property: "og:title", content: "Langganan Pro · MCM Storage" },
      {
        property: "og:description",
        content: "Paket Pro bulanan atau tahunan untuk membuka semua fitur MCM Storage.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LanggananPage,
});

const BENEFITS = [
  "Gudang, penjualan, dan hutang-piutang tanpa batas kuota",
  "Penyiapan pegawai & link unggah foto tanpa batas",
  "Laporan PDF berkop toko dan ekspor pesanan",
  "Kios, POS kasir, dan rekonsiliasi piutang",
];

function useSubscription() {
  return useQuery({
    queryKey: ["subscription", getPaddleEnvironment()],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return null;
      const { data } = await supabase
        .from("subscriptions")
        .select(
          "plan,status,billing_cycle,period_end,cancel_at_period_end,price_id,environment",
        )
        .eq("user_id", uid)
        .maybeSingle();
      return { uid, email: userData.user?.email ?? undefined, sub: data ?? null };
    },
  });
}

function LanggananPage() {
  const { data, isLoading, refetch, isFetching } = useSubscription();
  const [busy, setBusy] = useState<PlanPriceId | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);

  // Setelah checkout selesai, webhook butuh sesaat untuk menulis status.
  useEffect(() => {
    const onFocus = () => refetch();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refetch]);

  const sub = data?.sub ?? null;
  const isPro =
    sub?.plan === "pro" && ["trialing", "active", "grace"].includes(sub?.status ?? "");

  const openCheckout = async (priceId: PlanPriceId) => {
    if (!data?.uid) {
      toast.error("Sesi tidak ditemukan, coba masuk ulang.");
      return;
    }
    setBusy(priceId);
    const t = toast.loading("Menyiapkan pembayaran…");
    try {
      await initializePaddle();
      const paddlePriceId = await getPaddlePriceId(priceId);
      window.Paddle.Checkout.open({
        items: [{ priceId: paddlePriceId, quantity: 1 }],
        customer: data.email ? { email: data.email } : undefined,
        customData: { userId: data.uid },
        settings: {
          displayMode: "overlay",
          variant: "one-page",
          allowLogout: false,
          successUrl: `${window.location.origin}/langganan?checkout=success`,
        },
      });
      toast.success("Jendela pembayaran terbuka", { id: t });
    } catch (e) {
      console.error(e);
      toast.error(
        e instanceof Error ? e.message : "Gagal membuka pembayaran",
        { id: t },
      );
    } finally {
      setBusy(null);
    }
  };

  const openPortal = async () => {
    setPortalBusy(true);
    const t = toast.loading("Membuka portal langganan…");
    try {
      const res = await createPortalSession();
      window.open(res.cancelUrl ?? res.overviewUrl, "_blank", "noopener");
      toast.success("Portal dibuka di tab baru", { id: t });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membuka portal", { id: t });
    } finally {
      setPortalBusy(false);
    }
  };

  return (
    <PageContainer width="lg" bottomSafe>
      <PaymentTestModeBanner />

      <header className="space-ms-1">
        <h1 className="text-ms-xl font-semibold tracking-tight">Langganan Pro</h1>
        <p className="text-ms-sm text-muted-foreground">
          Buka semua fitur MCM Storage. Pembayaran diproses aman lewat penyedia
          pembayaran bawaan aplikasi.
        </p>
      </header>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-ms-2">
            <Crown className="h-5 w-5 text-primary" aria-hidden="true" />
            <CardTitle className="text-ms-base">Status akun</CardTitle>
            <Badge variant={isPro ? "default" : "secondary"} className="ml-auto">
              {isLoading ? "…" : isPro ? "Pro" : "Gratis"}
            </Badge>
          </div>
          <CardDescription>
            {isLoading
              ? "Memeriksa status langganan…"
              : isPro
                ? sub?.cancel_at_period_end
                  ? "Langganan dibatalkan — akses Pro tetap aktif sampai akhir periode."
                  : "Langganan Pro aktif."
                : "Akun masih paket gratis."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-ms-2">
          {isLoading ? (
            <Skeleton className="h-4 w-2/3" />
          ) : (
            <dl className="grid grid-cols-2 gap-ms-2 text-ms-sm">
              <div>
                <dt className="text-ms-2xs text-muted-foreground">Siklus</dt>
                <dd className="font-medium">{sub?.billing_cycle ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-ms-2xs text-muted-foreground">Berlaku sampai</dt>
                <dd className="font-medium tabular-nums">
                  {sub?.period_end
                    ? new Date(sub.period_end).toLocaleDateString("id-ID", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })
                    : "—"}
                </dd>
              </div>
            </dl>
          )}
          <div className="flex flex-wrap gap-ms-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              Segarkan status
            </Button>
            {isPro && (
              <Button
                variant="secondary"
                size="sm"
                onClick={openPortal}
                disabled={portalBusy}
                data-testid="open-billing-portal"
              >
                {portalBusy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
                )}
                Kelola langganan
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-ms-3 sm:grid-cols-2">
        {PLANS.map((plan) => {
          const current = sub?.price_id === plan.priceId && isPro;
          return (
            <Card key={plan.priceId} className={current ? "border-primary/50" : undefined}>
              <CardHeader>
                <div className="flex items-center gap-ms-2">
                  <CardTitle className="text-ms-base">{plan.name}</CardTitle>
                  {plan.note && (
                    <Badge variant="secondary" className="ml-auto text-ms-2xs">
                      {plan.note}
                    </Badge>
                  )}
                </div>
                <CardDescription>
                  <span className="text-ms-xl font-semibold text-foreground tabular-nums">
                    {plan.amountLabel}
                  </span>{" "}
                  {plan.cycleLabel}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-ms-3">
                <ul className="space-y-1.5 text-ms-sm">
                  {BENEFITS.map((b) => (
                    <li key={b} className="flex gap-ms-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full"
                  disabled={busy !== null || current}
                  onClick={() => openCheckout(plan.priceId)}
                >
                  {busy === plan.priceId && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  )}
                  {current ? "Paket aktif" : `Berlangganan ${plan.name}`}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-ms-2xs text-muted-foreground">
        Batal kapan saja — akses Pro tetap berjalan sampai akhir periode yang
        sudah dibayar.
      </p>
    </PageContainer>
  );
}
