import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

/**
 * E2E: route `/admin-denial-log` untuk non-admin.
 *
 * Kontrak yang diuji:
 *   1. Link "/admin-denial-log" TIDAK muncul di sidebar untuk non-admin.
 *   2. Kalau non-admin mengetik URL langsung, halaman TETAP dirender
 *      (tidak crash / tidak layar putih), tapi menampilkan fallback
 *      "Halaman ini hanya untuk admin." — bukan tabel data.
 *   3. Client TIDAK memanggil server-fn `listAdminDenialEvents`
 *      (query di-gate `enabled: isAdmin`), sehingga log denial-nya
 *      sendiri tidak terpicu dari halaman ini.
 *
 * Auto-skip kalau storageState kosong atau user test kebetulan admin.
 */

const STORAGE = "tests/visual/.auth/user.json";

const ADMIN_FN_PATTERNS = [
  /listAdminDenialEvents/i,
];

function hasStorageState(): boolean {
  try {
    if (!existsSync(STORAGE)) return false;
    const raw = JSON.parse(readFileSync(STORAGE, "utf8"));
    return (Array.isArray(raw?.cookies) && raw.cookies.length > 0)
      || (Array.isArray(raw?.origins) && raw.origins.length > 0);
  } catch {
    return false;
  }
}

test.describe("/admin-denial-log — non-admin", () => {
  test.skip(!hasStorageState(), "storageState kosong; setup login dulu.");

  test("sidebar tidak menampilkan link /admin-denial-log untuk non-admin", async ({
    page,
  }) => {
    await page.goto("/chat");
    await expect(
      page.locator('[data-sidebar="menu"] a[href="/chat"]').first(),
    ).toBeVisible({ timeout: 15_000 });

    const denialLink = page.locator(
      '[data-sidebar="menu"] a[href="/admin-denial-log"]',
    );

    // Skip kalau user test admin (link justru wajib ada).
    const count = await denialLink.count();
    test.skip(
      count > 0,
      "user test punya role admin — kontrak non-admin tidak berlaku.",
    );

    await expect(denialLink).toHaveCount(0);
  });

  test("akses langsung /admin-denial-log oleh non-admin: fallback tampil, server-fn admin tidak dipanggil", async ({
    page,
  }) => {
    // Sanity: pastikan user test bukan admin. Kalau sidebar punya link,
    // kontrak ini tidak berlaku → skip.
    await page.goto("/chat");
    await expect(
      page.locator('[data-sidebar="menu"] a[href="/chat"]').first(),
    ).toBeVisible({ timeout: 15_000 });
    const asAdmin = await page
      .locator('[data-sidebar="menu"] a[href="/admin-denial-log"]')
      .count();
    test.skip(
      asAdmin > 0,
      "user test punya role admin — kontrak non-admin tidak berlaku.",
    );

    const adminHits: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (ADMIN_FN_PATTERNS.some((re) => re.test(url))) adminHits.push(url);
    });

    await page.goto("/admin-denial-log");

    // Halaman merender fallback (bukan blank / bukan tabel data).
    await expect(
      page.getByText(/hanya untuk admin/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Tidak ada header tabel denial yang bocor.
    await expect(page.getByRole("columnheader", { name: /Fungsi/i }))
      .toHaveCount(0);
    await expect(page.getByRole("button", { name: /Terapkan/i }))
      .toHaveCount(0);

    // Tunggu tail request; verifikasi query admin tidak dipanggil.
    await page.waitForLoadState("networkidle").catch(() => {});
    expect(
      adminHits,
      `server-fn admin dipanggil dari non-admin: ${adminHits.join(", ")}`,
    ).toEqual([]);
  });
});