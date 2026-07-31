/**
 * Halaman paket & checkout langganan MCM Storage Pro.
 * Status langganan dibaca dari tabel `subscriptions` (SSOT yang sama dengan
 * has_active_pro), checkout dibuka lewat overlay pembayaran bawaan.
 */
import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Crown,
  ExternalLink,
  Landmark,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { PageContainer } from "@/components/layout/PageContainer";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { ManualTransferDialog } from "@/components/subscription/ManualTransferDialog";
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
  IDR_PER_USD,
  MANUAL_PRICE_IDR,
  PLANS,
  TRIAL_DAYS,
  formatIdr,
  getPaddleEnvironment,
  getPaddlePriceId,
  initializePaddle,
  type PlanPriceId,
} from "@/lib/paddle";
import { changeSubscriptionPlan, createPortalSession } from "@/utils/payments.functions";

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
  const env = getPaddleEnvironment();
  return useQuery({
    queryKey: ["subscription", env],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return null;
      // Baris langganan dipisah per lingkungan. Baris "live" adalah yang
      // sebenarnya; baris "sandbox" hanya hasil uji coba di pratinjau.
      const [{ data: rows }, { data: pays }, { data: events }] = await Promise.all([
        supabase
          .from("subscriptions")
          .select(
            "plan,status,billing_cycle,period_end,cancel_at_period_end,price_id,environment,source,paddle_subscription_id",
          )
          .eq("user_id", uid),
        supabase
          .from("subscription_payments")
          .select("id,amount_idr,billing_cycle,status,created_at,admin_note")
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("subscription_events")
          .select("id,kind,amount,currency_code,occurred_at")
          .eq("user_id", uid)
          .eq("environment", env)
          .order("occurred_at", { ascending: false })
          .limit(5),
      ]);
      const list = rows ?? [];
      // Langganan manual berlaku di kedua mode, jadi tetap diprioritaskan
      // kalau baris lingkungan aktif belum berisi apa-apa.
      const sub =
        list.find((r) => r.environment === env && r.plan === "pro") ??
        list.find((r) => r.source !== "paddle" && r.plan === "pro") ??
        list.find((r) => r.environment === env) ??
        list[0] ??
        null;
      return {
        uid,
        email: userData.user?.email ?? undefined,
        sub,
        payments: pays ?? [],
        events: events ?? [],
      };
    },
  });
}

