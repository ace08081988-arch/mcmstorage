/**
 * Telemetri ringan untuk penolakan akses admin di server fn.
 *
 * Tujuan: melacak route/halaman mana yang MASIH memicu pemanggilan
 * server fn admin dari user non-admin, walau UI sudah punya guard.
 * Sengaja tidak menulis ke tabel supaya tidak menambah beban DB; log
 * berbentuk JSON satu baris sehingga mudah difilter di server logs.
 *
 * Harus dipanggil HANYA dari dalam body `.handler()` server fn (setelah
 * `requireSupabaseAuth`), karena bergantung pada `getRequestHeader`.
 */
import { getRequestHeader } from "@tanstack/react-start/server";

export function logAdminDenial(params: {
  fn: string;
  userId?: string | null;
  reason?: string;
}): void {
  try {
    const referer =
      getRequestHeader("referer") ?? getRequestHeader("referrer") ?? null;
    const ua = getRequestHeader("user-agent") ?? null;
    const reason = params.reason ?? "not_admin";
    const userId = params.userId ?? null;
    // eslint-disable-next-line no-console
    console.warn(
      "[admin-denial] " +
        JSON.stringify({
          fn: params.fn,
          userId,
          reason,
          referer,
          ua,
          at: new Date().toISOString(),
        }),
    );
    // Persist ke tabel supaya bisa dicari/difilter dari dashboard admin.
    // Fire-and-forget: kegagalan telemetri tidak boleh mengubah perilaku
    // denial dan tidak boleh menahan response ke client.
    void (async () => {
      try {
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        await supabaseAdmin.from("admin_denial_events").insert({
          fn: params.fn,
          user_id: userId,
          reason,
          referer,
          ua,
        });
      } catch {
        // ignore
      }
    })();
  } catch {
    // Telemetri tidak boleh mengubah perilaku denial.
  }
}