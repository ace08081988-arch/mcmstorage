import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";

// Public endpoint: validate (share_token, PIN) for a prep task and mint a
// short-lived JWT that the worker portal hands to `supabase.realtime.setAuth`.
// The JWT carries a `share_token` custom claim so the `realtime.messages`
// RLS policy can scope subscriptions to `prep:<share_token>` only.
//
// Requires SUPABASE_JWT_SECRET (the project's JWT signing secret) to be set
// as a runtime secret. Without it the route returns 503.

type Body = { token?: unknown; pin?: unknown };

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
const PIN_RE = /^[0-9]{4,8}$/;
const TTL_SECONDS = 300; // 5 minutes

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/prep-realtime-token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return json(503, { ok: false, error: "backend_unconfigured" });
        }
        if (!JWT_SECRET) {
          return json(503, { ok: false, error: "jwt_secret_missing" });
        }

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return json(400, { ok: false, error: "bad_json" });
        }

        const token = typeof body.token === "string" ? body.token.trim() : "";
        const pin = typeof body.pin === "string" ? body.pin.trim() : "";
        if (!TOKEN_RE.test(token)) {
          return json(400, { ok: false, error: "bad_token" });
        }
        if (!PIN_RE.test(pin)) {
          return json(400, { ok: false, error: "bad_pin_format" });
        }

        // Validate via the existing PIN-checked RPC. It already enforces
        // rate limiting (prep_pin_locked_until) and re-issues the upload
        // grant — both safe side effects for a successful worker login.
        const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          auth: {
            storage: undefined,
            persistSession: false,
            autoRefreshToken: false,
          },
        });

        const { data, error } = await supabase.rpc("prep_get_task", {
          _token: token,
          _pin: pin,
        });
        if (error) {
          return json(500, { ok: false, error: "rpc_failed" });
        }
        const result = data as
          | { ok: true; task: { id: string } }
          | { ok: false; error: string; retry_after?: number }
          | null;
        if (!result || result.ok !== true) {
          const err = (result && (result as { error?: string }).error) || "unauthorized";
          // Surface rate-limit metadata when present so the client can back off.
          const status = err === "rate_limited" ? 429 : err === "bad_pin" ? 401 : 404;
          return json(status, { ok: false, error: err, retry_after: (result as { retry_after?: number } | null)?.retry_after });
        }

        const now = Math.floor(Date.now() / 1000);
        const key = new TextEncoder().encode(JWT_SECRET);
        const jwt = await new SignJWT({
          role: "anon",
          share_token: token,
        })
          .setProtectedHeader({ alg: "HS256", typ: "JWT" })
          .setIssuer("supabase")
          .setIssuedAt(now)
          .setExpirationTime(now + TTL_SECONDS)
          .sign(key);

        return json(200, {
          ok: true,
          token: jwt,
          expires_at: now + TTL_SECONDS,
          task_id: result.task.id,
        });
      },
    },
  },
});
