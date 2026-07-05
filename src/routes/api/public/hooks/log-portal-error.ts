import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { z } from "zod";

// Alert threshold: N event dgn (kind, code, token_hash) yg sama dalam window seconds.
const ALERT_COUNT = 5;
const ALERT_WINDOW_SEC = 300;
// Cooldown deduplikasi: selama window ini, error yang sama tidak membuat alert baru.
// Bila ada alert terbuka (belum di-ack) untuk key yang sama, kita hanya menaikkan
// count/severity-nya, bukan membuat baris baru — jadi admin tidak dispam.
const ALERT_COOLDOWN_SEC = 1800; // 30 menit

const PayloadSchema = z.object({
  kind: z.string().min(1).max(40),
  code: z.string().max(80).optional().nullable(),
  status: z.string().max(40).optional().nullable(),
  route: z.string().max(120).optional().nullable(),
  // Wajib: worker portal selalu mengirim share_token dari URL PIN.
  // Endpoint publik ini terautentikasi lewat pengetahuan share_token
  // yang masih aktif — tanpa itu, tidak ada log dan tidak ada alert.
  token: z.string().min(8).max(200),
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
        const rawToken = parsed.data.token;

        // Verifikasi token: harus cocok dengan prep_tasks.share_token yang
        // masih aktif (status != revoked, belum kedaluwarsa). Anonim POST
        // tanpa token valid → 401. Menutup dua vektor abuse: (1) sampah di
        // portal_error_events, (2) spam admin lewat portal_error_alerts.
        const { data: task, error: taskErr } = await supabase
          .from("prep_tasks")
          .select("id, status, expires_at")
          .eq("share_token", rawToken)
          .maybeSingle();
        if (taskErr) {
          console.error("[log-portal-error] token lookup failed", taskErr.message);
          return Response.json({ ok: false }, { status: 500 });
        }
        if (!task) return new Response("invalid_token", { status: 401 });
        if (task.status === "revoked") {
          return new Response("token_revoked", { status: 401 });
        }
        if (task.expires_at && new Date(task.expires_at).getTime() < Date.now()) {
          return new Response("token_expired", { status: 401 });
        }

        const tokenHash = sha256(rawToken);
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
        const countQ = supabase
          .from("portal_error_events")
          .select("id", { count: "exact", head: true })
          .eq("kind", kind)
          .eq("token_hash", tokenHash)
          .gte("created_at", sinceIso);
        const { count } = await countQ;

        if ((count ?? 0) >= ALERT_COUNT) {
          const nowCount = count ?? 0;
          const nextSeverity = nowCount >= ALERT_COUNT * 3 ? "critical" : "warning";
          const cooldownIso = new Date(Date.now() - ALERT_COOLDOWN_SEC * 1000).toISOString();

          // Dedup key: (kind, code, token_hash). `code` sudah diredaksi PII di atas,
          // jadi aman dipakai sebagai bagian kunci deduplikasi.
          let openQ = supabase
            .from("portal_error_alerts")
            .select("id, count, severity, created_at, acknowledged_at")
            .eq("kind", kind)
            .eq("token_hash", tokenHash)
            .order("created_at", { ascending: false })
            .limit(1);
          openQ = code ? openQ.eq("code", code) : openQ.is("code", null);
          const { data: existingRows } = await openQ;
          const existing = existingRows?.[0] ?? null;

          if (existing && existing.acknowledged_at === null) {
            // Alert masih terbuka → gabungkan (bump count + severity), jangan buat baru.
            const mergedCount = Math.max(existing.count ?? 0, nowCount);
            const mergedSeverity =
              existing.severity === "critical" || nextSeverity === "critical"
                ? "critical"
                : "warning";
            if (mergedCount !== existing.count || mergedSeverity !== existing.severity) {
              await supabase
                .from("portal_error_alerts")
                .update({ count: mergedCount, severity: mergedSeverity })
                .eq("id", existing.id);
            }
          } else if (existing && existing.created_at >= cooldownIso) {
            // Sudah di-ack tapi masih dalam cooldown → suppress, jangan bikin baru.
          } else {
            await supabase.from("portal_error_alerts").insert({
              kind,
              code,
              token_hash: tokenHash,
              count: nowCount,
              window_seconds: ALERT_WINDOW_SEC,
              severity: nextSeverity,
            });
          }
        }

        return Response.json({ ok: true, ref });
      },
    },
  },
});