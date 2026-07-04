import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { z } from "zod";

// Alert threshold: N event dgn kind+token_hash yg sama dalam window seconds.
const ALERT_COUNT = 5;
const ALERT_WINDOW_SEC = 300;
const ALERT_COOLDOWN_SEC = 600;

const PayloadSchema = z.object({
  kind: z.string().min(1).max(40),
  code: z.string().max(80).optional().nullable(),
  status: z.string().max(40).optional().nullable(),
  route: z.string().max(120).optional().nullable(),
  token: z.string().max(200).optional().nullable(),
});

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

// Buang pola PII yang mungkin bocor lewat kolom `code`/`status`:
// email, no HP, UUID panjang, JWT-like, path token.
function redact(value: string | null | undefined): string | null {
  if (!value) return null;
  let s = String(value).slice(0, 200);
  s = s.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]");
  s = s.replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]");
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[uuid]");
  s = s.replace(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, "[jwt]");
  return s;
}

function clientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xr = request.headers.get("x-real-ip");
  if (xr) return xr.trim();
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return "0.0.0.0";
}

export const Route = createFileRoute("/api/public/hooks/log-portal-error")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response("bad_json", { status: 400 });
        }
        const parsed = PayloadSchema.safeParse(body);
        if (!parsed.success) return new Response("bad_payload", { status: 400 });

        const supabaseUrl = process.env.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !serviceKey) {
          return Response.json({ error: "config_missing" }, { status: 500 });
        }
        const supabase = createClient(supabaseUrl, serviceKey);

        const kind = parsed.data.kind.slice(0, 40);
        const code = redact(parsed.data.code ?? null);
        const status = redact(parsed.data.status ?? null);
        const route = redact(parsed.data.route ?? null);
        const tokenHash = parsed.data.token ? sha256(parsed.data.token) : null;
        const ipHash = sha256(clientIp(request));
        const ua = (request.headers.get("user-agent") ?? "").slice(0, 200);

        const { data: inserted, error: insErr } = await supabase
          .from("portal_error_events")
          .insert({ kind, code, status, route, token_hash: tokenHash, ip_hash: ipHash, ua })
          .select("id")
          .single();
        if (insErr) {
          console.error("[log-portal-error] insert failed", insErr.message);
          return Response.json({ ok: false }, { status: 500 });
        }

        // Referensi pendek yg bisa ditampilkan ke user tanpa membocorkan detail.
        const ref = String(inserted.id).slice(0, 8);

        // Deteksi error berulang -> alert
        const sinceIso = new Date(Date.now() - ALERT_WINDOW_SEC * 1000).toISOString();
        let countQ = supabase
          .from("portal_error_events")
          .select("id", { count: "exact", head: true })
          .eq("kind", kind)
          .gte("created_at", sinceIso);
        if (tokenHash) countQ = countQ.eq("token_hash", tokenHash);
        const { count } = await countQ;

        if ((count ?? 0) >= ALERT_COUNT) {
          // cooldown: jangan buat alert baru bila sudah ada dalam ALERT_COOLDOWN_SEC
          const cooldownIso = new Date(Date.now() - ALERT_COOLDOWN_SEC * 1000).toISOString();
          let recentQ = supabase
            .from("portal_error_alerts")
            .select("id", { count: "exact", head: true })
            .eq("kind", kind)
            .gte("created_at", cooldownIso);
          if (tokenHash) recentQ = recentQ.eq("token_hash", tokenHash);
          const { count: recentAlerts } = await recentQ;
          if ((recentAlerts ?? 0) === 0) {
            await supabase.from("portal_error_alerts").insert({
              kind,
              code,
              token_hash: tokenHash,
              count: count ?? 0,
              window_seconds: ALERT_WINDOW_SEC,
              severity: (count ?? 0) >= ALERT_COUNT * 3 ? "critical" : "warning",
            });
          }
        }

        return Response.json({ ok: true, ref });
      },
    },
  },
});