// E2E: alur "Kirim WA & catat lunas → balik ke app".
//
// Harness: /lovable/visual/ecer-return-from-wa (no-auth, in-memory state).
// Meniru dua invariant yang ditegakkan di route `/ecer` + `SendPrepLinkDialog`:
//   1. Setelah tap "Kirim WA & catat lunas", finalize (mark-sent + refresh
//      daftar) HANYA dipicu oleh `visibilitychange → visible` (balik dari
//      WA) atau fallback 4 detik — daftar TIDAK boleh kosong di antara-nya.
//   2. Nama pegawai per-title diisolasi via localStorage
//      `mcm:sendPrepLink:workerName:<titleId>` — berganti title tidak boleh
//      menyilangkan draft nama.
import { test, expect } from "@playwright/test";

const URL = "/lovable/visual/ecer-return-from-wa";

test.describe("Ecer return-from-WA", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      // Bersihkan draft worker name antar-test agar isolasi murni.
      try {
        for (let i = window.localStorage.length - 1; i >= 0; i--) {
          const k = window.localStorage.key(i);
          if (k && k.startsWith("mcm:sendPrepLink:workerName:")) {
            window.localStorage.removeItem(k);
          }
        }
      } catch { /* noop */ }
    });
    await page.goto(URL);
    await expect(page.getByRole("heading", { name: /Ecer return-from-WA/ })).toBeVisible();
  });

  test("balik dari WA (visibilitychange) → item pindah ke Riwayat, daftar tidak kosong", async ({ page }) => {
    await expect(page.getByTestId("preps-count")).toHaveText("3");
    await expect(page.getByTestId("sent-count")).toHaveText("0");

    // Simulasi berpindah ke WhatsApp: hidden dulu.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await page.getByTestId("send-wa-p1").click();

    // Sebelum balik: prep MASIH aktif (belum ditandai lunas),
    // penanda "menunggu balik…" tampil, daftar tidak kosong.
    await expect(page.getByTestId("pending-p1")).toBeVisible();
    await expect(page.getByTestId("active-prep-p1")).toBeVisible();
    await expect(page.getByTestId("preps-empty")).toHaveCount(0);
    await expect(page.getByTestId("sent-count")).toHaveText("0");

    // Balik ke app: visibilitychange → visible.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Finalize: pindah ke Riwayat, daftar aktif tetap terisi (sisa 2).
    await expect(page.getByTestId("riwayat-prep-p1")).toBeVisible();
    await expect(page.getByTestId("active-prep-p1")).toHaveCount(0);
    await expect(page.getByTestId("preps-count")).toHaveText("2");
    await expect(page.getByTestId("sent-count")).toHaveText("1");
    await expect(page.getByTestId("preps-empty")).toHaveCount(0);
  });

  test("fallback 4 detik: bila tidak pernah balik, prep tetap ditandai lunas", async ({ page }) => {
    await page.getByTestId("send-wa-p2").click();
    await expect(page.getByTestId("pending-p2")).toBeVisible();

    // Percepat waktu 4 dtk untuk memicu fallback timer.
    await page.evaluate(() => new Promise((r) => setTimeout(r, 4100)));

    await expect(page.getByTestId("riwayat-prep-p2")).toBeVisible();
    await expect(page.getByTestId("active-prep-p2")).toHaveCount(0);
  });

  test("nama pegawai tidak tertukar antar-title saat berganti-ganti", async ({ page }) => {
    // Isi nama untuk title A.
    const input = page.getByTestId("worker-name-input");
    const echo = page.getByTestId("worker-name-echo");
    await input.fill("Andi");
    await expect(echo).toHaveText("Andi");

    // Pindah ke title B — input HARUS kosong (draft berbeda).
    await page.getByTestId("title-select-t-B").click();
    await expect(input).toHaveValue("");
    await expect(echo).toHaveText("");

    await input.fill("Budi");
    await expect(echo).toHaveText("Budi");

    // Kembali ke A — draft "Andi" harus utuh, bukan "Budi".
    await page.getByTestId("title-select-t-A").click();
    await expect(input).toHaveValue("Andi");
    await expect(echo).toHaveText("Andi");

    // Dan sekali lagi ke B — draft "Budi" masih utuh.
    await page.getByTestId("title-select-t-B").click();
    await expect(input).toHaveValue("Budi");

    // Persistensi localStorage sesuai kunci per-title.
    const drafts = await page.evaluate(() => ({
      a: window.localStorage.getItem("mcm:sendPrepLink:workerName:t-A"),
      b: window.localStorage.getItem("mcm:sendPrepLink:workerName:t-B"),
    }));
    expect(drafts.a).toBe("Andi");
    expect(drafts.b).toBe("Budi");
  });

  test("kombinasi: kirim WA di title A tidak bocorkan nama pegawai ke title B", async ({ page }) => {
    await page.getByTestId("worker-name-input").fill("Andi");
    await page.getByTestId("title-select-t-B").click();
    await page.getByTestId("worker-name-input").fill("Budi");

    // Kembali ke A, kirim WA salah satu prep A, balik dari WA.
    await page.getByTestId("title-select-t-A").click();
    await page.getByTestId("send-wa-p1").click();
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.getByTestId("riwayat-prep-p1")).toBeVisible();

    // Nama untuk B tidak boleh berubah ke "Andi".
    await page.getByTestId("title-select-t-B").click();
    await expect(page.getByTestId("worker-name-input")).toHaveValue("Budi");
  });
});