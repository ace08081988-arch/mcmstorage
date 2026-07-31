import { createServerFn } from "@tanstack/react-start";
import { gatewayFetch, type PaddleEnv } from "@/lib/paddle.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const resolvePaddlePrice = createServerFn({ method: "GET" })
  .inputValidator((data: { priceId: string; environment: PaddleEnv }) => data)
  .handler(async ({ data }) => {
    const response = await gatewayFetch(
      data.environment,
      `/prices?external_id=${encodeURIComponent(data.priceId)}`,
    );
    const result = await response.json();
    if (!result.data?.length) throw new Error("Harga tidak ditemukan");
    return result.data[0].id as string;
  });

/**
 * Buka portal pelanggan penyedia pembayaran (batal langganan, ganti kartu,
 * lihat invoice). URL bersifat sementara — selalu buat baru.
 */
export const createPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: PaddleEnv }) => data)
  .handler(async ({ data, context }) => {
    const { data: sub, error } = await context.supabase
      .from("subscriptions")
      .select("paddle_customer_id, paddle_subscription_id, environment")
      .eq("user_id", context.userId)
      .eq("environment", data.environment)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!sub?.paddle_customer_id) {
      throw new Error("Belum ada langganan berbayar pada akun ini.");
    }

    const { getPaddleClient } = await import("@/lib/paddle.server");
    const paddle = getPaddleClient((sub.environment ?? "sandbox") as PaddleEnv);
    const session = await paddle.customerPortalSessions.create(
      sub.paddle_customer_id,
      sub.paddle_subscription_id ? [sub.paddle_subscription_id] : [],
    );
    return {
      overviewUrl: session.urls.general.overview as string,
      cancelUrl: (session.urls.subscriptions?.[0]?.cancelSubscription ?? null) as
        | string
        | null,
    };
  });

/**
 * Ganti paket (bulanan <-> tahunan) pada langganan yang SUDAH aktif.
 *
 * Ini penting: tanpa ini, menekan tombol paket lain akan membuka checkout
 * baru sehingga pelanggan punya DUA langganan berjalan di penyedia dan
 * tertagih dua kali. Di sini kita mengubah item langganan yang ada dengan
 * perhitungan prorata langsung — selisih hari yang belum terpakai
 * diperhitungkan pada tagihan saat itu juga.
 */
export const changeSubscriptionPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { priceId: string; environment: PaddleEnv }) => data)
  .handler(async ({ data, context }) => {
    const { data: sub, error } = await context.supabase
      .from("subscriptions")
      .select("paddle_subscription_id, status, price_id, environment")
      .eq("user_id", context.userId)
      .eq("environment", data.environment)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!sub?.paddle_subscription_id) {
      throw new Error("Tidak ada langganan kartu aktif untuk diubah.");
    }
    if (sub.price_id === data.priceId) {
      throw new Error("Anda sudah memakai paket ini.");
    }

    const response = await gatewayFetch(
      data.environment,
      `/prices?external_id=${encodeURIComponent(data.priceId)}`,
    );
    const priceResult = await response.json();
    const paddlePriceId = priceResult.data?.[0]?.id as string | undefined;
    if (!paddlePriceId) throw new Error("Harga tujuan tidak ditemukan.");

    const { getPaddleClient } = await import("@/lib/paddle.server");
    const paddle = getPaddleClient(data.environment);
    const updated = await paddle.subscriptions.update(sub.paddle_subscription_id, {
      items: [{ priceId: paddlePriceId, quantity: 1 }],
      prorationBillingMode: "prorated_immediately",
    });

    return {
      ok: true as const,
      status: updated.status as string,
      nextBilledAt: (updated.nextBilledAt ?? null) as string | null,
    };
  });
