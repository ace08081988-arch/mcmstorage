import { test, expect, type Route, type Page } from "@playwright/test";

/**
 * E2E: verifikasi pill "Sesi MM:SS" di header (setelah login PIN) dan
 * indikator "Terkunci MM:SS" di layar PIN merespon konfigurasi
 * `sessionTtlMs`, `maxAttempts`, dan `lockSeconds` secara real-time.
 */

const TOKEN = "e2e-token-pill-abcdef12";
const PIN = "123456";

const TASK_PAYLOAD = {
  ok: true,
  task: {
    id: "task-1",
    title: "Tugas Pill Countdown",
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

async function injectConfig(page: Page, cfg: Record<string, number>) {
  await page.addInitScript((c) => {
    (window as unknown as { __WORKER_PORTAL_CONFIG__: Record<string, number> })
      .__WORKER_PORTAL_CONFIG__ = c;
  }, cfg);
}

/** Parse pill text "Sesi MM:SS" / "Terkunci MM:SS lagi" → total detik. */
function parseClock(text: string): number {
  const m = text.match(/(\d{1,2}):(\d{2})/);
  if (!m) return -1;
  return Number(m[1]) * 60 + Number(m[2]);
}

test.describe("Portal pegawai · pill sesi & indikator lock", () => {
  test("pill 'Sesi MM:SS' mencerminkan sessionTtlMs dan menghitung mundur", async ({
    browser,
  }) => {
    const TTL_SEC = 25 * 60; // 25 menit — di atas ambang 5 menit, pill statis tetap muncul.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await injectConfig(page, { sessionTtlMs: TTL_SEC * 1000 });
    await installStubs(page);

    await page.goto(`/t/${TOKEN}`);
    await expect(page.getByText(/Verifikasi PIN/i)).toBeVisible({ timeout: 10_000 });
    await page.locator('input[inputmode="numeric"]').first().fill(PIN);
    await page.getByRole("button", { name: /buka/i }).click();
    await expect(page.getByText("Beras Premium")).toBeVisible({ timeout: 10_000 });

    const pill = page.getByText(/^Sesi \d{1,2}:\d{2}$/);
    await expect(pill).toBeVisible({ timeout: 5_000 });

    const firstText = (await pill.textContent()) ?? "";
    const firstSec = parseClock(firstText);
    expect(firstSec).toBeGreaterThanOrEqual(TTL_SEC - 3);
    expect(firstSec).toBeLessThanOrEqual(TTL_SEC);

    await page.waitForTimeout(2_200);
    const secondText = (await pill.textContent()) ?? "";
    const secondSec = parseClock(secondText);
    expect(secondSec).toBeLessThan(firstSec);
    expect(firstSec - secondSec).toBeGreaterThanOrEqual(1);
    expect(firstSec - secondSec).toBeLessThanOrEqual(4);

    await ctx.close();
  });

  test("indikator 'Terkunci MM:SS' di layar PIN merespon lockSeconds & menghitung mundur", async ({
    browser,
  }) => {
    const MAX = 1;
    const LOCK = 90; // 1:30
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await injectConfig(page, { maxAttempts: MAX, lockSeconds: LOCK });
    await installStubs(page);

    await page.goto(`/t/${TOKEN}`);
    await expect(page.getByText(/Verifikasi PIN/i)).toBeVisible({ timeout: 10_000 });

    const input = page.locator('input[inputmode="numeric"]').first();
    await input.fill("000000");
    await page.getByRole("button", { name: /buka/i }).click();

    const lockedBtn = page.getByRole("button", { name: /Terkunci \d{1,2}:\d{2} lagi/ });
    await expect(lockedBtn).toBeVisible({ timeout: 5_000 });
    await expect(lockedBtn).toBeDisabled();

    const firstText = (await lockedBtn.textContent()) ?? "";
    const firstSec = parseClock(firstText);
    expect(firstSec).toBeGreaterThanOrEqual(LOCK - 3);
    expect(firstSec).toBeLessThanOrEqual(LOCK);

    await page.waitForTimeout(2_200);
    const secondText = (await lockedBtn.textContent()) ?? "";
    const secondSec = parseClock(secondText);
    expect(secondSec).toBeLessThan(firstSec);
    expect(firstSec - secondSec).toBeGreaterThanOrEqual(1);
    expect(firstSec - secondSec).toBeLessThanOrEqual(4);

    await ctx.close();
  });

  test("sessionTtlMs pendek → pill berganti jadi tombol 'Re-login sekarang' saat <= 5 menit", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await injectConfig(page, { sessionTtlMs: 90_000 });
    await installStubs(page);

    await page.goto(`/t/${TOKEN}`);
    await expect(page.getByText(/Verifikasi PIN/i)).toBeVisible({ timeout: 10_000 });
    await page.locator('input[inputmode="numeric"]').first().fill(PIN);
    await page.getByRole("button", { name: /buka/i }).click();
    await expect(page.getByText("Beras Premium")).toBeVisible({ timeout: 10_000 });

    const reloginBtn = page.getByRole("button", { name: /Re-login sekarang/i }).first();
    await expect(reloginBtn).toBeVisible({ timeout: 5_000 });

    await ctx.close();
  });
});
