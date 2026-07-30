import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

/**
 * Integrasi: setelah user "hapus untuk saya" sebuah pesan, refresh
 * halaman TIDAK boleh memunculkannya kembali. Harness memakai jalur
 * RPC yang sama dengan UI (`message_hide_for_me`) lalu memverifikasi
 * baris `message_hidden` masih ada setelah `page.reload()` — bukti
 * hidden dipersist di server dan siap di-hydrate ulang ke cache
 * `["chat","hidden"]` pada mount berikutnya.
 *
 * Butuh storageState login. Kalau belum ada, test di-skip supaya CI
 * tanpa TEST_EMAIL/TEST_PASSWORD tidak false-red.
 */

const STORAGE = "tests/visual/.auth/user.json";

function hasAuthState(): boolean {
  if (!existsSync(STORAGE)) return false;
  try {
    const raw = JSON.parse(readFileSync(STORAGE, "utf8")) as {
      origins?: Array<{ localStorage?: Array<{ name: string }> }>;
    };
    const origins = raw.origins ?? [];
    return origins.some((o) =>
      (o.localStorage ?? []).some((kv) => /^sb-.*-auth-token$/.test(kv.name)),
    );
  } catch {
    return false;
  }
}

test.describe("message_hidden — persist across refresh", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("hidden bertahan setelah page.reload()", async ({ page }) => {
    // 1) Prepare: pilih pesan visible + panggil RPC hide.
    await page.goto("/lovable/visual/message-hidden-persist");
    await page.getByTestId("run-prepare").click();
    await expect(page.getByTestId("prepare-block")).toBeVisible();

    const prepareOk = await page.getByTestId("prepare-ok").textContent();
    const messageId = (
      await page.getByTestId("prepare-message-id").textContent()
    )?.trim();

    // Kalau user test tidak punya pesan sama sekali, harness melapor
    // `no-messages-visible-to-user` — skip alih-alih false-red.
    const step = (await page.getByTestId("prepare-step").textContent())?.trim();
    test.skip(
      step === "fetch-message",
      "Akun test belum punya pesan — skip.",
    );

    expect(prepareOk).toBe("true");
    expect(messageId).toBeTruthy();
    await expect(page.getByTestId("prepare-hidden-after")).toHaveText("true");

    // 2) Refresh keras: buka rute verify. Ini me-mount ulang komponen
    // dari nol — cache in-memory hilang, jadi kalau id masih terlihat
    // hidden, itu murni karena server persistence + RLS SELECT.
    await page.goto(
      `/lovable/visual/message-hidden-persist?verify=${encodeURIComponent(
        messageId!,
      )}`,
    );
    await page.getByTestId("run-verify").click();
    await expect(page.getByTestId("verify-block")).toBeVisible();
    await expect(page.getByTestId("verify-hidden")).toHaveText("true");
    await expect(page.getByTestId("verify-error")).toHaveText("-");
    await expect(page.getByTestId("verify-ok")).toHaveText("true");

    // 3) Cleanup — buang row supaya harness idempotent untuk run berikutnya.
    await page.getByTestId("run-cleanup").click();
    await expect(page.getByTestId("cleanup-state")).toHaveText("cleanup: ok");
  });
});