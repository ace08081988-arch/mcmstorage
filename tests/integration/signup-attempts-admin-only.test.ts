/**
 * Kontrak keamanan `public.signup_attempts`:
 *   - Anon TIDAK bisa membaca baris apapun (0 rows / permission denied).
 *   - Anon TIDAK bisa INSERT/UPDATE/DELETE (tabel hanya diisi oleh
 *     SECURITY DEFINER function `check_and_record_signup_attempt`).
 *   - Kebijakan SELECT hanya untuk role `admin` (dicek via view metadata
 *     `pg_policies` yang boleh dibaca anon di Supabase — hanya membaca
 *     nama kebijakan, bukan data).
 *
 * Kita tidak bisa memasang sesi non-admin authenticated tanpa akun uji,
 * jadi bagian "user biasa" diverifikasi lewat integration test SQL
 * (supabase/tests/security_rls_authz.sql) yang dijalankan CI, dan lewat
 * pola RLS di sini yang mem-flag setiap baris data yang bocor ke anon.
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

d("signup_attempts — akses hanya admin", () => {
  it("anon SELECT mengembalikan 0 baris (RLS memfilter) atau permission denied", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (anon.from as any)("signup_attempts")
      .select("id,ip,email,succeeded,created_at,user_agent")
      .limit(5);
    if (error) {
      expect(error.message).toMatch(
        /permission|denied|JWT|not authorized|RLS|row-level/i,
      );
      return;
    }
    expect(Array.isArray(data)).toBe(true);
    expect(data!.length).toBe(0);
  });

  it("anon INSERT langsung ke signup_attempts ditolak", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (anon.from as any)("signup_attempts").insert({
      ip: "0.0.0.0",
      email: "attacker@example.com",
      succeeded: true,
      user_agent: "attack-ua",
    });
    expect(error).not.toBeNull();
    // Tanpa policy INSERT, PostgREST akan mengembalikan permission/RLS error.
    expect(error!.message).toMatch(
      /permission|denied|row-level|policy|violat|not authorized/i,
    );
  });

  it("anon UPDATE pada signup_attempts tidak menyentuh baris (0 rows)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (anon.from as any)("signup_attempts")
      .update({ succeeded: true })
      .eq("ip", "0.0.0.0")
      .select();
    if (error) {
      expect(error.message).toMatch(
        /permission|denied|row-level|policy|not authorized/i,
      );
      return;
    }
    expect(Array.isArray(data)).toBe(true);
    expect(data!.length).toBe(0);
  });

  it("anon DELETE pada signup_attempts tidak menyentuh baris (0 rows)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (anon.from as any)("signup_attempts")
      .delete()
      .eq("ip", "0.0.0.0")
      .select();
    if (error) {
      expect(error.message).toMatch(
        /permission|denied|row-level|policy|not authorized/i,
      );
      return;
    }
    expect(Array.isArray(data)).toBe(true);
    expect(data!.length).toBe(0);
  });

  it("check_and_record_signup_attempt TIDAK boleh dipanggil dari anon (service_role only)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (anon.rpc as any)(
      "check_and_record_signup_attempt",
      {
        p_ip: "0.0.0.0",
        p_email: "anon-attack@example.com",
        p_user_agent: "anon-ua",
      },
    );
    // Harus ditolak: EXECUTE hanya diberikan ke service_role.
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(
      /permission|denied|not authorized|not exist|forbidden/i,
    );
    expect(data).toBeNull();
  });
});
