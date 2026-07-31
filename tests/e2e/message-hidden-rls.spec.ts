import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

/**
 * E2E: `authenticated` harus bisa SELECT tabel `message_hidden` dan
 * memanggil RPC `message_hide_for_me` tanpa "permission denied".
 *
 * Ini menjaga jalur "hapus pesan" dari regresi GRANT/RLS:
 *  - GRANT SELECT/INSERT/DELETE ON public.message_hidden TO authenticated
 *  - Policy mh_select_self / mh_insert_self / mh_delete_self scoped ke auth.uid()
 *
 * Kalau storage state kosong (TEST_EMAIL/TEST_PASSWORD belum diset di CI),
 * test di-skip supaya tidak false-red.
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

test.describe("message_hidden RLS/GRANT untuk authenticated", () => {
  test.skip(
    !hasAuthState(),
    "Storage state auth belum tersedia (TEST_EMAIL/TEST_PASSWORD?) — skip.",
  );

  test("SELECT & RPC tidak permission-denied", async ({ page }) => {
    await page.goto("/lovable/visual/message-hidden-rls");

    await page.getByTestId("run-check").click();
    await expect(page.getByTestId("result-block")).toBeVisible();

    // Confirm sesi berhasil dihidrasi dari storage state.
    await expect(page.getByTestId("authed")).toHaveText("true");

    // SELECT harus lolos (grant + policy mh_select_self aktif).
    await expect(page.getByTestId("select-ok")).toHaveText("true");
    await expect(page.getByTestId("select-error")).toHaveText("-");

    // RPC boleh error (pesan tidak ada), tapi bukan "permission denied".
    await expect(page.getByTestId("rpc-permission-denied")).toHaveText("false");
  });
});