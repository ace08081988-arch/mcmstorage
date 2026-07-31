import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { verifyWebhook, EventName, type PaddleEnv } from "@/lib/paddle.server";

let _supabase: ReturnType<typeof createClient<Database>> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _supabase;
}

function cycleFor(priceId: string | undefined): "monthly" | "yearly" {
  return priceId === "mcm_pro_yearly" ? "yearly" : "monthly";
}

/** Peta status Paddle -> status internal aplikasi (free/pro + none..expired). */
function mapStatus(paddleStatus: string, periodEnd?: string | null) {
  const future = periodEnd ? new Date(periodEnd).getTime() > Date.now() : false;
  switch (paddleStatus) {
    case "trialing":
      return { plan: "pro", status: "trialing" };
    case "active":
      return { plan: "pro", status: "active" };
    case "past_due":
    case "paused":
      return { plan: "pro", status: "grace" };
    case "canceled":
      // Tetap aktif sampai akhir periode yang sudah dibayar.
      return future ? { plan: "pro", status: "grace" } : { plan: "free", status: "expired" };
    default:
      return { plan: "pro", status: "active" };
  }
}

async function notifyOwner(userId: string, title: string, body: string) {
  try {
    const { notifyUsers } = await import("@/lib/push.server");
    await notifyUsers({ userIds: [userId], payload: { title, body } as never });
  } catch (e) {
    console.error("notifyOwner failed", e);
  }
}

/**
 * Teruskan peristiwa langganan ke hook WA (n8n) memakai konfigurasi
 * singleton `business_notify_hook_config` yang sudah dipakai fitur lain.
 */
async function notifyWa(kind: string, detail: Record<string, unknown>) {
  try {
    const { data: cfg } = await getSupabase()
      .from("business_notify_hook_config")
      .select("hook_url, enabled")
      .eq("id", true)
      .maybeSingle();
    if (!cfg?.enabled || !cfg.hook_url) return;
    await fetch(cfg.hook_url as string, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, ...detail, at: new Date().toISOString() }),
    });
  } catch (e) {
    console.error("notifyWa failed", e);
  }
}

async function upsertFromSubscription(data: any, env: PaddleEnv) {
  const { id, customerId, items, status, currentBillingPeriod, customData, scheduledChange } = data;
  const userId = customData?.userId;
  if (!userId) {
    console.error("Webhook tanpa customData.userId, dilewati");
    return;
  }
  const item = items?.[0];
  const priceId: string | undefined = item?.price?.importMeta?.externalId ?? undefined;
  if (!priceId) {
    console.warn("Skip: missing importMeta.externalId", { rawPriceId: item?.price?.id });
    return;
  }

  const periodEnd = currentBillingPeriod?.endsAt ?? null;
  const mapped = mapStatus(status, periodEnd);

  const { error } = await getSupabase()
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        plan: mapped.plan,
        status: mapped.status,
        billing_cycle: cycleFor(priceId),
        period_start: currentBillingPeriod?.startsAt ?? null,
        period_end: periodEnd,
        paddle_subscription_id: id,
        paddle_customer_id: customerId,
        price_id: priceId,
        environment: env,
        cancel_at_period_end: scheduledChange?.action === "cancel" || status === "canceled",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  if (error) console.error("upsert subscription gagal", error);
  return { userId, mapped };
}

async function handleWebhook(req: Request, env: PaddleEnv) {
  const event = await verifyWebhook(req, env);

  switch (event.eventType) {
    case EventName.SubscriptionCreated: {
      const res = await upsertFromSubscription(event.data as any, env);
      if (res?.userId) {
        await notifyOwner(res.userId, "Langganan Pro aktif", "Pembayaran berhasil — fitur Pro sudah terbuka.");
        await notifyWa("subscription_started", {
          user_id: res.userId,
          price_id: (event.data as any)?.items?.[0]?.price?.importMeta?.externalId ?? null,
          environment: env,
        });
      }
      break;
    }
    case EventName.SubscriptionUpdated:
      await upsertFromSubscription(event.data as any, env);
      break;
    case EventName.SubscriptionCanceled: {
      const res = await upsertFromSubscription(
        { ...(event.data as any), status: "canceled" },
        env,
      );
      if (res?.userId) {
        await notifyOwner(
          res.userId,
          "Langganan dibatalkan",
          "Akses Pro tetap aktif sampai akhir periode berjalan.",
        );
        await notifyWa("subscription_canceled", {
          user_id: res.userId,
          period_end: (event.data as any)?.currentBillingPeriod?.endsAt ?? null,
          environment: env,
        });
      }
      break;
    }
    default:
      console.log("Event tidak ditangani:", event.eventType);
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const env = (url.searchParams.get("env") || "sandbox") as PaddleEnv;
        try {
          await handleWebhook(request, env);
          return Response.json({ received: true });
        } catch (e) {
          console.error("Webhook error:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
