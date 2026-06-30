import { test, expect, type Route } from "@playwright/test";

/**
 * E2E: portal pegawai harus tetap masuk ke daftar tugas setelah:
 *  - reload halaman (F5 / pull-to-refresh)
 *  - Android WebView dire-create (disimulasikan via new page same context;
 *    sessionStorage Android dipertahankan oleh WebView selama Activity hidup,
 *    sehingga skenario yang relevan adalah navigasi ulang dalam page yang sama
 *    setelah teardown DOM penuh).
 *
 * Strategi: stub semua RPC publik (`prep_peek_task`, `prep_get_task`) lewat
 * `page.route` agar test deterministik tanpa backend.
 */

const TOKEN = "e2e-token-rehydrate-abcdef12";
const PIN = "123456";

const TASK_PAYLOAD = {
  ok: true,
  task: {
    id: "task-1",
    title: "Tugas Penyiapan E2E",
    note: "Stub data dari Playwright",
    status: "active",
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  },
  items: [
    {
      id: "item-1",
      name: "Beras Premium",
      category: "Sembako",
      qty_requested: 2,
      qty_prepared: 0,
      unit_label: "kg",
      ref_photo_path: null,
      note: null,
      updated_at: new Date().toISOString(),
      submissions: [],
    },
  ],
};

const PEEK_PAYLOAD = {
  ok: true,
  title: "Tugas Penyiapan E2E",
  expires_at: TASK_PAYLOAD.task.expires_at,
};

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installStubs(page: import("@playwright/test").Page) {
  // Tangkap semua RPC publik yang dipakai portal pegawai. URL aktual:
  //   POST <SUPABASE_URL>/rest/v1/rpc/prep_peek_task
  //   POST <SUPABASE_URL>/rest/v1/rpc/prep_get_task
  await page.route("**/rest/v1/rpc/prep_peek_task*", (route) => fulfillJson(route, PEEK_PAYLOAD));
  await page.route("**/rest/v1/rpc/prep_get_task*", async (route) => {
    // Validasi body memuat PIN benar; jika tidak, balas bad_pin agar test
    // kegagalan-input juga terdeteksi bila suatu hari logic auto-rehydrate
    // mengirim PIN salah.
    let pinOk = true;
    try {
      const post = route.request().postDataJSON() as { _pin?: string } | null;
      pinOk = post?._pin === PIN;
    } catch { /* anggap valid kalau body tidak terbaca */ }
    if (!pinOk) {
      await fulfillJson(route, { ok: false, error: "bad_pin" });
      return;
    }
    await fulfillJson(route, TASK_PAYLOAD);
  });
  // Realtime websocket — biarkan gagal diam, halaman tidak boleh bouncing.
  await page.route("**/realtime/v1/**", (route) => route.abort());
}

test.describe("Portal pegawai · auto-rehydrate sesi", () => {
  test.beforeEach(async ({ page }) => {
    await installStubs(page);
  });

  test("PIN sekali, reload tetap di daftar tugas (bukan layar PIN)", async ({ page }) => {
    await page.goto(`/t/${TOKEN}`);

    // Layar PIN muncul lebih dulu.
    const pinInput = page.getByPlaceholder("••••••");
    await expect(pinInput.or(page.locator('input[inputmode="numeric"]')).first()).toBeVisible({ timeout: 10_000 });

    // Isi PIN dan submit.
    const input = page.locator('input[inputmode="numeric"]').first();
    await input.fill(PIN);
    await page.getByRole("button", { name: /buka/i }).click();

    // Daftar tugas terlihat.
    await expect(page.getByText("Tugas Penyiapan E2E")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Beras Premium")).toBeVisible();

    // Pastikan sessionStorage menyimpan sesi.
    const stored = await page.evaluate(
      (key) => window.sessionStorage.getItem(key),
      `prep_session:${TOKEN}`,
    );
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored as string) as { pin: string };
    expect(parsed.pin).toBe(PIN);

    // === Skenario 1: reload halaman penuh ===
    await page.reload();

    // Harus langsung kembali ke daftar tugas — TIDAK boleh menampilkan
    // layar verifikasi PIN. Beri waktu auto-rehydrate fetchTask.
    await expect(page.getByText("Tugas Penyiapan E2E")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Beras Premium")).toBeVisible();
    // Header "Verifikasi PIN" tidak boleh muncul lagi.
    await expect(page.getByText("Verifikasi PIN", { exact: false })).toHaveCount(0);
  });

  test("WebView recreate (page baru, sessionStorage hilang) → kembali ke layar PIN", async ({ browser }) => {
    // Skenario kontrol: jika sessionStorage benar-benar hilang (Activity
    // di-kill total oleh Android), pegawai HARUS dimintai PIN lagi —
    // bukan auto-login pakai PIN basi yang tidak tersimpan.
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await installStubs(pageA);
    await pageA.goto(`/t/${TOKEN}`);
    await pageA.locator('input[inputmode="numeric"]').first().fill(PIN);
    await pageA.getByRole("button", { name: /buka/i }).click();
    await expect(pageA.getByText("Tugas Penyiapan E2E")).toBeVisible({ timeout: 10_000 });

    // Context baru = sessionStorage benar-benar kosong.
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await installStubs(pageB);
    await pageB.goto(`/t/${TOKEN}`);
    await expect(pageB.getByText(/Verifikasi PIN/i)).toBeVisible({ timeout: 10_000 });
    await expect(pageB.getByText("Beras Premium")).toHaveCount(0);

    await ctxA.close();
    await ctxB.close();
  });

  test("WebView recreate dgn sessionStorage utuh → auto-rehydrate, tanpa layar PIN", async ({ browser }) => {
    // Simulasi paling dekat dengan Android: WebView Activity hidup kembali,
    // page diturunkan & dinaikkan ulang, tapi sessionStorage (origin storage)
    // dipertahankan. Kita reproduksi dengan menyemai sessionStorage manual
    // pada context baru sebelum navigasi pertama.
    const ctx = await browser.newContext();
    const seedPage = await ctx.newPage();
    await installStubs(seedPage);
    // Buka origin agar bisa menulis sessionStorage untuk origin tsb.
    await seedPage.goto(`/t/${TOKEN}`);
    await seedPage.evaluate(
      ([key, pin]) => {
        window.sessionStorage.setItem(key, JSON.stringify({ pin, ts: Date.now() }));
      },
      [`prep_session:${TOKEN}`, PIN] as const,
    );
    await seedPage.close();

    // Page "baru" di context yang sama = WebView re-create tapi origin
    // storage tetap.
    const page = await ctx.newPage();
    await installStubs(page);
    await page.goto(`/t/${TOKEN}`);

    // Harus auto-masuk daftar tugas tanpa interaksi.
    await expect(page.getByText("Tugas Penyiapan E2E")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Beras Premium")).toBeVisible();
    await expect(page.getByText("Verifikasi PIN", { exact: false })).toHaveCount(0);

    await ctx.close();
  });
});
