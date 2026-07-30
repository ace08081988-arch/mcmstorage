import { test, expect, type Route, type Page } from "@playwright/test";
import path from "path";
import fs from "fs";
import os from "os";

/**
 * E2E: alur pilih foto HEIC/HEIF dari kamera/galeri di portal pegawai
 * `/t/:token`. Guard supaya foto HEIC dari iPhone SELALU:
 *   1) berhasil dikonversi (via modul heic2any yang di-stub) menjadi JPEG,
 *   2) muncul sebagai thumbnail (`img` di dalam grid),
 *   3) memicu badge label "HEIC → JPEG" di tile (bukti konversi terjadi),
 *   4) untuk kamera → membuka PhotoEditor otomatis,
 *   5) TIDAK menghasilkan thumbnail duplikat — jumlah tile == jumlah file
 *      yang dipilih, baik saat pilih 2 file HEIC sekaligus, mem-pilih file
 *      HEIC yang sama dua kali via kamera, maupun campuran HEIC + JPEG.
 *
 * heic2any dimuat lewat dynamic import di `convertHeicToJpeg`. Kita
 * intercept URL modulnya via `page.route` dan mengembalikan stub kecil yang
 * hanya membungkus kembali blob input menjadi image/jpeg. Byte JPEG yang
 * kita `setInputFiles` sudah valid, jadi setelah "konversi" createObjectURL
 * dan `<img>` bisa render di Chromium headless.
 */

const TOKEN = "e2e-token-pick-heic-abcdef";
const PIN = "123456";

// JPEG 1x1 valid minimum (sama dengan worker-portal-pick-photo.spec.ts).
const MIN_JPEG = Buffer.from(
  "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffdb0043010909090c0b0c180d0d1832211c213232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232ffc0001108000100010301220002110103110111ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffc4001f0100030101010101010101010000000000000102030405060708090a0bffc400b51100020102040403040705040400010277000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a636465666768696a737475767778797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9faffda000c03010002110311003f00fbfcffd9",
  "hex",
);

function writeFile(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-heic-"));
  const p = path.join(dir, name);
  fs.writeFileSync(p, MIN_JPEG);
  return p;
}

// Playwright akan menebak MIME dari ekstensi (.heic → image/heic).
// isHeic() memakai type ATAU ekstensi nama, jadi baik ekstensi maupun MIME
// terdeteksi.
function heicUpload(name: string) {
  return { name, mimeType: "image/heic", buffer: MIN_JPEG };
}

const TASK_PAYLOAD = {
  ok: true,
  task: {
    id: "task-heic",
    title: "Tugas Foto HEIC",
    note: null,
    status: "active",
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  },
  items: [
    {
      id: "item-heic",
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

// Stub heic2any: kembalikan blob input dibungkus ulang sebagai image/jpeg.
// Byte-nya sendiri sudah JPEG valid, jadi <img> tetap bisa render.
const HEIC2ANY_STUB = `
  const fn = async ({ blob }) => {
    const buf = await blob.arrayBuffer();
    return new Blob([buf], { type: "image/jpeg" });
  };
  export default fn;
`;

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
  // Intercept modul heic2any (dynamic import) → stub.
  await page.route("**/heic2any*", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: HEIC2ANY_STUB,
    }),
  );
  await page.route("**/heic2any/**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: HEIC2ANY_STUB,
    }),
  );
}

async function loginPin(page: Page) {
  await page.goto(`/t/${TOKEN}`);
  await expect(page.getByText(/Verifikasi PIN/i)).toBeVisible({ timeout: 10_000 });
  await page.locator('input[inputmode="numeric"]').first().fill(PIN);
  await page.getByRole("button", { name: /buka/i }).click();
  await expect(page.getByText("Beras Premium")).toBeVisible({ timeout: 10_000 });
}

function readyBadge(page: Page) {
  return page.getByText(/foto siap/i);
}

