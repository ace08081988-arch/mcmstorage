import { test, expect, type Route, type Page } from "@playwright/test";
import path from "path";
import fs from "fs";
import os from "os";

/**
 * E2E regression guards untuk hardening 6 Juli 2026:
 *
 *   1) Panel item pegawai (ItemCard) yang sudah dibuka manual TIDAK BOLEH
 *      auto-kolaps saat `silentRefresh` berkala (visibilitychange /
 *      heartbeat 15s / broadcast realtime) mengembalikan data yang sama.
 *      Fix: `hasAutoCollapsedRef` + `prevIsDoneRef` di ItemCard sehingga
 *      hanya transisi asli false→true yang memicu auto-collapse — bukan
 *      re-render dari silentRefresh dengan payload identik.
 *
 *   2) PhotoEditor SELALU terbuka untuk tiap foto ketika user memilih
 *      beberapa foto sekaligus dari galeri. Fix: sinkronisasi
 *      `photosRef.current = photos` dipindah ke `useLayoutEffect` +
 *      fallback `queueMicrotask` di `openEditForIdx` sehingga tidak ada
 *      race di mana ref masih stale saat `setTimeout(0)` macrotask
 *      dari `advanceEditQueue` berjalan.
 *
 * Semua RPC + /api/version di-stub — tidak menyentuh backend.
 */

const TOKEN = "e2e-panel-photoedit-token-01";
const PIN = "135790";

const MIN_JPEG = Buffer.from(
  "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffdb0043010909090c0b0c180d0d1832211c213232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232ffc0001108000100010301220002110103110111ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffc4001f0100030101010101010101010000000000000102030405060708090a0bffc400b51100020102040403040705040400010277000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a636465666768696a737475767778797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9faffda000c03010002110311003f00fbfcffd9",
  "hex",
);

function writeJpeg(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-panel-"));
  const p = path.join(dir, name);
  fs.writeFileSync(p, MIN_JPEG);
  return p;
}

const ITEM_NOT_DONE = {
  id: "item-not-done",
  name: "Beras Premium 5kg",
  category: "Sembako",
  qty_requested: 4,
  qty_prepared: 0,
  unit_label: "pak",
  ref_photo_path: null,
  note: null,
  updated_at: new Date().toISOString(),
  submissions: [] as unknown[],
};

const ITEM_DONE = {
  id: "item-done",
  name: "Gula Pasir 1kg",
  category: "Sembako",
  qty_requested: 2,
  qty_prepared: 2,
  unit_label: "pak",
  ref_photo_path: null,
  note: null,
  updated_at: new Date().toISOString(),
  submissions: [
    {
      id: "sub-1",
      photo_paths: ["path/a.jpg"],
      location_url: null,
      submitted_at: new Date().toISOString(),
    },
  ],
};

function makeTaskPayload(items: unknown[]) {
  return {
    ok: true,
    task: {
      id: "task-panel",
      title: "Regresi Panel & PhotoEditor",
      note: null,
      status: "active",
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
    items,
  };
}

const PEEK_PAYLOAD = {
  ok: true,
  title: "Regresi Panel & PhotoEditor",
  expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
};

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

type Stubs = { getTaskCalls: number };

async function installStubs(page: Page, items: unknown[]): Promise<Stubs> {
  const stubs: Stubs = { getTaskCalls: 0 };
  await page.route("**/rest/v1/rpc/prep_peek_task*", (r) => fulfillJson(r, PEEK_PAYLOAD));
  await page.route("**/rest/v1/rpc/prep_get_task*", async (route) => {
    stubs.getTaskCalls += 1;
    let pinOk = true;
    try {
      const post = route.request().postDataJSON() as { _pin?: string } | null;
      pinOk = post?._pin === PIN;
    } catch { /* anggap valid */ }
    if (!pinOk) { await fulfillJson(route, { ok: false, error: "bad_pin" }); return; }
    await fulfillJson(route, makeTaskPayload(items));
  });
  await page.route("**/rest/v1/rpc/request_list_titles*", (r) => fulfillJson(r, { ok: true, titles: [] }));
  await page.route("**/rest/v1/app_settings*", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{}]) }),
  );
  await page.route("**/realtime/v1/**", (r) => r.abort());
  await page.route("**/api/version*", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ buildId: "same-as-client" }) }),
  );
  return stubs;
}

async function loginPin(page: Page, itemNameToWaitFor: string) {
  await page.goto(`/t/${TOKEN}`);
  await expect(page.getByText(/Verifikasi PIN/i)).toBeVisible({ timeout: 10_000 });
  await page.locator('input[inputmode="numeric"]').first().fill(PIN);
  await page.getByRole("button", { name: /buka/i }).click();
  await expect(page.getByText(itemNameToWaitFor).first()).toBeVisible({ timeout: 10_000 });
}

async function fireVisibilityCycle(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

test.describe("Portal pegawai · guard panel item & PhotoEditor", () => {
  test("panel item yang dibuka manual tidak auto-kolaps saat silentRefresh berulang mengembalikan data sama", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const stubs = await installStubs(page, [ITEM_DONE]);
    await loginPin(page, ITEM_DONE.name);

    // Locate the item-level toggle button (aria-expanded) berisi nama item.
    // Ada tombol group-level (chevron header kategori) yang juga pakai
    // aria-expanded — kita target tombol yang KONTAK dengan nama item.
    const toggle = page.locator(`button[aria-expanded]:has-text("${ITEM_DONE.name}")`).first();
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // User membuka panel secara manual.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    // Baseline: silentRefresh setelah login sudah pernah jalan minimal 1x
    // (via handler `authed` init). Simpan angka sekarang untuk dibandingkan
    // setelah kita paksa beberapa siklus visibilitychange.
    const callsBefore = stubs.getTaskCalls;

    // Paksa 6 siklus visibilitychange → tiap `visible` memicu silentRefresh
    // yang me-return payload identik. Tidak boleh ada auto-collapse.
    for (let i = 0; i < 6; i++) {
      await fireVisibilityCycle(page);
      // beri jaringan waktu untuk resolve RPC + React commit.
      await page.waitForTimeout(120);
      await expect(toggle, `panel harus tetap terbuka setelah siklus #${i + 1}`).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    }

    // silentRefresh benar-benar dipanggil lebih dari sekali (bukti bahwa
    // guard bukan sekadar "tidak ada refresh yang jalan").
    expect(stubs.getTaskCalls).toBeGreaterThan(callsBefore);

    // Tunggu >900ms — window auto-collapse (setTimeout 900ms di ItemCard)
    // sudah terlewati; panel tetap terbuka.
    await page.waitForTimeout(1_100);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    await ctx.close();
  });

  test("PhotoEditor terbuka untuk tiap foto saat multi-pick dari galeri (queue urut)", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await installStubs(page, [ITEM_NOT_DONE]);
    await loginPin(page, ITEM_NOT_DONE.name);

    // Buka panel item pending.
    const toggle = page.locator(`button[aria-expanded]:has-text("${ITEM_NOT_DONE.name}")`).first();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    // Locator input galeri (multi) di dalam panel — dibedakan dari input
    // kamera oleh atribut `multiple`.
    const galleryInput = page.locator('input[type="file"][accept="image/*"][multiple]').first();
    await expect(galleryInput).toHaveCount(1);

    // Pilih 3 foto sekaligus. `stageGalleryFiles` akan membuka PhotoEditor
    // untuk indeks pertama, lalu `advanceEditQueue` melanjutkan ke berikutnya
    // tiap kali `Simpan` diklik.
    const files = [writeJpeg("g1.jpg"), writeJpeg("g2.jpg"), writeJpeg("g3.jpg")];
    await galleryInput.setInputFiles(files);

    // Foto #1 — PhotoEditor terbuka.
    await expect(page.getByLabel("Toolbar editor foto")).toBeVisible({ timeout: 5_000 });

    // Simpan foto #1 → editor harus tertutup sebentar lalu terbuka lagi
    // untuk foto #2. Tunggu tombol `canvasReady` (Simpan tidak disabled).
    const saveBtn = page.getByRole("button", { name: /^simpan$/i });
    await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
    await saveBtn.click();

    // Foto #2 — PhotoEditor terbuka lagi (advanceEditQueue dengan
    // setTimeout(0) + useLayoutEffect harus konsisten).
    await expect(page.getByLabel("Toolbar editor foto")).toBeVisible({ timeout: 5_000 });
    await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
    await saveBtn.click();

    // Foto #3 — PhotoEditor terbuka.
    await expect(page.getByLabel("Toolbar editor foto")).toBeVisible({ timeout: 5_000 });
    await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
    await saveBtn.click();

    // Antrian habis → editor menutup dan semua 3 foto ter-stage sebagai
    // thumbnail di panel item.
    await expect(page.getByLabel("Toolbar editor foto")).toHaveCount(0, { timeout: 5_000 });
    await expect(page.locator("div.aspect-square img")).toHaveCount(3, { timeout: 3_000 });

    await ctx.close();
  });

  test("PhotoEditor terbuka konsisten pada 3 iterasi pick tunggal berurutan", async ({ browser }) => {
    // Regresi khusus untuk race photosRef stale: ulang alur "pick 1 foto →
    // editor buka → batal" tiga kali cepat. Sebelum fix (useEffect biasa),
    // kadang editor tidak muncul karena setTimeout(0) macrotask jalan
    // sebelum ref ter-update.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await installStubs(page, [ITEM_NOT_DONE]);
    await loginPin(page, ITEM_NOT_DONE.name);

    const toggle = page.locator(`button[aria-expanded]:has-text("${ITEM_NOT_DONE.name}")`).first();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    const galleryInput = page.locator('input[type="file"][accept="image/*"][multiple]').first();
    for (let i = 0; i < 3; i++) {
      await galleryInput.setInputFiles(writeJpeg(`solo-${i}.jpg`));
      await expect(
        page.getByLabel("Toolbar editor foto"),
        `iterasi #${i + 1}: PhotoEditor harus terbuka`,
      ).toBeVisible({ timeout: 5_000 });
      // Batal → kosongkan antrian & tutup editor. Foto TETAP ter-stage
      // (batal hanya menutup editor, tidak menghapus foto).
      await page.getByRole("button", { name: /^batal$/i }).first().click();
      await expect(page.getByLabel("Toolbar editor foto")).toHaveCount(0, { timeout: 3_000 });
    }

    // 3 iterasi masing-masing mendaftarkan 1 foto → total 3 thumbnail.
    await expect(page.locator("div.aspect-square img")).toHaveCount(3, { timeout: 3_000 });

    await ctx.close();
  });
});
