import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Returns the latest applied migration version (timestamp string).
 * Used by the in-app banner that reminds the admin to re-run the
 * security scan after schema/policy changes.
 */
export const getLatestSchemaVersion = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data, error } = await supabaseAdmin
      .schema("supabase_migrations" as never)
      .from("schema_migrations" as never)
      .select("version")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      // Schema not accessible — fail soft so banner just hides.
      return { version: null as string | null };
    }
    const row = data as { version?: string } | null;
    return { version: row?.version ?? null };
  });