function LanggananPage() {
  const { data, isLoading, refetch, isFetching } = useSubscription();
  const [busy, setBusy] = useState<PlanPriceId | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const env = getPaddleEnvironment();

  // Setelah checkout selesai, webhook butuh sesaat untuk menulis status.
  useEffect(() => {
    const onFocus = () => refetch();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refetch]);

  const sub = data?.sub ?? null;
  const isPro =
    sub?.plan === "pro" && ["trialing", "active", "grace"].includes(sub?.status ?? "");
  const isTrial = sub?.status === "trialing";
  const isGrace = sub?.status === "grace";
  /** Ganti paket hanya mungkin pada langganan kartu yang masih hidup. */
  const canSwitch = Boolean(isPro && sub?.paddle_subscription_id && sub?.source === "paddle");

  const openCheckout = async (priceId: PlanPriceId) => {
    if (!data?.uid) {
      toast.error("Sesi tidak ditemukan, coba masuk ulang.");
      return;
    }
    // Sudah punya langganan kartu → UBAH item langganan yang ada. Membuka
    // checkout baru akan membuat langganan kedua dan pelanggan tertagih dua
    // kali di penyedia.
    if (canSwitch) {
      setBusy(priceId);
      const tt = toast.loading("Mengganti paket…");
      try {
        await changeSubscriptionPlan({ data: { priceId, environment: env } });
        toast.success("Paket diganti — selisih harga dihitung prorata", { id: tt });
        setTimeout(() => refetch(), 1500);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Gagal mengganti paket", { id: tt });
      } finally {
        setBusy(null);
      }
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
      const res = await createPortalSession({ data: { environment: env } });
      window.open(res.cancelUrl ?? res.overviewUrl, "_blank", "noopener");
      toast.success("Portal dibuka di tab baru", { id: t });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membuka portal", { id: t });
    } finally {
      setPortalBusy(false);
    }
  };

  const pendingManual = (data?.payments ?? []).find((p) => p.status === "pending");

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

      {isGrace && (
        <Card className="border-warning/50 bg-warning/5">
          <CardHeader>
            <div className="flex items-center gap-ms-2">
              <AlertTriangle className="h-5 w-5 text-warning" aria-hidden="true" />
              <CardTitle className="text-ms-base">Pembayaran perlu diperbarui</CardTitle>
            </div>
            <CardDescription>
              Tagihan terakhir belum berhasil diproses. Akses Pro masih berjalan
              sementara, perbarui metode pembayaran agar tidak terputus.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="sm" onClick={openPortal} disabled={portalBusy}>
              Perbarui pembayaran
            </Button>
          </CardContent>
        </Card>
      )}

      {pendingManual && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="text-ms-base">Bukti transfer sedang diperiksa</CardTitle>
            <CardDescription>
              {formatIdr(pendingManual.amount_idr)} ·{" "}
              {pendingManual.billing_cycle === "yearly" ? "Tahunan" : "Bulanan"} — akses
              Pro terbuka setelah admin memverifikasi.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-ms-2">
            <Crown className="h-5 w-5 text-primary" aria-hidden="true" />
            <CardTitle className="text-ms-base">Status akun</CardTitle>
            <Badge variant={isPro ? "default" : "secondary"} className="ml-auto">
              {isLoading ? "…" : isTrial ? "Uji coba" : isPro ? "Pro" : "Gratis"}
            </Badge>
          </div>
          <CardDescription>
            {isLoading
              ? "Memeriksa status langganan…"
              : isTrial
                ? `Masa uji coba gratis ${TRIAL_DAYS} hari sedang berjalan.`
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
            <dl className="grid grid-cols-2 gap-ms-2 text-ms-sm sm:grid-cols-3">
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
              <div>
                <dt className="text-ms-2xs text-muted-foreground">Metode</dt>
                <dd className="font-medium">
                  {sub?.source === "manual"
                    ? "Transfer bank"
                    : sub?.source === "promo"
                      ? "Promo"
                      : sub?.paddle_subscription_id
                        ? "Kartu"
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => setManualOpen(true)}
              data-testid="open-manual-transfer"
            >
              <Landmark className="mr-2 h-4 w-4" aria-hidden="true" />
              Bayar transfer (Rupiah)
            </Button>
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
                  <span className="mt-0.5 block text-ms-2xs text-muted-foreground">
                    ± {formatIdr(plan.amountUsd * IDR_PER_USD)} · ditagih dalam USD ·
                    transfer bank {formatIdr(MANUAL_PRICE_IDR[plan.cycle])}
                  </span>
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
                  {current
                    ? "Paket aktif"
                    : canSwitch
                      ? `Ganti ke ${plan.name}`
                      : `Coba gratis ${TRIAL_DAYS} hari`}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {(data?.events?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-ms-base">Riwayat pembayaran</CardTitle>
            <CardDescription>5 transaksi terakhir pada akun ini.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-ms-sm">
              {data!.events.map((ev) => (
                <li key={ev.id} className="flex items-center justify-between py-2">
                  <span>
                    {ev.kind === "payment_failed" ? "Gagal" : "Berhasil"} ·{" "}
                    {new Date(ev.occurred_at).toLocaleDateString("id-ID", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {ev.amount
                      ? `${(Number(ev.amount) / 100).toFixed(2)} ${ev.currency_code ?? ""}`
                      : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="text-ms-2xs text-muted-foreground">
        Uji coba {TRIAL_DAYS} hari, batal kapan saja — akses Pro tetap berjalan
        sampai akhir periode yang sudah dibayar. Pembayaran kartu ditagih dalam
        USD oleh Paddle sebagai Merchant of Record; nilai Rupiah adalah estimasi.
      </p>

      <ManualTransferDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        onSubmitted={() => refetch()}
      />
    </PageContainer>
  );
}
