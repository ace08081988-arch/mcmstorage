/**
 * E2E: konsistensi kategori Beranda ↔ Gudang.
 *
 * 1. Tambah kategori di Beranda → tampil di /gudang.
 * 2. Rename kategori → warehouse_items.category ikut ter-update di /gudang.
 * 3. Hapus kategori yang masih dipakai → toast error muncul, kategori tetap.
 * 4. Urutan drag di Beranda tersimpan (position naik/turun konsisten
 *    setelah reload; verifikasi via SDK karena drag-touch di Playwright
 *    tidak deterministik).
 *
 * Auto-skip saat:
 *   - storageState kosong (login belum di-setup di visual/global-setup),
 *   - SUPABASE_SERVICE_ROLE_KEY tidak tersedia (seed/cleanup butuh admin),
 *   - user login belum bisa dipetakan ke uid.
 */
import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const STORAGE = "tests/visual/.auth/user.json";
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const TEST_EMAIL = process.env.TEST_EMAIL || "";
const hasCreds = !!SUPABASE_URL && !!SERVICE_KEY && !!TEST_EMAIL;

function hasStorageState(): boolean {
  try {
    if (!existsSync(STORAGE)) return false;
    const raw = JSON.parse(readFileSync(STORAGE, "utf8"));
    return (
      (Array.isArray(raw?.cookies) && raw.cookies.length > 0) ||
      (Array.isArray(raw?.origins) && raw.origins.length > 0)
    );
  } catch {
    return false;
  }
}

let admin: SupabaseClient;
let uid = "";

test.describe("warehouse_categories — konsistensi Beranda ↔ Gudang", () => {
  test.skip(!hasStorageState(), "storageState kosong; setup login dulu di visual/global-setup.");
  test.skip(!hasCreds, "SUPABASE_SERVICE_ROLE_KEY + TEST_EMAIL diperlukan untuk seed/cleanup.");

  test.beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.auth.admin.listUsers();
    if (error) throw error;
    const found = data.users.find((u) => u.email === TEST_EMAIL);
    if (!found) throw new Error(`User ${TEST_EMAIL} tidak ditemukan`);
    uid = found.id;
  });

  test.beforeEach(async () => {
    // Bersihkan semua kategori & item bertag test agar setiap skenario mandiri.
    await admin.from("warehouse_items").delete().eq("user_id", uid).ilike("category", "e2ecat_%");
    await admin.from("warehouse_categories").delete().eq("user_id", uid).ilike("name", "e2ecat_%");
  });

  test.afterAll(async () => {
    if (!uid) return;
    await admin.from("warehouse_items").delete().eq("user_id", uid).ilike("category", "e2ecat_%");
    await admin.from("warehouse_categories").delete().eq("user_id", uid).ilike("name", "e2ecat_%");
  });

  test("tambah kategori tampil di Beranda dan Gudang", async ({ page }) => {
    const cat = `e2ecat_${Date.now()}`;
    await page.goto("/");
    await page.getByPlaceholder(/Sembako, Pakaian/).fill(cat);
    await page.getByRole("button", { name: "Buat" }).click();
    await expect(page.getByTestId(`rename-cat-${cat}`)).toBeVisible({ timeout: 10_000 });

    await page.goto("/gudang");
    await expect(page.getByText(cat, { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("rename kategori ikut ke label produk di Gudang", async ({ page }) => {
    const oldName = `e2ecat_A_${Date.now()}`;
    const newName = `${oldName}_renamed`;
    await admin.from("warehouse_categories").insert({
      user_id: uid,
      name: oldName,
      position: 0,
    });
    await admin.from("warehouse_items").insert({
      user_id: uid,
      name: `item_${Date.now()}`,
      category: oldName,
      package_type: "pcs",
      package_size: 1,
      base_unit: "pcs",
    });

    await page.goto("/");
    await page.getByTestId(`rename-cat-${oldName}`).click();
    await page.getByTestId("rename-cat-input").fill(newName);
    await page.getByTestId("rename-cat-submit").click();
    await expect(page.getByTestId(`rename-cat-${newName}`)).toBeVisible({ timeout: 10_000 });

    // Verifikasi DB — kaskade item.
    const { data } = await admin
      .from("warehouse_items")
      .select("category")
      .eq("user_id", uid)
      .ilike("category", `${oldName}%`);
    expect(data?.every((r) => r.category === newName)).toBe(true);

    await page.goto("/gudang");
    await expect(page.getByText(newName, { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("hapus kategori terblokir saat masih dipakai warehouse_items", async ({ page }) => {
    const cat = `e2ecat_B_${Date.now()}`;
    await admin.from("warehouse_categories").insert({
      user_id: uid,
      name: cat,
      position: 0,
    });
    await admin.from("warehouse_items").insert({
      user_id: uid,
      name: `item_${Date.now()}`,
      category: cat,
      package_type: "pcs",
      package_size: 1,
      base_unit: "pcs",
    });

    await page.goto("/");
    await page.getByTestId(`delete-cat-${cat}`).click();
    await expect(page.getByText(/masih dipakai/i).first()).toBeVisible({ timeout: 10_000 });
    // Chip kategori tetap ada.
    await expect(page.getByTestId(`delete-cat-${cat}`)).toBeVisible();
  });

  test("urutan kategori (position) konsisten di Beranda & Gudang", async ({ page }) => {
    // Seed 3 kategori.
    const stamp = Date.now();
    const names = [`e2ecat_C1_${stamp}`, `e2ecat_C2_${stamp}`, `e2ecat_C3_${stamp}`];
    for (let i = 0; i < names.length; i++) {
      await admin.from("warehouse_categories").insert({
        user_id: uid,
        name: names[i],
        position: i,
      });
    }

    // Tukar urutan langsung via DB (simulasi hasil drag) — verifikasi
    // bahwa halaman Beranda & Gudang membaca urutan yang sama dari SSOT.
    const reversed = [...names].reverse();
    for (let i = 0; i < reversed.length; i++) {
      await admin
        .from("warehouse_categories")
        .update({ position: 100 + i })
        .eq("user_id", uid)
        .eq("name", reversed[i]);
    }

    await page.goto("/");
    // Ambil urutan chip di Beranda.
    const berandaOrder = await page
      .locator('[data-testid^="rename-cat-e2ecat_C"]')
      .evaluateAll((els) =>
        els.map((el) => (el.getAttribute("data-testid") || "").replace("rename-cat-", "")),
      );
    expect(berandaOrder).toEqual(reversed);

    await page.goto("/gudang");
    // Cari heading grup untuk tiap kategori dan pastikan indeks kemunculan
    // di DOM mengikuti urutan `reversed`.
    const positions: number[] = [];
    for (const n of reversed) {
      const loc = page.getByText(n, { exact: false }).first();
      await expect(loc).toBeVisible({ timeout: 15_000 });
      positions.push(await loc.evaluate((el) => {
        const all = Array.from(document.body.querySelectorAll("*"));
        return all.indexOf(el);
      }));
    }
    // Ascending → sama dengan urutan `reversed`.
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });
});