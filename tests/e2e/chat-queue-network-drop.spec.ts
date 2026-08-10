// E2E: kontrak queue produk pada composer chat saat jaringan drop.
//
// Invariant yang di-e2e-kan:
//   1. Isi queue (3 item) → tulis envelope v2 ke localStorage dgn
//      `PENDING_PRODUCTS_VERSION` yang persis sama dgn route produksi.
//   2. `context.setOffline(true)` → tekan Kirim → SEMUA item tetap
//      tersimpan di composer, status per-item = "failed", localStorage
//      masih berisi 3 item — tidak ada yang bocor / hilang.
//   3. Kembali online → tekan Kirim → queue habis (0 item), key
//      localStorage dihapus (envelope-empty).
//
// Harness: /lovable/visual/chat-queue-network-drop (publik, no-auth).
// Menggunakan konstanta `PENDING_PRODUCTS_VERSION` dari
// `@/lib/chat-queue-schema` — modul yang sama dgn yang dipakai
// `_authenticated.chat.$conversationId.tsx`. Bump versi = spec merah.
import { test, expect } from "@playwright/test";

const URL = "/lovable/visual/chat-queue-network-drop";

test.describe("Queue produk composer: network drop tidak menghilangkan item", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId("btn-seed")).toBeVisible();
  });

  test("network drop di tengah kirim → item gagal tetap di composer & localStorage", async ({
    page,
    context,
  }) => {
    // Seed 3 item, verifikasi state awal.
    await page.getByTestId("btn-seed").click();
    await expect(page.getByTestId("queue-length")).toHaveText("3");

    // Envelope localStorage berbentuk `{ v: PENDING_PRODUCTS_VERSION, items: [...] }`.
    const versionAttr = await page
      .getByTestId("ls-snapshot")
      .getAttribute("data-version");
    expect(versionAttr).toBeTruthy();
    const version = Number(versionAttr);
    const seededRaw = (await page.getByTestId("ls-snapshot").textContent()) ?? "";
    const seeded = JSON.parse(seededRaw);
    expect(seeded.v).toBe(version);
    expect(Array.isArray(seeded.items)).toBe(true);
    expect(seeded.items).toHaveLength(3);

    // Simulasikan network drop SEBELUM tekan Kirim.
    await context.setOffline(true);
    await page.evaluate(() => {
      // Beberapa Chromium build menunggu event flag; paksa event
      // supaya listener harness ikut mereflect state offline.
      window.dispatchEvent(new Event("offline"));
    });
    await expect(page.getByTestId("online-state")).toHaveAttribute("data-online", "0");

    await page.getByTestId("btn-kirim").click();
    // Tunggu loop selesai (busy → 0).
    await expect(page.getByTestId("busy-state")).toHaveAttribute("data-busy", "0");

    // Semua item MASIH ada di composer.
    await expect(page.getByTestId("queue-length")).toHaveText("3");
    for (const id of ["row-1", "row-2", "row-3"]) {
      const item = page.getByTestId(`queue-item-${id}`);
      await expect(item).toBeVisible();
      await expect(item).toHaveAttribute("data-status", "failed");
      await expect(page.getByTestId(`queue-status-${id}`)).toHaveText("failed");
    }

    // localStorage masih berisi 3 item, envelope v2 utuh.
    const afterFailRaw = (await page.getByTestId("ls-snapshot").textContent()) ?? "";
    const afterFail = JSON.parse(afterFailRaw);
    expect(afterFail.v).toBe(version);
    expect(afterFail.items).toHaveLength(3);
    await expect(page.getByTestId("ls-snapshot")).toHaveAttribute("data-empty", "0");

    // Reconnect → retry sukses → queue kosong, localStorage terhapus.
    await context.setOffline(false);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("online"));
    });
    await expect(page.getByTestId("online-state")).toHaveAttribute("data-online", "1");

    await page.getByTestId("btn-kirim").click();
    await expect(page.getByTestId("busy-state")).toHaveAttribute("data-busy", "0");
    await expect(page.getByTestId("queue-length")).toHaveText("0");
    await expect(page.getByTestId("ls-snapshot")).toHaveAttribute("data-empty", "1");
    // Key localStorage dihapus saat queue kosong (bukan sekadar `[]`).
    const finalKeyValue = await page.evaluate(
      () => window.localStorage.getItem("mcm.chat.pendingProducts.harness-net-drop"),
    );
    expect(finalKeyValue).toBeNull();
  });

  test("positive control: online → tekan Kirim → queue habis dalam satu run", async ({
    page,
  }) => {
    await page.getByTestId("btn-seed").click();
    await expect(page.getByTestId("queue-length")).toHaveText("3");

    await page.getByTestId("btn-kirim").click();
    await expect(page.getByTestId("busy-state")).toHaveAttribute("data-busy", "0");
    await expect(page.getByTestId("queue-length")).toHaveText("0");
    await expect(page.getByTestId("ls-snapshot")).toHaveAttribute("data-empty", "1");
  });
});