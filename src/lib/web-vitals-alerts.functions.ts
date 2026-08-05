/**
 * Server functions admin untuk peringatan Core Web Vitals: baca riwayat +
 * konfigurasi ambang, ubah konfigurasi, jalankan pemeriksaan manual, dan
 * tandai peringatan sudah dibaca.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type VitalsAlertRow = {
  id: string;
  page: string;
  metric: string;
  p75: number;
  threshold: number;
  samples: number;
  window_minutes: number;
  severity: string;
  message: string;
  delivery_status: string;
  acknowledged_at: string | null;
  created_at: string;
};

export type VitalsAlertConfig = {
  enabled: boolean;
  admin_email: string | null;
  lcp_threshold_ms: number;
  cls_threshold: number;
  inp_threshold_ms: number;
  min_samples: number;
  window_minutes: number;
  cooldown_minutes: number;
  last_check_at: string | null;
};

export type VitalsAlertState = {
  isAdmin: boolean;
  config: VitalsAlertConfig | null;
  alerts: VitalsAlertRow[];
};

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  return Boolean(data);
}

export const getVitalsAlertState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<VitalsAlertState> => {
    if (!(await assertAdmin(context))) return { isAdmin: false, config: null, alerts: [] };
    const { supabase } = context;
    const [{ data: cfg }, { data: alerts }] = await Promise.all([
      supabase.from("web_vital_alert_config").select("*").eq("id", 1).maybeSingle(),
      supabase
        .from("web_vital_alerts")
        .select(
          "id, page, metric, p75, threshold, samples, window_minutes, severity, message, delivery_status, acknowledged_at, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    return {
      isAdmin: true,
      config: (cfg as VitalsAlertConfig | null) ?? null,
      alerts: ((alerts ?? []) as VitalsAlertRow[]).map((a) => ({
        ...a,
        p75: Number(a.p75),
        threshold: Number(a.threshold),
      })),
    };
  });

export const updateVitalsAlertConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => {
    const d = (data ?? {}) as Record<string, unknown>;
    const num = (v: unknown, min: number, max: number, fallback: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
    };
    return {
      enabled: d.enabled !== false,
      admin_email:
        typeof d.admin_email === "string" && d.admin_email.trim()
          ? d.admin_email.trim().slice(0, 200)
          : null,
      lcp_threshold_ms: Math.round(num(d.lcp_threshold_ms, 500, 20_000, 2500)),
      cls_threshold: num(d.cls_threshold, 0.01, 1, 0.1),
      inp_threshold_ms: Math.round(num(d.inp_threshold_ms, 50, 5_000, 200)),
      min_samples: Math.round(num(d.min_samples, 1, 5_000, 20)),
      window_minutes: Math.round(num(d.window_minutes, 15, 10_080, 180)),
      cooldown_minutes: Math.round(num(d.cooldown_minutes, 5, 10_080, 180)),
    };
  })
  .handler(async ({ context, data }) => {
    if (!(await assertAdmin(context))) throw new Error("Akses ditolak");
    const { error } = await context.supabase
      .from("web_vital_alert_config")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const acknowledgeVitalsAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => {
    const d = (data ?? {}) as Record<string, unknown>;
    return { id: String(d.id ?? "") };
  })
  .handler(async ({ context, data }) => {
    if (!(await assertAdmin(context))) throw new Error("Akses ditolak");
    const { error } = await context.supabase
      .from("web_vital_alerts")
      .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: context.userId })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const checkVitalsAlertsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await assertAdmin(context))) throw new Error("Akses ditolak");
    const { runWebVitalsAlertCheck } = await import("@/lib/web-vitals-alerts.server");
    return runWebVitalsAlertCheck();
  });