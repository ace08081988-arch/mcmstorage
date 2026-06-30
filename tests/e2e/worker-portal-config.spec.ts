import { test, expect, type Route, type Page } from "@playwright/test";

/**
 * E2E: portal pegawai harus menghormati nilai `WorkerPortalConfig`
 * (`sessionTtlMs`, `maxAttempts`, `lockSeconds`) yang diset via remote
 * override. Dua skenario:
 *   1. Session TTL kedaluwarsa → sesi tersimpan dibuang, layar PIN muncul lagi.
 *   2. Salah PIN sebanyak `maxAttempts` → input dikunci sesuai `lockSeconds`.
 */

const TOKEN = "e2e-token-cfg-abcdef12";
const PIN = "123456";

const TASK_PAYLOAD = {
  ok: true,
  task: {
    id: "task-1",
    title: "Tugas Penyiapan Cfg",
    note: null,
    status: "active",
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  },
  items: [
    {
      id: "item-1",
      name: "Beras Premium",
      category: "Sembako",
      qty_requested: 1,
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
  title: TASK_PAYLOAD.task.title,
  expires_at: TASK_PAYLOAD.task.expires_at,
};

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installStubs(page: Page) {
  await page.route("**/rest/v1/rpc/prep_peek_task*", (r) => fulfillJson(r, PEEK_PAYLOAD));
  await page.route("**/rest/v1/rpc/prep_get_task*", async (route) => {
    let pinOk = true;
    try {
      const post = route.request().postDataJSON() as { _pin?: string } | null;
      pinOk = post?._pin === PIN;
    } catch { /* anggap valid */ }
    if (!pinOk) {
      await fulfillJson(route, { ok: false, error: "bad_pin" });
      return;
    }
    await fulfillJson(route, TASK_PAYLOAD);
  });
  await page.route("**/realtime/v1/**", (r) => r.abort());
  await page.route("**/rest/v1/app_settings*", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
}

/** Set runtime override config SEBELUM bundle React di-mount. */
async function injectConfig(page: Page, cfg: Record<string, number>) {
  await page.addInitScript((c) => {
    (window as unknown as { __WORKER_PORTAL_CONFIG__: Record<string, number> })
      .__WORKER_PORTAL_CONFIG__ = c;
  }, cfg);
}

test.describe("Portal pegawai · konfigurasi TTL & lock", () => {
  test("sessionTtlMs kedaluwarsa → kembali ke layar PIN", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await injectConfig(page, { sessionTtlMs: 2_000 });
    await installStubs(page);

    await page.goto(`/t/${TOKEN}`);
    // Seed sessionStorage dgn timestamp lampau jauh.
    await page.evaluate(
      ([key, pin]) => {
        window.sessionStorage.setItem(
          key,
          JSON.stringify({ pin, ts: Date.now() - 60_000 }),
        );
      },
      [`prep_session:${TOKEN}`, PIN] as const,
    );

    await page.reload();
    await expect(page.getByText(/Verifikasi PIN/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Beras Premium")).toHaveCount(0);

    // Sesi basi harus dibersihkan.
    const stored = await page.evaluate(
      (key) => window.sessionStorage.getItem(key),
      `prep_session:${TOKEN}`,
    );
    expect(stored).toBeNull();

    await ctx.close();
  });

  test("salah PIN mencapai maxAttempts → input dikunci sesuai lockSeconds", async ({
    browser,
  }) => {
    const MAX = 2;
    const LOCK = 30;
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await injectConfig(page, { maxAttempts: MAX, lockSeconds: LOCK });
    await installStubs(page);

    await page.goto(`/t/${TOKEN}`);
    const input = page.locator('input[inputmode="numeric"]').first();
    const submit = page.getByRole("button", { name: /buka/i });

    await expect(page.getByText(/Verifikasi PIN/i)).toBeVisible({ timeout: 10_000 });

    // 1x salah → hint sisa percobaan + label LOCK muncul.
    await input.fill("000000");
    await submit.click();
    await expect(
      page.getByText(new RegExp(`Sisa percobaan.*dari ${MAX}`)),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByText(new RegExp(`dikunci ${LOCK} detik`)),
    ).toBeVisible();

    // Percobaan ke-MAX → terkunci.
    await input.fill("000001");
    await submit.click();

    await expect(page.getByText(/Akses sementara dikunci/i)).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByRole("button", { name: /Terkunci/i })).toBeVisible();
    await expect(submit).toBeDisabled();

    // State lock persist ke localStorage.
    const persisted = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      `prep_pin_attempts:${TOKEN}`,
    );
    expect(persisted).toBeTruthy();
    const parsed = JSON.parse(persisted as string) as {
      attempts: number;
      lockedUntil: number | null;
    };
    expect(parsed.attempts).toBe(MAX);
    expect(parsed.lockedUntil).toBeGreaterThan(Date.now());
    const expected = Date.now() + LOCK * 1000;
    expect(Math.abs((parsed.lockedUntil ?? 0) - expected)).toBeLessThan(5_000);

    // Reload — lock bertahan, PIN benar pun tetap disabled.
    await page.reload();
    await expect(page.getByText(/Akses sementara dikunci/i)).toBeVisible({
      timeout: 10_000,
    });
    await page.locator('input[inputmode="numeric"]').first().fill(PIN);
    await expect(page.getByRole("button", { name: /Terkunci/i })).toBeDisabled();

    await ctx.close();
  });

  test("nilai invalid → portal pakai default, tidak mengunci akses secara salah", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    // Semua nilai di bawah ini melanggar `min` di WORKER_PORTAL_CONFIG_FIELDS
    // sehingga sanitizer harus membuangnya dan fallback ke default operasional
    // (maxAttempts=3, lockSeconds=60, sessionTtlMs=30 menit).
    await injectConfig(page, {
      sessionTtlMs: 10,
      maxAttempts: 0,
      lockSeconds: 1,
      silentFailTolerance: 0,
      lagThresholdSec: 1,
      staleThresholdSec: 1,
    });
    await installStubs(page);

    await page.goto(`/t/${TOKEN}`);
    await expect(page.getByText(/Verifikasi PIN/i)).toBeVisible({ timeout: 10_000 });

    const input = page.locator('input[inputmode="numeric"]').first();
    const submit = page.getByRole("button", { name: /buka/i });

    // 2x PIN salah — kalau maxAttempts invalid dipakai (=0), pengguna akan
    // langsung terkunci. Default (3) harus dipertahankan, jadi masih ada
    // sisa percobaan dan hint "dari 3".
    await input.fill("000000");
    await submit.click();
    await expect(page.getByText(/Sisa percobaan.*dari 3/)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/dikunci 60 detik/)).toBeVisible();

    await input.fill("000001");
    await submit.click();
    await expect(page.getByText(/Sisa percobaan.*dari 3/)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/Akses sementara dikunci/i)).toHaveCount(0);
    await expect(submit).toBeEnabled();

    // PIN benar harus tetap diterima dan masuk daftar tugas.
    await input.fill(PIN);
    await submit.click();
    await expect(page.getByText("Beras Premium")).toBeVisible({ timeout: 10_000 });

    // Reload cepat — sessionTtlMs invalid (=10 ms) tidak boleh memantulkan
    // pegawai ke layar PIN; default 30 menit harus berlaku.
    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.getByText("Beras Premium")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Verifikasi PIN/i)).toHaveCount(0);

    await ctx.close();
  });

  test("rt error → auto-resync menghormati cooldown, lalu pegawai dipantulkan ke layar PIN sesuai tolerance", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    // Cooldown kecil agar test selesai cepat tapi tetap di atas min (1000ms).
    await injectConfig(page, {
      lagThresholdSec: 5,
      staleThresholdSec: 10,
      lagCooldownMs: 1000,
      staleCooldownBaseMs: 1000,
      staleCooldownMaxMs: 4000,
      silentFailTolerance: 2,
      sessionTtlMs: 30 * 60 * 1000,
      maxAttempts: 3,
      lockSeconds: 60,
    });

    // Realtime sengaja diputus → rtStatus="error" → effect auto-resync
    // langsung menganggap status "stale" tanpa harus menunggu umur data.
    await page.route("**/realtime/v1/**", (r) => r.abort());
    await page.route("**/rest/v1/rpc/prep_peek_task*", (r) => fulfillJson(r, PEEK_PAYLOAD));
    await page.route("**/rest/v1/app_settings*", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    );

    // Hitung waktu tiap panggilan prep_get_task. Panggilan PERTAMA (auth via
    // PIN) harus sukses; panggilan berikutnya (auto-resync) membalas "closed"
    // agar silentFailRef menumpuk sampai tolerance terpenuhi.
    const callTimestamps: number[] = [];
    await page.route("**/rest/v1/rpc/prep_get_task*", async (route) => {
      callTimestamps.push(Date.now());
      const isFirst = callTimestamps.length === 1;
      let pinOk = true;
      try {
        const post = route.request().postDataJSON() as { _pin?: string } | null;
        pinOk = post?._pin === PIN;
      } catch { /* anggap valid */ }
      if (isFirst) {
        await fulfillJson(route, pinOk ? TASK_PAYLOAD : { ok: false, error: "bad_pin" });
        return;
      }
      await fulfillJson(route, { ok: false, error: "closed", status: "completed" });
    });

    await page.goto(`/t/${TOKEN}`);
    await expect(page.getByText(/Verifikasi PIN/i)).toBeVisible({ timeout: 10_000 });

    await page.locator('input[inputmode="numeric"]').first().fill(PIN);
    await page.getByRole("button", { name: /buka/i }).click();
    await expect(page.getByText("Beras Premium")).toBeVisible({ timeout: 10_000 });

    // Tunggu hingga ≥3 panggilan: 1 auth + 2 auto-resync (cukup memicu
    // tolerance=2 → kick). Polling sampai 20 dtk.
    await expect.poll(() => callTimestamps.length, { timeout: 20_000, intervals: [500] }).toBeGreaterThanOrEqual(3);

    // Cooldown sanity-check: jarak antar percobaan auto-resync (call #2 → #3)
    // tidak boleh lebih cepat dari staleCooldownBaseMs (1000 ms). Pakai
    // batas bawah longgar 800 ms untuk toleransi scheduler.
    const gap = callTimestamps[2] - callTimestamps[1];
    expect(gap, `gap auto-resync ${gap}ms harus ≥ cooldown`).toBeGreaterThanOrEqual(800);

    // Setelah tolerance terpenuhi: layar "Tugas sudah ditutup pemilik" muncul,
    // sessionStorage dibersihkan, dan tombol kembali ke PIN tersedia.
    await expect(page.getByText(/Tugas sudah ditutup pemilik/i)).toBeVisible({ timeout: 15_000 });
    const sessionLeft = await page.evaluate(
      (key) => window.sessionStorage.getItem(key),
      `prep_session:${TOKEN}`,
    );
    expect(sessionLeft).toBeNull();

    // Kembali ke halaman PIN harus tersedia dan berfungsi.
    await page.getByRole("button", { name: /Kembali ke halaman PIN/i }).click();
    await expect(page.getByText(/Verifikasi PIN/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Beras Premium")).toHaveCount(0);

    await ctx.close();
  });
});
