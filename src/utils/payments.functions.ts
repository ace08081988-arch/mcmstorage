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
  .handler(async ({ context }) => {
    const { data: sub, error } = await context.supabase
      .from("subscriptions")
      .select("paddle_customer_id, paddle_subscription_id, environment")
      .eq("user_id", context.userId)
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
