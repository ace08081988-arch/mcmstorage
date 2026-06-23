/**
 * HTTP-level security tests against the live Supabase Data API.
 *
 * Verifies what a malicious anonymous client could see/do over PostgREST:
 *   - per-user tables return 0 rows for anon
 *   - per-user writes are rejected for anon
 *   - SECURITY DEFINER RPCs that should NOT be anon-callable are denied
 *   - SECURITY DEFINER RPCs that ARE anon-callable refuse bad input safely
 *
 * Reads SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY (or the VITE_* variants).
 * If neither is set the suite is skipped — useful in CI without secrets.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "";

const hasCreds = !!SUPABASE_URL && !!SUPABASE_KEY;
const d = hasCreds ? describe : describe.skip;

let anon: SupabaseClient;

beforeAll(() => {
  if (!hasCreds) return;
  anon = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
});

// Tables that hold per-user data. Anon must never see any rows.
const PER_USER_TABLES = [
  "warehouse_items",
  "customers",
  "suppliers",
  "order_requests",
  "sales",
  "purchases",
  "debts",
  "ready_packages",
  "ecer_titles",
  "request_titles",
  "prep_tasks",
  "user_devices",
  "push_subscriptions",
  "staff_contacts",
  "messages",
  "conversations",
  "conversation_members",
  "email_send_log",
  "device_otp_challenges",
  "user_roles",
] as const;

d("RLS — anon read isolation", () => {
  it.each(PER_USER_TABLES)(
    "anon SELECT on %s returns zero rows",
    async (table) => {
      const { data, error } = await anon.from(table).select("*").limit(5);
      // Either an empty array (RLS filtered) or a permission error is acceptable;
      // never a non-empty result set.
      if (error) {
        // 401/403/PGRST/permission denied are all valid lockdowns.
        expect(error.message).toMatch(
          /permission|denied|JWT|not authorized|RLS|row-level/i,
        );
        return;
      }
      expect(Array.isArray(data)).toBe(true);
      expect(data!.length).toBe(0);
    },
  );
});

d("RLS — anon write rejection", () => {
  it("anon INSERT on customers is denied", async () => {
    const { error } = await anon.from("customers").insert({
      user_id: "00000000-0000-0000-0000-000000000000",
      name: "rls-attack",
    });
    expect(error).not.toBeNull();
  });

  it("anon INSERT on warehouse_items is denied", async () => {
    const { error } = await anon.from("warehouse_items").insert({
      user_id: "00000000-0000-0000-0000-000000000000",
      name: "rls-attack",
    } as never);
    expect(error).not.toBeNull();
  });

  it("anon INSERT on messages is denied", async () => {
    const { error } = await anon.from("messages").insert({
      conversation_id: "00000000-0000-0000-0000-000000000000",
      sender_id: "00000000-0000-0000-0000-000000000000",
      body: "rls-attack",
    } as never);
    expect(error).not.toBeNull();
  });
});

d("SECURITY DEFINER — anon access boundary", () => {
  // These RPCs intentionally require auth.uid() / cannot be called by anon.
  const PRIVATE_RPCS: Array<[string, Record<string, unknown>]> = [
    ["start_dm", { _partner: "00000000-0000-0000-0000-000000000000" }],
    ["create_group", { _title: "x", _member_ids: [] }],
    ["prep_create_task", {
      _title: "x", _note: null, _pin: "1234",
      _share_token: "tok_test", _items: [],
    }],
    ["has_role", { _user_id: "00000000-0000-0000-0000-000000000000", _role: "admin" }],
    ["check_acknowledge_rate_limit", {}],
  ];

  it.each(PRIVATE_RPCS)(
    "anon RPC %s is rejected or returns empty",
    async (name, args) => {
      const { data, error } = await anon.rpc(name, args as never);
      // Either an explicit auth error, or a benign null/false (e.g. has_role).
      if (error) {
        expect(error.message).toMatch(
          /permission|denied|unauthenticated|JWT|not authorized|forbidden|not exist/i,
        );
        return;
      }
      // has_role returns false for unauthenticated callers — that's fine.
      expect(data === null || data === false).toBe(true);
    },
  );

  // Worker portal RPCs are anon-callable but must refuse without a valid token+PIN.
  it("prep_get_task with bogus token returns not_found", async () => {
    const { data, error } = await anon.rpc("prep_get_task", {
      _token: "tok_does_not_exist_" + Date.now(),
      _pin: "0000",
    } as never);
    expect(error).toBeNull();
    expect((data as { ok?: boolean; error?: string } | null)?.ok).toBe(false);
  });
});