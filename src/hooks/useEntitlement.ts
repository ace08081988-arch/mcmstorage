import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Plan = "free" | "pro";
export type SubStatus = "none" | "trialing" | "active" | "grace" | "expired";

export type Entitlement = {
  loading: boolean;
  uid: string | null;
  plan: Plan;
  status: SubStatus;
  billingCycle: string | null;
  periodEnd: string | null;
  trialUsedAt: string | null;
  isPro: boolean;
  daysLeft: number | null;
  usage: {
    warehouseItems: number;
    salesLast30Days: number;
    staffContacts: number;
    devices: number;
  };
  caps: {
    warehouseItems: number;
    salesLast30Days: number;
    staffContacts: number;
    devices: number;
  };
  refresh: () => Promise<void>;
};

export const FREE_CAPS = {
  warehouseItems: 30,
  salesLast30Days: 50,
  staffContacts: 1,
  devices: 1,
};

export function useEntitlement(): Entitlement {
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<Plan>("free");
  const [status, setStatus] = useState<SubStatus>("none");
  const [billingCycle, setBillingCycle] = useState<string | null>(null);
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);
  const [trialUsedAt, setTrialUsedAt] = useState<string | null>(null);
  const [usage, setUsage] = useState({
    warehouseItems: 0,
    salesLast30Days: 0,
    staffContacts: 0,
    devices: 0,
  });

  const load = async (userId: string) => {
    setLoading(true);
    const [sub, wh, sl, st, dv] = await Promise.all([
      supabase
        .from("subscriptions")
        .select("plan,status,billing_cycle,period_end,trial_used_at")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("warehouse_items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
      supabase
        .from("sales")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", new Date(Date.now() - 30 * 86400 * 1000).toISOString()),
      supabase
        .from("staff_contacts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
      supabase
        .from("user_devices")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
    ]);
    if (sub.data) {
      setPlan((sub.data.plan as Plan) ?? "free");
      setStatus((sub.data.status as SubStatus) ?? "none");
      setBillingCycle(sub.data.billing_cycle ?? null);
      setPeriodEnd(sub.data.period_end ?? null);
      setTrialUsedAt(sub.data.trial_used_at ?? null);
    } else {
      setPlan("free");
      setStatus("none");
      setBillingCycle(null);
      setPeriodEnd(null);
      setTrialUsedAt(null);
    }
    setUsage({
      warehouseItems: wh.count ?? 0,
      salesLast30Days: sl.count ?? 0,
      staffContacts: st.count ?? 0,
      devices: dv.count ?? 0,
    });
    setLoading(false);
  };

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      const id = data.user?.id ?? null;
      if (!mounted) return;
      setUid(id);
      if (id) void load(id);
      else setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const now = Date.now();
  const endMs = periodEnd ? new Date(periodEnd).getTime() : null;
  const isPro =
    plan === "pro" &&
    (status === "trialing" || status === "active" || status === "grace") &&
    (endMs === null || endMs > now);
  const daysLeft =
    isPro && endMs !== null ? Math.max(0, Math.ceil((endMs - now) / 86400000)) : null;

  return {
    loading,
    uid,
    plan,
    status,
    billingCycle,
    periodEnd,
    trialUsedAt,
    isPro,
    daysLeft,
    usage,
    caps: FREE_CAPS,
    refresh: async () => {
      if (uid) await load(uid);
    },
  };
}