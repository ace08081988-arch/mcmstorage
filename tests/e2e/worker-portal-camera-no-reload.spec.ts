import { test, expect, type Route, type Page } from "@playwright/test";
import path from "path";
import fs from "fs";
import os from "os";

/**
 * E2E: alur portal /t/:token → ambil foto (kamera) → kembali ke halaman
 * edit. Regresi guard untuk hardening 5 Juli 2026:
 *
 *   1) TIDAK ada full-page reload sepanjang alur (navigation counter tetap 1).
 *   2) Editor foto terbuka otomatis setelah kamera "kembali".
 *   3) `__mcmBusy` naik >0 selama editor terbuka & kembali ke 0 saat ditutup
 *      (bukti mekanisme busy menahan cache-buster/reload).
 *   4) State tersimpan: thumbnail, sesi PIN (sessionStorage), dan
 *      lastSyncAt tetap ada setelah kembali ke halaman daftar.
 *   5) Bahkan bila `/api/version` melaporkan BUILD_ID baru selama editor
 *      terbuka, aplikasi TIDAK boleh hard-reload — busy flag harus
 *      menahannya.
 *
 * Semua RPC + /api/version di-stub. Simulasi "kamera kembali" memakai
 * `input.setInputFiles()` (Playwright memicu event `change` yang sama
 * dengan Android WebView setelah user menutup Camera app). Untuk
 * memperkuat, kita juga men-dispatch `visibilitychange` (visible) yang
 * lazim terjadi saat foreground kembali.
 */

const TOKEN = "e2e-camera-no-reload-token";
const PIN = "246810";

const MIN_JPEG = Buffer.from(
  "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffdb0043010909090c0b0c180d0d1832211c213232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232ffc0001108000100010301220002110103110111ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffc4001f0100030101010101010101010000000000000102030405060708090a0bffc400b51100020102040403040705040400010277000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a636465666768696a737475767778797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9faffda000c03010002110311003f00fbfcffd9",
  "hex",
);

function writeJpeg(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-cam-"));
  const p = path.join(dir, name);
  fs.writeFileSync(p, MIN_JPEG);
  return p;
}

const TASK_PAYLOAD = {
  ok: true,
  task: {
    id: "task-camera",
    title: "Tugas Kamera No-Reload",
    note: null,
    status: "active",
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  },
  items: [
    {
      id: "item-1",
      name: "Gula Pasir 1kg",
      category: "Sembako",
      qty_requested: 3,
      qty_prepared: 0,
      unit_label: "pak",
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

async function installStubs(page: Page, opts: { versionBuildId?: string } = {}) {
  await page.route("**/rest/v1/rpc/prep_peek_task*", (r) => fulfillJson(r, PEEK_PAYLOAD));
  await page.route("**/rest/v1/rpc/prep_get_task*", async (route) => {
    let pinOk = true;
    try {
      const post = route.request().postDataJSON() as { _pin?: string } | null;
      pinOk = post?._pin === PIN;
    } catch { /* anggap valid */ }
    if (!pinOk) { await fulfillJson(route, { ok: false, error: "bad_pin" }); return; }
    await fulfillJson(route, TASK_PAYLOAD);
  });
  await page.route("**/rest/v1/rpc/request_list_titles*", (r) => fulfillJson(r, { ok: true, titles: [] }));
  await page.route("**/rest/v1/app_settings*", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{}]) }),
  );
  await page.route("**/realtime/v1/**", (r) => r.abort());
  // /api/version — kalau tes ingin memicu "server BUILD_ID beda", override.
  await page.route("**/api/version*", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ buildId: opts.versionBuildId ?? "same-as-client" }),
    }),
  );
}

async function loginPin(page: Page) {
  await page.goto(`/t/${TOKEN}`);
  await expect(page.getByText(/Verifikasi PIN/i)).toBeVisible({ timeout: 10_000 });
  await page.locator('input[inputmode="numeric"]').first().fill(PIN);
  await page.getByRole("button", { name: /buka/i }).click();
  await expect(page.getByText("Gula Pasir 1kg")).toBeVisible({ timeout: 10_000 });
}

/**
 * Pasang counter navigasi di halaman. `loadCount` hanya bertambah pada
 * navigasi top-level yang menyebabkan dokumen baru dimuat (full reload).
 * SPA route change TIDAK meningkatkan angka ini.
 */
async function trackTopLevelLoads(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __loadCount?: number };
    w.__loadCount = (w.__loadCount ?? 0) + 1;
  });
}

test.describe("Portal pegawai · alur kamera tanpa reload", () => {
  test("ambil foto kamera → editor terbuka → kembali → tanpa reload, state utuh", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await installStubs(page);
    await loginPin(page);
    await trackTopLevelLoads(page);

    // Baseline: sesi tersimpan di sessionStorage.
    const storageKey = `prep_session:${TOKEN}`;
    const sessionBefore = await page.evaluate((k) => window.sessionStorage.getItem(k), storageKey);
    expect(sessionBefore).toBeTruthy();

    // 1) Trigger input kamera — simulasi kembali dari Camera app Android.
    //    Sebelum setInputFiles, dispatch `visibilitychange` (hidden→visible)
    //    yang lazim terjadi saat foreground kembali. Ini juga jalur di mana
    //    silentRefresh berkala bisa terpicu — busy flag harus mencegah reload.
    const cameraInput = page.locator('input[type="file"][accept="image/*"][capture]').first();
    await expect(cameraInput).toHaveCount(1);

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(120);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await cameraInput.setInputFiles(writeJpeg("cam.jpg"));

    // 2) PhotoEditor terbuka otomatis.
    await expect(page.getByLabel("Toolbar editor foto")).toBeVisible({ timeout: 5_000 });

    // 3) Selama editor terbuka, `__mcmBusy` harus > 0 (mekanisme menahan
    //    cache-buster / auto-logout).
    const busyWhileEditing = await page.evaluate(
      () => (window as unknown as { __mcmBusy?: number }).__mcmBusy ?? 0,
    );
    expect(busyWhileEditing).toBeGreaterThan(0);

    // 4) Tutup editor (batal) — kembali ke halaman edit tugas.
    await page.getByRole("button", { name: /batal/i }).first().click();
    await expect(page.getByLabel("Toolbar editor foto")).toHaveCount(0);

    // 5) Thumbnail tetap ada (state foto tidak hilang).
    await expect(page.locator("div.aspect-square img")).toHaveCount(1);
    await expect(page.getByText(/1 foto siap/i)).toBeVisible();

    // 6) `__mcmBusy` kembali ke 0 setelah editor ditutup.
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __mcmBusy?: number }).__mcmBusy ?? 0), {
        timeout: 3_000,
      })
      .toBe(0);

    // 7) Sesi PIN utuh.
    const sessionAfter = await page.evaluate((k) => window.sessionStorage.getItem(k), storageKey);
    expect(sessionAfter).toBeTruthy();
    const parsedBefore = JSON.parse(sessionBefore as string) as { pin: string };
    const parsedAfter = JSON.parse(sessionAfter as string) as { pin: string };
    expect(parsedAfter.pin).toBe(parsedBefore.pin);

    // 8) TIDAK ada full-page reload sepanjang alur — counter tetap 1.
    const loadCount = await page.evaluate(
      () => (window as unknown as { __loadCount?: number }).__loadCount ?? 0,
    );
    expect(loadCount).toBe(1);

    // 9) Header PIN tidak boleh muncul lagi.
    await expect(page.getByText("Verifikasi PIN", { exact: false })).toHaveCount(0);

    await ctx.close();
  });

  test("cache-buster tidak boleh reload saat busy (BUILD_ID server berbeda selama editor terbuka)", async ({ browser }) => {
    // Skenario paling ketat: server melaporkan BUILD_ID baru saat pegawai
    // masih berada di editor foto. Kode `build-cache-buster` HARUS respect
    // `window.__mcmBusy > 0` DAN pathname `/t/*`, jadi TIDAK boleh reload.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await installStubs(page, { versionBuildId: "bumped-server-build-id-9999" });
    await loginPin(page);
    await trackTopLevelLoads(page);

    const cameraInput = page.locator('input[type="file"][accept="image/*"][capture]').first();
    await cameraInput.setInputFiles(writeJpeg("cam2.jpg"));
    await expect(page.getByLabel("Toolbar editor foto")).toBeVisible({ timeout: 5_000 });

    // Paksa cek versi via visibilitychange → runCheck() dipanggil.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Beri jeda untuk fetch /api/version + evaluasi runCheck.
    await page.waitForTimeout(1_200);

    // Editor masih terbuka, artinya reload tidak terjadi.
    await expect(page.getByLabel("Toolbar editor foto")).toBeVisible();

    // Counter navigasi masih 1 (tidak ada full reload).
    const loadCount = await page.evaluate(
      () => (window as unknown as { __loadCount?: number }).__loadCount ?? 0,
    );
    expect(loadCount).toBe(1);

    await ctx.close();
  });
});
