import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Security boundary tests — run against the live project using only the
 * publishable (anon) key. Verifies two invariants documented in
 * @security-memory:
 *
 *   1. SECURITY DEFINER RPCs that are NOT worker share-link endpoints must
 *      NOT be callable by anon (EXECUTE revoked).
 *   2. Worker share-link RPCs (token + bcrypt PIN) ARE callable by anon and
 *      return a semantic error envelope, not a permission error. Their source
 *      still enforces the rate-limit guard via prep_pin_locked_until /
 *      record_prep_pin_failure (verified behaviorally below when a fixture
 *      task is provided via env vars).
 *
 * Skip the whole suite gracefully when the publishable env vars are absent
 * (e.g. a contributor running unit tests offline).
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
  | string
  | undefined;

const haveCreds = Boolean(SUPABASE_URL && SUPABASE_ANON);
const d = haveCreds ? describe : describe.skip;

let anon: SupabaseClient;
beforeAll(() => {
  if (!haveCreds) return;
  anon = createClient(SUPABASE_URL!, SUPABASE_ANON!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
});

/** Postgres permission-denied surfaces in PostgREST as code 42501. */
function isPermissionDenied(err: { code?: string; message?: string } | null) {
  if (!err) return false;
  if (err.code === "42501") return true;
  const msg = (err.message ?? "").toLowerCase();
  return msg.includes("permission denied") || msg.includes("not allowed");
}

d("SECURITY DEFINER boundary — restricted RPCs reject anon", () => {
  // Functions that previously leaked to anon and have been revoked.
  const restricted: Array<{ name: string; args: Record<string, unknown> }> = [
    { name: "run_internal_security_scan", args: {} },
    {
      name: "security_findings_acknowledge",
      args: { _ids: ["00000000-0000-0000-0000-000000000000"] },
    },
    { name: "search_chat_contacts", args: { _q: "x" } },
    { name: "prep_pin_locked_until", args: { _token: "nope" } },
    { name: "prep_upload_allowed", args: { _share_token: "nope" } },
    {
      name: "prep_worker_upload_allowed",
      args: {
        _owner_user_id: "00000000-0000-0000-0000-000000000000",
        _share_token: "nope",
      },
    },
  ];

  it.each(restricted)("anon cannot execute $name", async ({ name, args }) => {
    // Cast to any: these RPC names are intentionally not in the generated
    // Database type because the client should never call them.
    // deno-lint-ignore no-explicit-any
    const { error } = await (anon.rpc as any)(name, args);
    expect(error, `${name} unexpectedly succeeded for anon`).not.toBeNull();
    expect(isPermissionDenied(error)).toBe(true);
  });
});

d("SECURITY DEFINER boundary — worker share-link RPCs are anon-callable", () => {
  // These six are the intentional public surface. They must NOT return a
  // permission error; they must return their semantic error envelope.
  it("prep_get_task returns not_found for bogus token (no permission error)", async () => {
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (anon.rpc as any)("prep_get_task", {
      _token: "test-bogus-" + Math.random().toString(36).slice(2),
      _pin: "0000",
    });
    expect(isPermissionDenied(error)).toBe(false);
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: false, error: "not_found" });
  });

  it("request_list_titles_via_task is reachable by anon", async () => {
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (anon.rpc as any)(
      "request_list_titles_via_task",
      {
        _token: "test-bogus-" + Math.random().toString(36).slice(2),
        _pin: "0000",
      },
    );
    expect(isPermissionDenied(error)).toBe(false);
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: false, error: "not_found" });
  });

  it("ecer_list_titles_via_task is reachable by anon", async () => {
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (anon.rpc as any)(
      "ecer_list_titles_via_task",
      {
        _token: "test-bogus-" + Math.random().toString(36).slice(2),
        _pin: "0000",
        _warehouse_item_id: "00000000-0000-0000-0000-000000000000",
      },
    );
    expect(isPermissionDenied(error)).toBe(false);
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: false, error: "not_found" });
  });
});

/**
 * Rate-limit smoke test against a real share-link fixture.
 *
 * Set TEST_PREP_SHARE_TOKEN to a task token that EXISTS and is active, and
 * TEST_PREP_PIN_BAD to any 4-digit string that is NOT the task's PIN. The
 * test fires 5 wrong-PIN attempts and expects the 6th to come back as
 * { ok: false, error: "rate_limited", retry_after: <seconds> }.
 *
 * Skipped when env vars are absent so CI doesn't require a live fixture.
 */
const RL_TOKEN = process.env.TEST_PREP_SHARE_TOKEN;
const RL_BAD_PIN = process.env.TEST_PREP_PIN_BAD ?? "0000";
const rl = haveCreds && RL_TOKEN ? describe : describe.skip;

rl("Worker PIN rate-limit (live fixture)", () => {
  it(
    "blocks after 5 failed PIN attempts within the 10-minute window",
    async () => {
      let last: { ok: boolean; error?: string; retry_after?: number } | null =
        null;
      for (let i = 0; i < 6; i++) {
        // deno-lint-ignore no-explicit-any
        const { data, error } = await (anon.rpc as any)("prep_get_task", {
          _token: RL_TOKEN,
          _pin: RL_BAD_PIN,
        });
        expect(error).toBeNull();
        last = data;
      }
      expect(last).toMatchObject({ ok: false, error: "rate_limited" });
      expect(typeof last?.retry_after).toBe("number");
      expect(last!.retry_after!).toBeGreaterThan(0);
    },
    30_000,
  );
});