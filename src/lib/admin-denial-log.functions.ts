import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAdminDenial } from "./admin-denial-telemetry";

export type AdminDenialEventRow = {
  id: string;
  fn: string;
  user_id: string | null;
  reason: string;
  referer: string | null;
  ua: string | null;
  created_at: string;
};

export type AdminDenialLogResult = {
  isAdmin: boolean;
  fetchedAt: string;
  rows: AdminDenialEventRow[];
  total: number;
  fnOptions: string[];
};

type ListInput = {
  fn?: string | null;
  userId?: string | null;
  referer?: string | null;
  limit?: number | null;
};

export const listAdminDenialEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown): ListInput => {
    const d = (data ?? {}) as Record<string, unknown>;
    const clean = (v: unknown) => {
      if (typeof v !== "string") return null;
      const s = v.trim();
      return s.length === 0 ? null : s.slice(0, 200);
    };
    const limitRaw = typeof d.limit === "number" ? d.limit : 200;
    const limit = Math.max(1, Math.min(500, Math.floor(limitRaw)));
    return {
      fn: clean(d.fn),
      userId: clean(d.userId),
      referer: clean(d.referer),
      limit,
    };
  })
  .handler(async ({ context, data }): Promise<AdminDenialLogResult> => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    const now = new Date().toISOString();
    if (!isAdmin) {
      logAdminDenial({ fn: "admin-denial-log:listAdminDenialEvents", userId });
      return {
        isAdmin: false,
        fetchedAt: now,
        rows: [],
        total: 0,
        fnOptions: [],
      };
    }

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const limit = data.limit ?? 200;

    let q = supabaseAdmin
      .from("admin_denial_events")
      .select("id, fn, user_id, reason, referer, ua, created_at", {
        count: "exact",
      })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (data.fn) q = q.eq("fn", data.fn);
    if (data.userId) q = q.eq("user_id", data.userId);
    if (data.referer) q = q.ilike("referer", `%${data.referer}%`);

    const { data: rows, count } = await q;

    // Ambil daftar fn unik untuk dropdown filter (batasi ke 30 hari terakhir).
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: fnRows } = await supabaseAdmin
      .from("admin_denial_events")
      .select("fn")
      .gte("created_at", since)
      .limit(1000);
    const fnSet = new Set<string>();
    (fnRows ?? []).forEach((r: { fn: string }) => fnSet.add(r.fn));
    const fnOptions = Array.from(fnSet).sort();

    return {
      isAdmin: true,
      fetchedAt: now,
      rows: (rows ?? []) as AdminDenialEventRow[],
      total: count ?? rows?.length ?? 0,
      fnOptions,
    };
  });