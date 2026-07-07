import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TurnstileConfig = {
  site_key: string;
  secret_key_masked: string;
  has_secret: boolean;
  updated_at: string | null;
};

/**
 * Public: mengembalikan site_key Turnstile dari DB (fallback env).
 * Dapat dipanggil tanpa autentikasi karena site_key memang publik.
 */
export const getTurnstileSiteKey = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ siteKey: string }> => {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_PUBLISHABLE_KEY!,
        { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
      );
      const { data } = await supabase.rpc("get_turnstile_site_key" as never);
      const fromDb = typeof data === "string" ? data.trim() : "";
      if (fromDb) return { siteKey: fromDb };
    } catch {
      /* fall through to env */
    }
    return { siteKey: (process.env.VITE_TURNSTILE_SITE_KEY ?? "").trim() };
  },
);

/**
 * Admin only: baca config lengkap (secret dimask).
 */
export const getTurnstileConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TurnstileConfig> => {
    const isAdmin = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin.data) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("turnstile_config")
      .select("site_key, secret_key, updated_at")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const secret = (data?.secret_key ?? "") as string;
    const masked =
      secret.length > 8
        ? secret.slice(0, 4) + "…" + secret.slice(-4)
        : secret
          ? "••••••"
          : "";
    return {
      site_key: (data?.site_key ?? "") as string,
      secret_key_masked: masked,
      has_secret: Boolean(secret),
      updated_at: (data?.updated_at ?? null) as string | null,
    };
  });

const updateSchema = z.object({
  site_key: z.string().trim().max(200),
  // Empty string = jangan ubah secret; nilai lain = replace.
  secret_key: z.string().max(200),
  clear_secret: z.boolean().optional().default(false),
});

export const updateTurnstileConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const isAdmin = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin.data) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = {
      site_key: data.site_key,
      updated_by: context.userId,
    };
    if (data.clear_secret) {
      patch.secret_key = "";
    } else if (data.secret_key.trim().length > 0) {
      patch.secret_key = data.secret_key.trim();
    }
    const { error } = await supabaseAdmin
      .from("turnstile_config")
      .update(patch)
      .eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });