import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Public tracking endpoint for APK download button clicks on /download.
// Fire-and-forget (fetch keepalive / sendBeacon). Never returns PII.
export const Route = createFileRoute("/api/public/apk-download-track")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => null)) as
            | { variant?: unknown; source?: unknown }
            | null;
          const variant =
            body?.variant === "chat" || body?.variant === "storage"
              ? body.variant
              : null;
          const source =
            body?.source === "copy_page" ||
            body?.source === "copy_file" ||
            body?.source === "button"
              ? body.source
              : "button";
          if (!variant) {
            return Response.json({ ok: false, error: "bad_variant" }, { status: 400 });
          }

          const url = process.env.SUPABASE_URL;
          const key = process.env.SUPABASE_PUBLISHABLE_KEY;
          if (!url || !key) {
            return Response.json({ ok: false, error: "config" }, { status: 500 });
          }

          // Preserve caller identity if a bearer token is provided so user_id
          // is populated via RLS-friendly auth.uid(); anon inserts are also allowed.
          const authHeader = request.headers.get("authorization") ?? undefined;
          const client = createClient(url, key, {
            auth: { persistSession: false, autoRefreshToken: false },
            global: authHeader ? { headers: { Authorization: authHeader } } : undefined,
          });

          let userId: string | null = null;
          if (authHeader) {
            const { data } = await client.auth.getUser();
            userId = data.user?.id ?? null;
          }

          const referrer = (request.headers.get("referer") ?? "").slice(0, 500) || null;
          const ua = (request.headers.get("user-agent") ?? "").slice(0, 500) || null;

          const { error } = await client.from("apk_download_events").insert({
            variant,
            source,
            user_id: userId,
            referrer,
            user_agent: ua,
          });
          if (error) {
            return Response.json({ ok: false, error: "insert_failed" }, { status: 500 });
          }
          return Response.json({ ok: true });
        } catch {
          return Response.json({ ok: false, error: "internal" }, { status: 500 });
        }
      },
    },
  },
});