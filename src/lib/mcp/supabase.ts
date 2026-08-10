import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext } from "@lovable.dev/mcp-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Buat Supabase client per-request memakai access token dari OAuth
 * bearer yang sudah diverifikasi mcp-js. Semua query berjalan sebagai
 * user Ace Storage tersebut, jadi RLS multi-tenant tetap berlaku persis
 * seperti di aplikasi.
 */
export function supabaseForCaller(ctx: ToolContext): SupabaseClient<Database> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY belum di-set di server");
  }
  const token = ctx.getToken();
  return createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}