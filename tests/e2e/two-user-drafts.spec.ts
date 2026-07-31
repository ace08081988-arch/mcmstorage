// E2E: dua user berbeda pada device yang sama tidak boleh saling melihat
// draft `mcm:sendPrepLink:workerName:*`. Setelah namespace ke
// `:u:<userId>:<titleId>`, draft user A dan user B secara fisik menempati
// slot localStorage berbeda dan tidak pernah tercampur — meski title.id
// yang sama dipakai ulang oleh user berikutnya.
//
// Harness: /lovable/visual/two-user-drafts (no-auth, memakai fungsi
// `scopedKey` produksi dari `@/lib/user-scoped-storage`).
import { test, expect } from "@playwright/test";

const URL_HARNESS = "/lovable/visual/two-user-drafts";

test.describe("Two-user localStorage isolation (workerName drafts)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL_HARNESS);
    // Bersihkan localStorage supaya test deterministik.
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
    await expect(page.getByRole("heading", { name: /Two-user drafts/i })).toBeVisible();
  });

  test("draft user-1 tidak terlihat oleh user-2 pada title.id yang sama", async ({ page }) => {
    // U1 login → ketik draft di Title A.
    await page.getByTestId("login-u1").click();
    await expect(page.getByTestId("active-user")).toHaveText("user-1");
    await page.getByTestId("worker-name").fill("Andi (U1)");
    await expect(page.getByTestId("worker-echo")).toHaveText("Andi (U1)");
    await expect(page.getByTestId("scoped-key")).toHaveText(
      "mcm:sendPrepLink:workerName:u:user-1:A",
    );

    // Sign out → sign in sebagai U2. Title tetap A (title.id sama).
    await page.getByTestId("login-out").click();
    await page.getByTestId("login-u2").click();
    await expect(page.getByTestId("active-user")).toHaveText("user-2");
    await expect(page.getByTestId("scoped-key")).toHaveText(
      "mcm:sendPrepLink:workerName:u:user-2:A",
    );
    // U2 tidak melihat draft U1 walau title.id identik.
    await expect(page.getByTestId("worker-echo")).toHaveText("(kosong)");
    await expect(page.getByTestId("worker-name")).toHaveValue("");

    // U2 mengetik draft sendiri.
    await page.getByTestId("worker-name").fill("Budi (U2)");
    await expect(page.getByTestId("worker-echo")).toHaveText("Budi (U2)");

    // Kedua slot hidup berdampingan di localStorage.
    const storage = await page.evaluate(() => ({
      u1: window.localStorage.getItem("mcm:sendPrepLink:workerName:u:user-1:A"),
      u2: window.localStorage.getItem("mcm:sendPrepLink:workerName:u:user-2:A"),
    }));
    expect(storage.u1).toBe("Andi (U1)");
    expect(storage.u2).toBe("Budi (U2)");
  });

  test("kembali ke user-1 memulihkan draftnya, bukan draft user-2", async ({ page }) => {
    await page.getByTestId("login-u1").click();
    await page.getByTestId("worker-name").fill("Andi");
    await page.getByTestId("login-out").click();

    await page.getByTestId("login-u2").click();
    await page.getByTestId("worker-name").fill("Budi");
    await page.getByTestId("login-out").click();

    // Kembali sebagai U1 → draft "Andi" muncul lagi (bukan "Budi").
    await page.getByTestId("login-u1").click();
    await expect(page.getByTestId("worker-echo")).toHaveText("Andi");

    // Ganti ke U2 → draft "Budi" muncul.
    await page.getByTestId("login-out").click();
    await page.getByTestId("login-u2").click();
    await expect(page.getByTestId("worker-echo")).toHaveText("Budi");
  });

  test("isolasi tetap terjaga saat ganti title A ↔ B antar-user", async ({ page }) => {
    await page.getByTestId("login-u1").click();
    await page.getByTestId("worker-name").fill("U1-A");
    await page.getByTestId("title-B").click();
    await page.getByTestId("worker-name").fill("U1-B");

    await page.getByTestId("login-out").click();
    await page.getByTestId("login-u2").click();
    // Title B masih terpilih dari state komponen, tapi user baru → kosong.
    await expect(page.getByTestId("worker-echo")).toHaveText("(kosong)");
    await page.getByTestId("worker-name").fill("U2-B");
    await page.getByTestId("title-A").click();
    await expect(page.getByTestId("worker-echo")).toHaveText("(kosong)");
    await page.getByTestId("worker-name").fill("U2-A");

    const storage = await page.evaluate(() => ({
      u1a: window.localStorage.getItem("mcm:sendPrepLink:workerName:u:user-1:A"),
      u1b: window.localStorage.getItem("mcm:sendPrepLink:workerName:u:user-1:B"),
      u2a: window.localStorage.getItem("mcm:sendPrepLink:workerName:u:user-2:A"),
      u2b: window.localStorage.getItem("mcm:sendPrepLink:workerName:u:user-2:B"),
    }));
    expect(storage).toEqual({
      u1a: "U1-A",
      u1b: "U1-B",
      u2a: "U2-A",
      u2b: "U2-B",
    });
  });

  test("logout (anon) memiliki slot terpisah dari user manapun", async ({ page }) => {
    // Anon dulu.
    await page.getByTestId("worker-name").fill("Anon draft");
    await expect(page.getByTestId("scoped-key")).toHaveText(
      "mcm:sendPrepLink:workerName:u:anon:A",
    );

    // Sign in U1 → anon draft tak boleh terlihat.
    await page.getByTestId("login-u1").click();
    await expect(page.getByTestId("worker-echo")).toHaveText("(kosong)");

    const anonSlot = await page.evaluate(() =>
      window.localStorage.getItem("mcm:sendPrepLink:workerName:u:anon:A"),
    );
    expect(anonSlot).toBe("Anon draft");
  });
});