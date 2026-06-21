import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getPaddleEnvironment } from "@/lib/paddle";

type Subscription = {
  id: string;
  status: string;
  product_id: string;
  price_id: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  environment: string;
};

export function useSubscription(userId: string | undefined) {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = async () => {
    if (!userId) {
      setSubscription(null);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("subscriptions")
      .select("id,status,product_id,price_id,current_period_end,cancel_at_period_end,environment")
      .eq("user_id", userId)
      .eq("environment", getPaddleEnvironment())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setSubscription((data as Subscription | null) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    refetch();

    if (!userId) return;
    const channel = supabase
      .channel(`subscriptions:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${userId}` },
        () => refetch(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const now = Date.now();
  const periodEndMs = subscription?.current_period_end
    ? new Date(subscription.current_period_end).getTime()
    : null;
  const isActive = !!subscription && (
    (["active", "trialing", "past_due"].includes(subscription.status) &&
      (periodEndMs === null || periodEndMs > now)) ||
    (subscription.status === "canceled" && periodEndMs !== null && periodEndMs > now)
  );

  return { subscription, isActive, loading, refetch };
}