test.describe("Portal pegawai · foto HEIC/HEIF", () => {
  test("kamera: HEIC → thumbnail + PhotoEditor + label konversi", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await installStubs(page);
    await loginPin(page);

    const cameraInput = page.locator('input[type="file"][accept="image/*"][capture]');
    await expect(cameraInput).toHaveCount(1);

    await cameraInput.setInputFiles(heicUpload("iphone1.heic"));

    // Header ringkas berbunyi "1 foto siap".
    await expect(readyBadge(page)).toContainText(/1 foto siap/i, { timeout: 8_000 });

    // Tepat 1 thumbnail (bukan 2 karena double-fire input change / dsb).
    const thumbs = page.locator("div.aspect-square img");
    await expect(thumbs).toHaveCount(1);

    // Badge menunjukkan konversi HEIC → JPEG terjadi.
    await expect(page.getByText(/HEIC\s*→\s*JPEG/i).first()).toBeVisible({ timeout: 5_000 });

    // PhotoEditor auto-open pada alur kamera.
    await expect(page.getByLabel("Toolbar editor foto")).toBeVisible({ timeout: 5_000 });

    await ctx.close();
  });

  test("galeri: 2 HEIC → 2 thumbnail persis (tanpa duplikat)", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await installStubs(page);
    await loginPin(page);

    const galleryInput = page.locator('input[type="file"][accept="image/*"][multiple]');
    await expect(galleryInput).toHaveCount(1);

    await galleryInput.setInputFiles([heicUpload("g1.heic"), heicUpload("g2.heic")]);

    await expect(readyBadge(page)).toContainText(/2 foto siap/i, { timeout: 8_000 });
    const thumbs = page.locator("div.aspect-square img");
    await expect(thumbs).toHaveCount(2);

    // Setiap tile membawa label konversi HEIC → JPEG.
    await expect(page.getByText(/HEIC\s*→\s*JPEG/i)).toHaveCount(2);

    // Editor TIDAK boleh auto-open pada alur galeri.
    await expect(page.getByLabel("Toolbar editor foto")).toHaveCount(0);

    await ctx.close();
  });

  test("kamera 2x nama sama: tetap 2 tile, bukan 4", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await installStubs(page);
    await loginPin(page);

    const cameraInput = page.locator('input[type="file"][accept="image/*"][capture]');

    await cameraInput.setInputFiles(heicUpload("shot.heic"));
    await expect(readyBadge(page)).toContainText(/1 foto siap/i, { timeout: 8_000 });

    // Tutup editor supaya bisa ambil lagi.
    const cancelBtn = page.getByRole("button", { name: /batal/i }).first();
    if (await cancelBtn.isVisible().catch(() => false)) await cancelBtn.click();

    // Foto kedua dengan nama file identik — regresi guard untuk kasus
    // WebView yang kadang memicu event `change` dua kali per pemilihan.
    await cameraInput.setInputFiles(heicUpload("shot.heic"));
    await expect(readyBadge(page)).toContainText(/2 foto siap/i, { timeout: 8_000 });
    await expect(page.locator("div.aspect-square img")).toHaveCount(2);

    await ctx.close();
  });

  test("campur HEIC + JPEG dari galeri: 2 thumbnail, hanya HEIC yang berlabel konversi", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await installStubs(page);
    await loginPin(page);

    const galleryInput = page.locator('input[type="file"][accept="image/*"][multiple]');
    await galleryInput.setInputFiles([
      heicUpload("mix.heic"),
      { name: "mix.jpg", mimeType: "image/jpeg", buffer: MIN_JPEG },
    ]);

    await expect(readyBadge(page)).toContainText(/2 foto siap/i, { timeout: 8_000 });
    await expect(page.locator("div.aspect-square img")).toHaveCount(2);

    // Hanya 1 tile yang menampilkan konversi HEIC → JPEG.
    await expect(page.getByText(/HEIC\s*→\s*JPEG/i)).toHaveCount(1);

    await ctx.close();
  });
});
// Menjaga writeFile agar tetap dianggap dipakai bila di masa depan tes
// dipindah untuk membaca dari disk (mirror worker-portal-pick-photo.spec).
void writeFile;