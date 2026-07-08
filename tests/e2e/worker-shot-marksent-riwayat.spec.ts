// E2E: setelah tombol Kirim WA / Kirim Chat pada kartu kiriman pegawai
// dipanggil, kartu HARUS langsung hilang dari grid Aktif dan muncul di
// tab "Riwayat Terkirim" — tanpa reload halaman.
//
// Harness: /lovable/visual/worker-shot-marksent (no-auth, no network).
// Tombol WA/Chat memanggil `markSent` — persis seperti handler di
// `WorkerSubmissionsCard` sesudah `shareToWhatsApp` / `shareToChat`
// sukses. Ini menegaskan invariant reaktif SSOT `wa-sent-history`:
// subscriber (`useSentShots` / `useSentDetails`) refetch snapshot
// begitu event `wa-sent-shots:changed` di-dispatch.
import { test, expect } from "@playwright/test";

const URL_HARNESS = "/lovable/visual/worker-shot-marksent";

test.describe("markSent worker-shot → pindah ke Riwayat Terkirim tanpa reload", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL_HARNESS);
    await expect(page.getByRole("heading", { name: /Worker shot markSent/i })).toBeVisible();
  });

  test("Kirim WA memindahkan kartu dari Aktif ke Riwayat, kanal = wa", async ({ page }) => {
    // Sentinel reload — hilang bila document di-reload.
    await page.evaluate(() => {
      (window as unknown as { __noReload?: boolean }).__noReload = true;
    });

    await expect(page.getByTestId("active-count")).toHaveText("3");
    await expect(page.getByTestId("sent-count")).toHaveText("0");
    await expect(page.getByTestId("active-shot-ws-1")).toBeVisible();
    await expect(page.getByTestId("riwayat-shot-ws-1")).toHaveCount(0);

    await page.getByTestId("send-wa-ws-1").click();

    // Reaktif: langsung hilang dari aktif, muncul di riwayat.
    await expect(page.getByTestId("active-shot-ws-1")).toHaveCount(0);
    await expect(page.getByTestId("riwayat-shot-ws-1")).toBeVisible();
    await expect(page.getByTestId("channel-ws-1")).toHaveText("wa");
    await expect(page.getByTestId("active-count")).toHaveText("2");
    await expect(page.getByTestId("sent-count")).toHaveText("1");

    // Tidak reload.
    const stillMounted = await page.evaluate(
      () => (window as unknown as { __noReload?: boolean }).__noReload === true,
    );
    expect(stillMounted, "halaman tidak boleh reload").toBe(true);
  });

  test("Kirim Chat memindahkan kartu, kanal = chat", async ({ page }) => {
    await page.getByTestId("send-chat-ws-2").click();

    await expect(page.getByTestId("active-shot-ws-2")).toHaveCount(0);
    await expect(page.getByTestId("riwayat-shot-ws-2")).toBeVisible();
    await expect(page.getByTestId("channel-ws-2")).toHaveText("chat");
    await expect(page.getByTestId("sent-count")).toHaveText("1");
  });

  test("Beberapa kartu berturut-turut: badge & daftar konsisten", async ({ page }) => {
    await page.getByTestId("send-wa-ws-1").click();
    await page.getByTestId("send-chat-ws-3").click();

    await expect(page.getByTestId("active-shot-ws-1")).toHaveCount(0);
    await expect(page.getByTestId("active-shot-ws-3")).toHaveCount(0);
    await expect(page.getByTestId("active-shot-ws-2")).toBeVisible();

    await expect(page.getByTestId("riwayat-shot-ws-1")).toBeVisible();
    await expect(page.getByTestId("riwayat-shot-ws-3")).toBeVisible();
    await expect(page.getByTestId("riwayat-shot-ws-2")).toHaveCount(0);

    await expect(page.getByTestId("active-count")).toHaveText("1");
    await expect(page.getByTestId("sent-count")).toHaveText("2");

    await expect(page.getByTestId("channel-ws-1")).toHaveText("wa");
    await expect(page.getByTestId("channel-ws-3")).toHaveText("chat");
  });

  test("Reaktivitas bertahan meski localStorage.setItem throw (overlay in-memory)", async ({ page }) => {
    // Simulasikan private-mode / quota exceeded — setItem selalu throw.
    // Overlay in-memory di wa-sent-history HARUS tetap membuat kartu
    // pindah ke Riwayat, dan event `wa-sent-shots:changed` tetap fire.
    await page.evaluate(() => {
      const orig = window.localStorage.setItem.bind(window.localStorage);
      // Simpan pointer supaya bisa direstore setelah test bila perlu.
      (window as unknown as { __origSetItem?: typeof orig }).__origSetItem = orig;
      window.localStorage.setItem = () => {
        throw new Error("QuotaExceededError");
      };
    });

    await page.getByTestId("send-wa-ws-1").click();

    await expect(page.getByTestId("active-shot-ws-1")).toHaveCount(0);
    await expect(page.getByTestId("riwayat-shot-ws-1")).toBeVisible();
    await expect(page.getByTestId("sent-count")).toHaveText("1");
  });
});