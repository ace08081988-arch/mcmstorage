/**
 * Kontrak data untuk operasi kategori Beranda ↔ Gudang.
 *
 * Butuh SERVICE_ROLE key untuk membuat + membersihkan user test.
 * Kalau tidak tersedia (dev lokal tanpa secret), seluruh suite di-skip
 * supaya `bunx vitest run` tetap hijau.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "";

const hasCreds = !!SUPABASE_URL && !!SERVICE_KEY && !!PUBLISHABLE_KEY;
const d = hasCreds ? describe : describe.skip;

let admin: SupabaseClient;
let userClient: SupabaseClient;
let userId = "";
const email = `wc-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
const password = "Test1234!secure";

async function cleanupUserData() {
  await admin.from("warehouse_items").delete().eq("user_id", userId);
  await admin.from("warehouse_categories").delete().eq("user_id", userId);
}

beforeAll(async () => {
  if (!hasCreds) return;
  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  userId = created.data.user!.id;

  userClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await userClient.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
}, 30_000);

afterAll(async () => {
  if (!hasCreds || !userId) return;
  await cleanupUserData();
  await admin.auth.admin.deleteUser(userId);
}, 30_000);

async function seedCategory(name: string, position: number) {
  const { error } = await admin
    .from("warehouse_categories")
    .insert({ user_id: userId, name, position });
  if (error) throw error;
}

async function seedItem(category: string, itemName = `item-${Math.random().toString(36).slice(2, 7)}`) {
  const { error } = await admin
    .from("warehouse_items")
    .insert({ user_id: userId, name: itemName, category });
  if (error) throw error;
  return itemName;
}

d("warehouse_categories ↔ warehouse_items kontrak", () => {
  it("tolak insert duplikat case-insensitive", async () => {
    await cleanupUserData();
    await seedCategory("kristal", 0);
    const { error } = await userClient
      .from("warehouse_categories")
      .insert({ user_id: userId, name: "KRISTAL", position: 1 });
    expect(error).toBeTruthy();
    expect(error?.code).toBe("23505");
  });

  it("rename tolak collision case-insensitive dengan kategori lain", async () => {
    await cleanupUserData();
    await seedCategory("kristal", 0);
    await seedCategory("Batu", 1);
    const { error } = await userClient.rpc("rename_warehouse_category", {
      _old_name: "Batu",
      _new_name: "KRISTAL",
    });
    expect(error).toBeTruthy();
    // Row lama tetap ada.
    const { data } = await admin
      .from("warehouse_categories")
      .select("name")
      .eq("user_id", userId)
      .order("position");
    expect(data?.map((r) => r.name)).toEqual(["kristal", "Batu"]);
  });

  it("rename case-only diperbolehkan", async () => {
    await cleanupUserData();
    await seedCategory("kristal", 0);
    const { error } = await userClient.rpc("rename_warehouse_category", {
      _old_name: "kristal",
      _new_name: "Kristal",
    });
    expect(error).toBeNull();
    const { data } = await admin
      .from("warehouse_categories")
      .select("name")
      .eq("user_id", userId);
    expect(data?.map((r) => r.name)).toEqual(["Kristal"]);
  });

  it("rename kaskade ke warehouse_items.category (ILIKE match)", async () => {
    await cleanupUserData();
    await seedCategory("kristal", 0);
    await seedItem("Kristal", "a");
    await seedItem("kristal", "b");
    const { data: renamed, error } = await userClient.rpc("rename_warehouse_category", {
      _old_name: "kristal",
      _new_name: "Kristal Premium",
    });
    expect(error).toBeNull();
    expect(Number(renamed)).toBe(2);
    const { data } = await admin
      .from("warehouse_items")
      .select("name, category")
      .eq("user_id", userId);
    for (const row of data ?? []) {
      expect(row.category).toBe("Kristal Premium");
    }
  });

  it("posisi (position) bertahan setelah reorder", async () => {
    await cleanupUserData();
    await seedCategory("A", 0);
    await seedCategory("B", 1);
    await seedCategory("C", 2);
    // Tukar A ↔ C.
    for (const [name, pos] of [
      ["C", 0],
      ["B", 1],
      ["A", 2],
    ] as const) {
      const { error } = await userClient
        .from("warehouse_categories")
        .update({ position: pos })
        .eq("user_id", userId)
        .eq("name", name);
      expect(error).toBeNull();
    }
    const { data } = await admin
      .from("warehouse_categories")
      .select("name")
      .eq("user_id", userId)
      .order("position");
    expect(data?.map((r) => r.name)).toEqual(["C", "B", "A"]);
  });

  it("delete diblokir saat masih dipakai warehouse_items (validasi client-side)", async () => {
    // Guard delete di UI adalah pre-flight count di client + delete kategori
    // biasa (bukan RPC). Test ini mereproduksi kontrak: count > 0 ⇒ jangan
    // delete; count = 0 ⇒ delete sukses.
    await cleanupUserData();
    await seedCategory("Sembako", 0);
    await seedItem("Sembako", "beras");
    const { count } = await userClient
      .from("warehouse_items")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .ilike("category", "Sembako");
    expect((count ?? 0) > 0).toBe(true);

    // Setelah item dihapus, delete kategori sukses.
    await admin.from("warehouse_items").delete().eq("user_id", userId).eq("name", "beras");
    const { error } = await userClient
      .from("warehouse_categories")
      .delete()
      .eq("user_id", userId)
      .eq("name", "Sembako");
    expect(error).toBeNull();
    const { data } = await admin
      .from("warehouse_categories")
      .select("name")
      .eq("user_id", userId);
    expect(data?.length).toBe(0);
  });
});