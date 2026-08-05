/**
 * Cron hook: memeriksa ambang Core Web Vitals katalog dan mengirim peringatan.
 * Dilindungi secret (WEB_VITALS_MONITOR_SECRET, fallback LOVABLE_API_KEY).
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/web-vitals-monitor")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth =
          request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ??
          request.headers.get("apikey");
        if (!auth) return new Response("Unauthorized", { status: 401 });

        const envSecret =
          process.env["WEB_VITALS_MONITOR_SECRET"] || process.env["LOVABLE_API_KEY"];
        let allowed = Boolean(envSecret) && auth === envSecret;
        if (!allowed) {
          // Cron database memakai secret bersama di vault (tanpa akses env).
          try {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data } = await supabaseAdmin.rpc("get_email_cron_secret");
            allowed = typeof data === "string" && data.length > 0 && auth === data;
          } catch {
            allowed = false;
          }
        }
        if (!allowed) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const { runWebVitalsAlertCheck } = await import("@/lib/web-vitals-alerts.server");
          return Response.json(await runWebVitalsAlertCheck());
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 500 },
          );
        }
      },
    },
  },
});