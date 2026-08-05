/**
 * Agregasi Core Web Vitals untuk laporan admin.
 *
 * Semua metrik dilaporkan sebagai p75 (standar Google CWV) per hari dan per
 * periode, plus perbandingan "sebelum vs sesudah" antara dua jendela waktu
 * yang sama panjang supaya efek optimasi terlihat.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type VitalsPage = "katalog_list" | "katalog_detail";
export type VitalsMetric = "LCP" | "CLS" | "INP" | "TTFB" | "FCP";

export type VitalsWindowStat = {
  metric: VitalsMetric;
  p75: number | null;
  samples: number;
  goodRatio: number | null;
};

export type VitalsDaily = {
  day: string;
  metric: VitalsMetric;
  p75: number;
  samples: number;
};

export type VitalsReport = {
  isAdmin: boolean;
  fetchedAt: string;
  days: number;
  page: VitalsPage;
  device: "all" | "mobile" | "desktop";
  totalSamples: number;
  after: VitalsWindowStat[];
  before: VitalsWindowStat[];
  daily: VitalsDaily[];
};

type Input = {
  page: VitalsPage;
  days: number;
  device: "all" | "mobile" | "desktop";
};

const METRICS: VitalsMetric[] = ["LCP", "CLS", "INP", "TTFB", "FCP"];

function p75(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.75) - 1);
  return sorted[Math.max(0, idx)] ?? null;
}

type Row = { created_at: string; metric: string; value: number; rating: string };

function windowStats(rows: Row[]): VitalsWindowStat[] {
  return METRICS.map((metric) => {
    const subset = rows.filter((r) => r.metric === metric);
    const good = subset.filter((r) => r.rating === "good").length;
    return {
      metric,
      p75: p75(subset.map((r) => r.value)),
      samples: subset.length,
      goodRatio: subset.length ? good / subset.length : null,
    };
  });
}

export const getWebVitalsReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown): Input => {
    const d = (data ?? {}) as Record<string, unknown>;
    const page: VitalsPage = d.page === "katalog_detail" ? "katalog_detail" : "katalog_list";
    const daysRaw = typeof d.days === "number" ? d.days : 7;
    const days = Math.max(1, Math.min(30, Math.floor(daysRaw)));
    const device =
      d.device === "mobile" || d.device === "desktop" ? d.device : ("all" as const);
    return { page, days, device };
  })
  .handler(async ({ context, data }): Promise<VitalsReport> => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    const now = new Date();
    const base = {
      fetchedAt: now.toISOString(),
      days: data.days,
      page: data.page,
      device: data.device,
    };
    if (!isAdmin) {
      return {
        ...base,
        isAdmin: false,
        totalSamples: 0,
        after: [],
        before: [],
        daily: [],
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const msPerDay = 86_400_000;
    const afterStart = new Date(now.getTime() - data.days * msPerDay);
    const beforeStart = new Date(now.getTime() - 2 * data.days * msPerDay);

    let q = supabaseAdmin
      .from("web_vital_samples")
      .select("created_at, metric, value, rating")
      .eq("page", data.page)
      .gte("created_at", beforeStart.toISOString())
      .order("created_at", { ascending: true })
      .limit(50_000);
    if (data.device !== "all") q = q.eq("device", data.device);

    const { data: rowsRaw } = await q;
    const rows = ((rowsRaw ?? []) as Row[]).map((r) => ({ ...r, value: Number(r.value) }));
    const after = rows.filter((r) => new Date(r.created_at) >= afterStart);
    const before = rows.filter((r) => new Date(r.created_at) < afterStart);

    const byDay = new Map<string, Row[]>();
    for (const r of rows) {
      const day = r.created_at.slice(0, 10);
      const list = byDay.get(day);
      if (list) list.push(r);
      else byDay.set(day, [r]);
    }
    const daily: VitalsDaily[] = [];
    for (const [day, list] of [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      for (const metric of METRICS) {
        const subset = list.filter((r) => r.metric === metric).map((r) => r.value);
        const v = p75(subset);
        if (v != null) daily.push({ day, metric, p75: v, samples: subset.length });
      }
    }

    return {
      ...base,
      isAdmin: true,
      totalSamples: rows.length,
      after: windowStats(after),
      before: windowStats(before),
      daily,
    };
  });