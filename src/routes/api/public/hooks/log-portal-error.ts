import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { z } from "zod";

// Alert threshold & cooldown dapat dikonfigurasi lewat env vars agar owner
// bisa menyesuaikan sensitivitas tanpa mengubah kode. Nilai default aman
// untuk produksi. Env vars dibaca di dalam handler (bukan module scope)
// supaya perubahan tercermin tanpa cold-start baru untuk instansi yang
// sama & selalu diverifikasi ulang tiap request.
//
// Env yang didukung:
//   PORTAL_ERROR_ALERT_COUNT           – jumlah event untuk trigger alert (default 5)
//   PORTAL_ERROR_ALERT_WINDOW_SECONDS  – jendela deteksi berulang, detik (default 300)
//   PORTAL_ERROR_ALERT_WINDOW_MINUTES  – alias menit (dipakai bila _SECONDS kosong)
//   PORTAL_ERROR_ALERT_COOLDOWN_SECONDS – cooldown dedup, detik (default 1800)
//   PORTAL_ERROR_ALERT_COOLDOWN_MINUTES – alias menit (mis. "30")

const DEFAULT_ALERT_COUNT = 5;
const DEFAULT_ALERT_WINDOW_SEC = 300;
const DEFAULT_ALERT_COOLDOWN_SEC = 1800;

function readPositiveInt(name: string, fallback: number, min = 1, max = 86400): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function readAlertConfig(): {
  count: number;
  windowSec: number;
  cooldownSec: number;
} {
  const count = readPositiveInt("PORTAL_ERROR_ALERT_COUNT", DEFAULT_ALERT_COUNT, 1, 10_000);
  const windowSec = process.env.PORTAL_ERROR_ALERT_WINDOW_SECONDS
    ? readPositiveInt("PORTAL_ERROR_ALERT_WINDOW_SECONDS", DEFAULT_ALERT_WINDOW_SEC)
    : process.env.PORTAL_ERROR_ALERT_WINDOW_MINUTES
      ? readPositiveInt("PORTAL_ERROR_ALERT_WINDOW_MINUTES", Math.round(DEFAULT_ALERT_WINDOW_SEC / 60), 1, 1440) * 60
      : DEFAULT_ALERT_WINDOW_SEC;
  const cooldownSec = process.env.PORTAL_ERROR_ALERT_COOLDOWN_SECONDS
    ? readPositiveInt("PORTAL_ERROR_ALERT_COOLDOWN_SECONDS", DEFAULT_ALERT_COOLDOWN_SEC)
    : process.env.PORTAL_ERROR_ALERT_COOLDOWN_MINUTES
      ? readPositiveInt("PORTAL_ERROR_ALERT_COOLDOWN_MINUTES", Math.round(DEFAULT_ALERT_COOLDOWN_SEC / 60), 1, 1440) * 60
      : DEFAULT_ALERT_COOLDOWN_SEC;
  return { count, windowSec, cooldownSec };
}

/**
 * Keputusan dedup alert (pure function untuk memudahkan unit test).
 *
 * Input: alert terakhir untuk kombinasi (kind, code) dan konfigurasi.
 * Output:
 *   - `insert`: buat alert baru.
 *   - `merge` : alert masih terbuka, bump `count`/`severity`.
 *   - `suppress`: dalam cooldown atau tidak perlu perubahan.
 */
export type AlertDecision =
  | { action: "insert"; count: number; severity: "warning" | "critical" }
  | {
      action: "merge";
      id: string;
      count: number;
      severity: "warning" | "critical";
    }
  | { action: "suppress"; reason: "cooldown" | "no_change" };

export function decideAlertAction(input: {
  existing: {
    id: string;
    count: number | null;
    severity: string;
    created_at: string;
    acknowledged_at: string | null;
  } | null;
  nowCount: number;
  alertCount: number;
  cooldownSec: number;
  now?: Date;
}): AlertDecision {
  const { existing, nowCount, alertCount, cooldownSec } = input;
  const now = input.now ?? new Date();
  const nextSeverity: "warning" | "critical" =
    nowCount >= alertCount * 3 ? "critical" : "warning";
  const cooldownStart = new Date(now.getTime() - cooldownSec * 1000);

  if (existing && existing.acknowledged_at === null) {
    const mergedCount = Math.max(existing.count ?? 0, nowCount);
    const mergedSeverity: "warning" | "critical" =
      existing.severity === "critical" || nextSeverity === "critical"
        ? "critical"
        : "warning";
    if (mergedCount === (existing.count ?? 0) && mergedSeverity === existing.severity) {
      return { action: "suppress", reason: "no_change" };
    }
    return {
      action: "merge",
      id: existing.id,
      count: mergedCount,
      severity: mergedSeverity,
    };
  }
  if (existing && new Date(existing.created_at).getTime() >= cooldownStart.getTime()) {
    // Sudah di-ack tapi masih dalam cooldown → suppress lintas token.
    return { action: "suppress", reason: "cooldown" };
  }
  return { action: "insert", count: nowCount, severity: nextSeverity };
}

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
        const { count: ALERT_COUNT, windowSec: ALERT_WINDOW_SEC, cooldownSec: ALERT_COOLDOWN_SEC } = readAlertConfig();
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
          // Dedup key: (kind, code) — cooldown berlaku LINTAS token. Kalau alert
          // untuk kombinasi (kind, code) yang sama sudah pernah dibuat dan masih
          // dalam cooldown, request berikutnya (dari token manapun) di-suppress.
          // `code` sudah diredaksi PII di atas, jadi aman dipakai sebagai bagian
          // kunci deduplikasi. Threshold deteksi tetap per (kind, token_hash)
          // supaya satu token nakal tidak menenggelamkan sinyal token lain.
          let openQ = supabase
            .from("portal_error_alerts")
            .select("id, count, severity, created_at, acknowledged_at")
            .eq("kind", kind)
            .order("created_at", { ascending: false })
            .limit(1);
          openQ = code ? openQ.eq("code", code) : openQ.is("code", null);
          const { data: existingRows } = await openQ;
          const existing = existingRows?.[0] ?? null;

          const decision = decideAlertAction({
            existing,
            nowCount,
            alertCount: ALERT_COUNT,
            cooldownSec: ALERT_COOLDOWN_SEC,
          });
          if (decision.action === "merge") {
            await supabase
              .from("portal_error_alerts")
              .update({ count: decision.count, severity: decision.severity })
              .eq("id", decision.id);
          } else if (decision.action === "insert") {
            await supabase.from("portal_error_alerts").insert({
              kind,
              code,
              token_hash: tokenHash,
              count: decision.count,
              window_seconds: ALERT_WINDOW_SEC,
              severity: decision.severity,
            });
          }
          // action === "suppress": biarkan, dedup/cooldown menang.
        }

        return Response.json({ ok: true, ref });
      },
    },
  },
});