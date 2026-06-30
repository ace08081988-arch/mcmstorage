import { test, expect, type Route, type Page } from "@playwright/test";

/**
 * E2E: override `#wpcfg=<base64url-JSON>` di URL portal pegawai harus
 * diterapkan sebelum mount sehingga TTL sesi & lock yang ditampilkan
 * mengikuti konfigurasi efektif dari hash — tanpa menyentuh nilai
 * tersimpan di `app_settings` atau `window.__WORKER_PORTAL_CONFIG__`
 * yang di-inject manual.
 */

const TOKEN = "e2e-token-wpcfg-abcdef12";
const PIN = "123456";

const TASK_PAYLOAD = {
  ok: true,
  task: {
    id: "task-1",
    title: "Tugas Preview Hash",
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
  // app_settings sengaja membalas data berbeda dari hash → memastikan
  // hash menang. TTL 60 menit / lock 60 dtk = nilai operasional standar.
  await page.route("**/rest/v1/app_settings*", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          worker_portal_config: {
            sessionTtlMs: 60 * 60 * 1000,
            maxAttempts: 5,
            lockSeconds: 60,
          },
        },
      ]),
    }),
  );
}

/** Encode persis seperti `encodePreviewConfigHash` di src/lib/worker-portal-config.ts. */
function encodeWpcfg(cfg: Record<string, number>): string {
  const json = JSON.stringify(cfg);
  const b64 = Buffer.from(json, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `#wpcfg=${b64}`;
}

function parseClock(text: string): number {
  const m = text.match(/(\d{1,2}):(\d{2})/);
  if (!m) return -1;
  return Number(m[1]) * 60 + Number(m[2]);
}

test.describe("Portal pegawai · preview override via #wpcfg", () => {
  test("TTL sesi mengikuti #wpcfg, mengalahkan app_settings", async ({ browser }) => {
    const TTL_SEC = 22 * 60; // 22 menit — di atas ambang re-login 5 menit.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await installStubs(page);

    const hash = encodeWpcfg({ sessionTtlMs: TTL_SEC * 1000 });
    await page.goto(`/t/${TOKEN}${hash}`);
    await expect(page.getByText(/Verifikasi PIN/i)).toBeVisible({ timeout: 10_000 });

    // Hash sudah harus tertanam ke window override sebelum login.
    const override = await page.evaluate(
      () => (window as unknown as { __WORKER_PORTAL_CONFIG__?: Record<string, number> })
        .__WORKER_PORTAL_CONFIG__ ?? null,
    );
    expect(override).toMatchObject({ sessionTtlMs: TTL_SEC * 1000 });

    await page.locator('input[inputmode="numeric"]').first().fill(PIN);
    await page.getByRole("button", { name: /buka/i }).click();
    await expect(page.getByText("Beras Premium")).toBeVisible({ timeout: 10_000 });

    const pill = page.getByText(/^Sesi \d{1,2}:\d{2}$/);
    await expect(pill).toBeVisible({ timeout: 5_000 });
    const first = parseClock((await pill.textContent()) ?? "");
    // Harus dekat TTL hash (22 menit), bukan TTL app_settings (60 menit).
    expect(first).toBeGreaterThanOrEqual(TTL_SEC - 5);
    expect(first).toBeLessThanOrEqual(TTL_SEC);

    await page.waitForTimeout(2_200);
    const second = parseClock((await pill.textContent()) ?? "");
    expect(second).toBeLessThan(first);

    await ctx.close();
  });

  test("lockSeconds & maxAttempts dari #wpcfg dipakai di layar PIN", async ({ browser }) => {
    const MAX = 1;
    const LOCK = 75;
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await installStubs(page);

    const hash = encodeWpcfg({ maxAttempts: MAX, lockSeconds: LOCK });
    await page.goto(`/t/${TOKEN}${hash}`);
    await expect(page.getByText(/Verifikasi PIN/i)).toBeVisible({ timeout: 10_000 });

    // Hint sisa percobaan + label lock harus pakai nilai hash, bukan
    // app_settings (maxAttempts=5, lockSeconds=60).
    await expect(page.getByText(new RegExp(`dikunci ${LOCK} detik`))).toBeVisible();

    await page.locator('input[inputmode="numeric"]').first().fill("000000");
    await page.getByRole("button", { name: /buka/i }).click();

    const lockedBtn = page.getByRole("button", { name: /Terkunci \d{1,2}:\d{2} lagi/ });
    await expect(lockedBtn).toBeVisible({ timeout: 5_000 });
    await expect(lockedBtn).toBeDisabled();

    const firstSec = parseClock((await lockedBtn.textContent()) ?? "");
    expect(firstSec).toBeGreaterThanOrEqual(LOCK - 5);
    expect(firstSec).toBeLessThanOrEqual(LOCK);

    await page.waitForTimeout(2_200);
    const secondSec = parseClock((await lockedBtn.textContent()) ?? "");
    expect(secondSec).toBeLessThan(firstSec);

    await ctx.close();
  });

  test("payload #wpcfg rusak → fallback ke default, akses tidak diblok", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await installStubs(page);

    // Bukan base64-JSON valid → applyPreviewOverrideFromHash() return null.
    await page.goto(`/t/${TOKEN}#wpcfg=$$not-base64$$`);
    await expect(page.getByText(/Verifikasi PIN/i)).toBeVisible({ timeout: 10_000 });

    // Default operasional tetap berlaku (maxAttempts=3, lockSeconds=60).
    await expect(page.getByText(/dikunci 60 detik/)).toBeVisible();

    await page.locator('input[inputmode="numeric"]').first().fill(PIN);
    await page.getByRole("button", { name: /buka/i }).click();
    await expect(page.getByText("Beras Premium")).toBeVisible({ timeout: 10_000 });

    await ctx.close();
  });
});