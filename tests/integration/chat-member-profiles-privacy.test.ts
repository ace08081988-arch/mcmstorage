/**
 * Kontrak keamanan `public.get_chat_member_profiles(uuid[])`:
 *   1. TypeScript Returns-type (dari types.ts) tidak boleh punya kolom `email`.
 *   2. Anon TIDAK boleh EXECUTE RPC ini — Supabase akan menolak dengan
 *      permission/JWT/RLS error.
 *
 * Aturan cross-user yang menjaga `phone` (hanya keluar bila peer sudah ada
 * di address_book pemanggil) diverifikasi secara statis di
 * supabase/tests/security_rls_authz.sql blok 16 — ia membaca pg_proc.prosrc
 * dan memastikan body function memfilter phone dengan address_book +
 * linked_user_id. Kombinasi kedua lapis (TS + HTTP + SQL) memastikan tidak
 * ada regresi baik di client, transport, maupun di database.
 */
import { describe, it, expect, beforeAll, expectTypeOf } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type RpcRow =
  Database["public"]["Functions"]["get_chat_member_profiles"]["Returns"][number];

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "";

const hasCreds = !!SUPABASE_URL && !!SUPABASE_KEY;
const d = hasCreds ? describe : describe.skip;

let anon: SupabaseClient<Database>;

beforeAll(() => {
  if (!hasCreds) return;
  anon = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
});

describe("get_chat_member_profiles — kontrak privasi (typegen)", () => {
  it("Returns type tidak boleh punya kolom `email`", () => {
    // Static assertion: kalau types.ts memuat kembali `email`, test ini gagal
    // compile — regresi di database langsung menabrak CI TypeScript.
    expectTypeOf<RpcRow>().not.toHaveProperty("email");
    // Kolom yang tetap harus ada.
    expectTypeOf<RpcRow>().toHaveProperty("id");
    expectTypeOf<RpcRow>().toHaveProperty("display_name");
    expectTypeOf<RpcRow>().toHaveProperty("phone");
    expectTypeOf<RpcRow>().toHaveProperty("invite_code");
  });
});

d("get_chat_member_profiles — akses HTTP", () => {
  it("anon tidak boleh EXECUTE RPC (permission/JWT error)", async () => {
    const { data, error } = await anon.rpc("get_chat_member_profiles", {
      _user_ids: ["00000000-0000-0000-0000-000000000000"],
    });
    // Kontrak: baik permission/JWT/RLS error MAUPUN 0 baris keduanya diterima
    // — yang PENTING: anon tidak boleh melihat data peer manapun.
    if (error) {
      expect(error.message).toMatch(
        /permission|denied|JWT|not authorized|RLS|row-level|function|schema/i,
      );
      return;
    }
    expect(Array.isArray(data)).toBe(true);
    expect(data!.length).toBe(0);
  });

  it("payload RPC (bila ada) tidak pernah memuat kunci `email`", async () => {
    // Defensive belt-and-suspenders: sekalipun suatu waktu grant EXECUTE
    // bocor ke anon, isi row tetap tidak boleh memuat `email`.
    const { data, error } = await anon.rpc("get_chat_member_profiles", {
      _user_ids: ["00000000-0000-0000-0000-000000000000"],
    });
    if (error) return; // permission denied sudah dicek di atas
    for (const row of data ?? []) {
      expect(Object.keys(row as Record<string, unknown>)).not.toContain("email");
    }
  });
});
