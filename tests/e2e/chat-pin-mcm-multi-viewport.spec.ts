import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import {
  assertChatBrandingClean,
  expectPinBrandingClean,
} from "./_helpers/chat-pin-assertions";

/**
 * E2E — skenario yang sama (buka DM eksisting pertama → verifikasi
 * header + transkrip → reload → verifikasi lagi) dijalankan di
 * beberapa lebar layar via proyek Playwright terpisah
 * (`…-mobile-e2e`, `…-tablet-e2e`, `…-desktop-e2e`). Tujuan: memastikan
 * layout responsif tidak menggeser identitas peer kembali ke nomor
 * telepon mentah pada breakpoint manapun — header + transkrip wajib
 * selalu `PIN xxxx-xxxx` dan bebas nomor telp Indonesia mentah.
 *
 * Helper `assertChatBrandingClean` dipakai supaya kontrak regex
 * PIN/HP terkunci di satu tempat (`_helpers/chat-pin-assertions.ts`).
 */

const STORAGE = "tests/visual/.auth/user.json";

function hasAuthState(): boolean {
  if (!existsSync(STORAGE)) return false;
  try {
    const raw = JSON.parse(readFileSync(STORAGE, "utf8")) as {
      origins?: Array<{ localStorage?: Array<{ name: string }> }>;
    };
    return (raw.origins ?? []).some((o) =>
      (o.localStorage ?? []).some((kv) => /^sb-.*-auth-token$/.test(kv.name)),
    );
  } catch {
    return false;
  }
}

test.describe("multi-viewport — PIN MCM konsisten di semua lebar", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("buka DM pertama → verifikasi header + transkrip → reload → verifikasi ulang", async ({
    page,
  }, testInfo) => {
    const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
    testInfo.annotations.push({
      type: "viewport",
      description: `${width}x${height} (${testInfo.project.name})`,
    });

    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    // Snapshot daftar chat: wajib bebas nomor telp mentah & token PIN
    // yang muncul wajib berformat `xxxx-xxxx` — di semua lebar.
    const listText = await page.locator("main, body").first().innerText();
    expectPinBrandingClean(listText, `daftar chat @ ${width}px`);

    // Buka DM pertama yang tersedia. Selector fleksibel supaya bekerja
    // baik di layout mobile (list stack) maupun desktop (2-pane).
    const firstDm = page
      .locator('a[href^="/chat/"], [data-testid="chat-list-item"] a')
      .first();
    if ((await firstDm.count()) === 0) {
      test.skip(true, "Belum ada DM di akun test — skip runtime multi-viewport.");
      return;
    }
    await firstDm.click();
    await page.waitForURL(/\/chat\/[0-9a-f-]{8,}/i);
    await page.waitForLoadState("networkidle");

    const before = await assertChatBrandingClean(
      page,
      `pre-reload @ ${width}px`,
    );
    expect(before.header.length).toBeGreaterThan(0);

    await page.reload();
    await page.waitForLoadState("networkidle");

    const after = await assertChatBrandingClean(
      page,
      `post-reload @ ${width}px`,
    );

    // Identitas header wajib persist lintas reload di setiap viewport.
    expect(after.header).toBe(before.header);
  });
});
