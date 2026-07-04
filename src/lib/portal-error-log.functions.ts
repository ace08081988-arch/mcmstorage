import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PortalErrorEventRow = {
  id: string;
  kind: string;
  code: string | null;
  status: string | null;
  route: string | null;
  token_hash: string | null;
  ip_hash: string | null;
  ua: string | null;
  created_at: string;
};

export type PortalErrorAlertRow = {
  id: string;
  kind: string;
  code: string | null;
  token_hash: string | null;
  count: number;
  window_seconds: number;
  severity: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  created_at: string;
};

export type PortalErrorLogResult = {
  isAdmin: boolean;
  fetchedAt: string;
  events: PortalErrorEventRow[];
  alerts: PortalErrorAlertRow[];
  totals: { events24h: number; openAlerts: number; byKind: { kind: string; count: number }[] };
};

export const listPortalErrorLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => {
    const d = (data ?? {}) as Record<string, unknown>;
    const limit = Math.max(1, Math.min(500, Number(d.limit ?? 200) || 200));
    const kind = typeof d.kind === "string" && d.kind.trim() ? d.kind.trim().slice(0, 40) : null;
    return { limit, kind };
  })
  .handler(async ({ context, data }): Promise<PortalErrorLogResult> => {
    const { supabase, userId } = context;
    const now = new Date().toISOString();
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) {
      return {
        isAdmin: false,
        fetchedAt: now,
        events: [],
        alerts: [],
        totals: { events24h: 0, openAlerts: 0, byKind: [] },
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let eventsQ = supabaseAdmin
      .from("portal_error_events")
      .select("id, kind, code, status, route, token_hash, ip_hash, ua, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.kind) eventsQ = eventsQ.eq("kind", data.kind);
    const { data: events } = await eventsQ;

    const { data: alerts } = await supabaseAdmin
      .from("portal_error_alerts")
      .select("id, kind, code, token_hash, count, window_seconds, severity, acknowledged_at, acknowledged_by, created_at")
      .order("created_at", { ascending: false })
      .limit(100);

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: events24h } = await supabaseAdmin
      .from("portal_error_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since24h);
    const { count: openAlerts } = await supabaseAdmin
      .from("portal_error_alerts")
      .select("id", { count: "exact", head: true })
      .is("acknowledged_at", null);

    const { data: recent } = await supabaseAdmin
      .from("portal_error_events")
      .select("kind")
      .gte("created_at", since24h)
      .limit(2000);
    const byMap = new Map<string, number>();
    (recent ?? []).forEach((r: { kind: string }) => byMap.set(r.kind, (byMap.get(r.kind) ?? 0) + 1));
    const byKind = Array.from(byMap.entries())
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count);

    return {
      isAdmin: true,
      fetchedAt: now,
      events: (events ?? []) as PortalErrorEventRow[],
      alerts: (alerts ?? []) as PortalErrorAlertRow[],
      totals: { events24h: events24h ?? 0, openAlerts: openAlerts ?? 0, byKind },
    };
  });

export const acknowledgePortalErrorAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => {
    const d = (data ?? {}) as Record<string, unknown>;
    const id = typeof d.id === "string" ? d.id : "";
    if (!id) throw new Error("id required");
    return { id };
  })
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) return { ok: false as const, error: "forbidden" };
    const { error } = await supabase
      .from("portal_error_alerts")
      .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: userId })
      .eq("id", data.id);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });