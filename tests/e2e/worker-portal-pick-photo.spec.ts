import { test, expect, type Route, type Page } from "@playwright/test";
import path from "path";
import fs from "fs";
import os from "os";

/**
 * E2E: alur ambil foto (kamera) dan pilih dari galeri di portal pegawai
 * `/t/:token`. Regresi guard supaya SETIAP file yang dipilih benar-benar:
 *   1) memicu tile "Memuat…" (opsional — bila stageFile sangat cepat,
 *      langsung ke thumbnail; kedua kondisi dianggap sah);
 *   2) meninggalkan thumbnail (`img` di dalam grid foto);
 *   3) untuk input kamera → membuka PhotoEditor secara otomatis;
 *   4) untuk galeri multi-file → menambah SEMUA thumbnail tanpa membuka
 *      editor.
 *
 * Semua RPC di-stub. File yang di-`setInputFiles` adalah JPEG kecil valid
 * agar `URL.createObjectURL` sukses & `<img>` bisa render di Chromium
 * headless.
 */

const TOKEN = "e2e-token-pick-photo-abcdef";
const PIN = "123456";

// Byte pattern JPEG 1x1 (valid minimum). Dari test suite public domain.
// SOI + APP0 (JFIF) + DQT + SOF0 + DHT + SOS + kompresi minimal + EOI.
const MIN_JPEG = Buffer.from(
  "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffdb0043010909090c0b0c180d0d1832211c213232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232ffc0001108000100010301220002110103110111ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffc4001f0100030101010101010101010000000000000102030405060708090a0bffc400b51100020102040403040705040400010277000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a636465666768696a737475767778797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9faffda000c03010002110311003f00fbfcffd9",
  "hex",
);

function writeJpeg(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-pick-"));
  const p = path.join(dir, name);
  fs.writeFileSync(p, MIN_JPEG);
  return p;
}

const TASK_PAYLOAD = {
  ok: true,
  task: {
    id: "task-1",
    title: "Tugas Ambil Foto",
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
    if (!pinOk) { await fulfillJson(route, { ok: false, error: "bad_pin" }); return; }
    await fulfillJson(route, TASK_PAYLOAD);
  });
  await page.route("**/rest/v1/rpc/request_list_titles*", (r) => fulfillJson(r, { ok: true, titles: [] }));
  await page.route("**/realtime/v1/**", (r) => r.abort());
  await page.route("**/rest/v1/app_settings*", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{}]) }),
  );
}

async function loginPin(page: Page) {
  await page.goto(`/t/${TOKEN}`);
  await expect(page.getByText(/Verifikasi PIN/i)).toBeVisible({ timeout: 10_000 });
  await page.locator('input[inputmode="numeric"]').first().fill(PIN);
  await page.getByRole("button", { name: /buka/i }).click();
  await expect(page.getByText("Beras Premium")).toBeVisible({ timeout: 10_000 });
}

// Thumbnail = <img> di dalam tile grid foto (aspect-square). Header
// "X foto siap" hanya muncul saat photos.length > 0, jadi kita pakai itu
// sebagai indikator "sudah masuk state ready".
function readyBadge(page: Page) {
  return page.getByText(/foto siap/i);
}

test.describe("Portal pegawai · ambil foto & pilih dari galeri", () => {
  test("kamera: 1 foto → thumbnail muncul & PhotoEditor terbuka otomatis", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await installStubs(page);
    await loginPin(page);

    // Input kamera pakai `capture="environment"`; input galeri tidak.
    const cameraInput = page.locator('input[type="file"][accept="image/*"][capture]');
    await expect(cameraInput).toHaveCount(1);

    await cameraInput.setInputFiles(writeJpeg("kamera.jpg"));

    // 1 foto siap → header ringkasan menyebut "1 foto siap".
    await expect(readyBadge(page)).toContainText(/1 foto siap/i, { timeout: 5_000 });

    // Thumbnail di grid: <img> di dalam tile aspect-square.
    const thumbs = page.locator("div.aspect-square img");
    await expect(thumbs).toHaveCount(1);

    // PhotoEditor: toolbar aria-label unik.
    await expect(page.getByLabel("Toolbar editor foto")).toBeVisible({ timeout: 5_000 });

    await ctx.close();
  });

  test("galeri: 2 foto → 2 thumbnail muncul, editor tidak auto-terbuka", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await installStubs(page);
    await loginPin(page);

    // Input galeri: multiple, tanpa capture.
    const galleryInput = page.locator('input[type="file"][accept="image/*"][multiple]');
    await expect(galleryInput).toHaveCount(1);

    await galleryInput.setInputFiles([writeJpeg("g1.jpg"), writeJpeg("g2.jpg")]);

    await expect(readyBadge(page)).toContainText(/2 foto siap/i, { timeout: 5_000 });
    const thumbs = page.locator("div.aspect-square img");
    await expect(thumbs).toHaveCount(2);

    // Editor TIDAK boleh terbuka pada alur galeri.
    await expect(page.getByLabel("Toolbar editor foto")).toHaveCount(0);

    await ctx.close();
  });

  test("kamera → galeri: thumbnail dari kamera tetap ada saat galeri ditambah", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await installStubs(page);
    await loginPin(page);

    const cameraInput = page.locator('input[type="file"][accept="image/*"][capture]');
    await cameraInput.setInputFiles(writeJpeg("k1.jpg"));
    await expect(readyBadge(page)).toContainText(/1 foto siap/i, { timeout: 5_000 });

    // Tutup editor supaya kita bisa interaksi dengan tombol lain.
    const cancelBtn = page.getByRole("button", { name: /batal/i }).first();
    if (await cancelBtn.isVisible().catch(() => false)) await cancelBtn.click();

    const galleryInput = page.locator('input[type="file"][accept="image/*"][multiple]');
    await galleryInput.setInputFiles([writeJpeg("g1.jpg"), writeJpeg("g2.jpg")]);

    await expect(readyBadge(page)).toContainText(/3 foto siap/i, { timeout: 5_000 });
    await expect(page.locator("div.aspect-square img")).toHaveCount(3);

    await ctx.close();
  });
});