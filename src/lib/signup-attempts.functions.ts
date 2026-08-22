import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// C9: admin-only server function. Sebelumnya `/admin/signup-attempts`
// query `supabase.from("signup_attempts")` langsung dari client — bergantung
// penuh pada RLS. Sekarang double-gated: has_role admin server-side +
// baca via supabaseAdmin (service role) supaya PII (email/IP/UA) tidak
// pernah bisa dibaca lewat API oleh non-admin.

export type SignupAttemptRow = {
  id: number;
  ip: string;
  email: string | null;
  succeeded: boolean;
  created_at: string;
  user_agent: string | null;
};

export type SignupAttemptStatus = "all" | "success" | "failed";

export type ListSignupAttemptsResult = {
  isAdmin: boolean;
  fetchedAt: string;
  rows: SignupAttemptRow[];
};

type ListInput = {
  from?: string | null;
  to?: string | null;
  status?: SignupAttemptStatus;
  limit?: number;
};

function toIsoStart(d: string | null | undefined): string | null {
  if (!d) return null;
  const dt = new Date(`${d}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}
function toIsoEnd(d: string | null | undefined): string | null {
  if (!d) return null;
  const dt = new Date(`${d}T23:59:59.999`);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

export const listSignupAttempts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown): ListInput => {
    const d = (data ?? {}) as Record<string, unknown>;
    const clean = (v: unknown): string | null => {
      if (typeof v !== "string") return null;
      const s = v.trim();
      return s.length === 0 ? null : s.slice(0, 32);
    };
    const statusRaw = typeof d.status === "string" ? d.status : "all";
    const status: SignupAttemptStatus =
      statusRaw === "success" || statusRaw === "failed" ? statusRaw : "all";
    const limitRaw = typeof d.limit === "number" ? d.limit : 200;
    const limit = Math.max(1, Math.min(1000, Math.floor(limitRaw));
    return { from: clean(d.from), to: clean(d.to), status, limit };
  })
  .handler(async ({ context, data }): Promise<ListSignupAttemptsResult> => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    const now = new Date().toISOString();
    if (!isAdmin) {
      void import('./admin-denial-telemetry.server').then((m) => m.logAdminDenial({
        fn: "signup-attempts:listSignupAttempts",
        userId,
      }));
      return { isAdmin: false, fetchedAt: now, rows: [] };
    }

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    let q = supabaseAdmin
      .from("signup_attempts")
      .select("id, ip, email, succeeded, created_at, user_agent")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 200);

    const iso1 = toIsoStart(data.from);
    const iso2 = toIsoEnd(data.to);
    if (iso1) q = q.gte("created_at", iso1);
    if (iso2) q = q.lte("created_at", iso2);
    if (data.status === "success") q = q.eq("succeeded", true);
    else if (data.status === "failed") q = q.eq("succeeded", false);

    const { data: rows } = await q;
    return {
      isAdmin: true,
      fetchedAt: now,
      rows: (rows ?? []) as SignupAttemptRow[],
    };
  });