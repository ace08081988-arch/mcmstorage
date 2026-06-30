import { test, expect, type Route, type Page } from "@playwright/test";

/**
 * E2E: membuka preview portal pegawai dengan `#wpcfg=...` di satu tab
 * tidak boleh mempengaruhi TTL/lock yang ditampilkan di tab portal
 * pegawai lain yang dibuka tanpa hash. `applyPreviewOverrideFromHash()`
 * menulis ke `window.__WORKER_PORTAL_CONFIG__` yang per-tab — tab tanpa
 * hash harus tetap memakai nilai `app_settings`.
 */

const TOKEN = "e2e-token-wpcfg-iso-abc123";
const PIN = "123456";

// app_settings memberi TTL 45 menit & lock 60 dtk — nilai inilah yang
// harus tetap dipakai tab tanpa hash, terlepas dari override tab lain.
const APP_TTL_MS = 45 * 60 * 1000;
const APP_LOCK_SEC = 60;

// Hash di tab preview pakai TTL 12 menit & lock 25 dtk — sengaja
// berbeda jauh agar bocor antar-tab langsung terlihat.
const HASH_TTL_SEC = 12 * 60;
const HASH_LOCK_SEC = 25;

const TASK_PAYLOAD = {
  ok: true,
  task: {
    id: "task-1",
    title: "Tugas Isolasi Preview",
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
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          worker_portal_config: {
            sessionTtlMs: APP_TTL_MS,
            maxAttempts: 5,
            lockSeconds: APP_LOCK_SEC,
          },
        },
      ]),
    }),
  );
}

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

test.describe("Portal pegawai · isolasi preview #wpcfg antar tab", () => {
  test("tab tanpa #wpcfg memakai TTL app_settings meski tab lain memakai hash", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();

    // Tab A: preview dengan #wpcfg (TTL pendek + lock pendek).
    const previewPage = await ctx.newPage();
    await installStubs(previewPage);
    const hash = encodeWpcfg({
      sessionTtlMs: HASH_TTL_SEC * 1000,
      lockSeconds: HASH_LOCK_SEC,
      maxAttempts: 1,
    });
    await previewPage.goto(`/t/${TOKEN}${hash}`);
    await expect(previewPage.getByText(/Verifikasi PIN/i)).toBeVisible({ timeout: 10_000 });
    await previewPage.locator('input[inputmode="numeric"]').first().fill(PIN);
    await previewPage.getByRole("button", { name: /buka/i }).click();
    await expect(previewPage.getByText("Beras Premium")).toBeVisible({ timeout: 10_000 });
    const previewPill = previewPage.getByText(/^Sesi \d{1,2}:\d{2}$/);
    await expect(previewPill).toBeVisible({ timeout: 5_000 });
    const previewSec = parseClock((await previewPill.textContent()) ?? "");
    expect(previewSec).toBeGreaterThanOrEqual(HASH_TTL_SEC - 5);
    expect(previewSec).toBeLessThanOrEqual(HASH_TTL_SEC);

    // Tab B: portal pegawai tanpa hash — harus pakai TTL app_settings.
    const plainPage = await ctx.newPage();
    await installStubs(plainPage);
    await plainPage.goto(`/t/${TOKEN}`);
    await expect(plainPage.getByText(/Verifikasi PIN/i)).toBeVisible({ timeout: 10_000 });

    // Label "dikunci N detik" di layar PIN harus pakai lockSeconds
    // app_settings (60), bukan hash (25).
    await expect(plainPage.getByText(new RegExp(`dikunci ${APP_LOCK_SEC} detik`))).toBeVisible();
    await expect(plainPage.getByText(new RegExp(`dikunci ${HASH_LOCK_SEC} detik`))).toHaveCount(0);

    // window.__WORKER_PORTAL_CONFIG__ di tab tanpa hash harus kosong
    // (atau tanpa field sessionTtlMs/lockSeconds dari hash).
    const override = await plainPage.evaluate(
      () => (window as unknown as { __WORKER_PORTAL_CONFIG__?: Record<string, number> })
        .__WORKER_PORTAL_CONFIG__ ?? null,
    );
    if (override) {
      expect(override.sessionTtlMs).not.toBe(HASH_TTL_SEC * 1000);
      expect(override.lockSeconds).not.toBe(HASH_LOCK_SEC);
    }

    await plainPage.locator('input[inputmode="numeric"]').first().fill(PIN);
    await plainPage.getByRole("button", { name: /buka/i }).click();
    await expect(plainPage.getByText("Beras Premium")).toBeVisible({ timeout: 10_000 });

    const plainPill = plainPage.getByText(/^Sesi \d{1,2}:\d{2}$/);
    await expect(plainPill).toBeVisible({ timeout: 5_000 });
    const plainSec = parseClock((await plainPill.textContent()) ?? "");
    const expectedPlain = APP_TTL_MS / 1000;
    expect(plainSec).toBeGreaterThanOrEqual(expectedPlain - 5);
    expect(plainSec).toBeLessThanOrEqual(expectedPlain);
    // Sanity: jelas berbeda dari TTL hash tab A.
    expect(Math.abs(plainSec - HASH_TTL_SEC)).toBeGreaterThan(60);

    // Pill tab preview tetap memakai TTL hash — tab B tidak menulis
    // balik ke tab A.
    const previewSec2 = parseClock((await previewPill.textContent()) ?? "");
    expect(previewSec2).toBeLessThanOrEqual(HASH_TTL_SEC);
    expect(Math.abs(previewSec2 - expectedPlain)).toBeGreaterThan(60);

    await ctx.close();
  });
});