import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { assertChatBrandingClean } from "./_helpers/chat-pin-assertions";

/**
 * E2E — rotasi orientasi (portrait ↔ landscape) sambil menjalankan
 * skenario multi-DM + multi-reload. Membuktikan bahwa perubahan
 * lebar/viewport (mis. user memutar HP saat sedang chat) tidak
 * memaksa UI fallback ke nomor telepon Indonesia mentah atau
 * merender ulang token PIN dalam format off-standard.
 *
 * Alur per DM:
 *   portrait → verifikasi → landscape → verifikasi → reload di
 *   landscape → verifikasi → balik portrait → reload → verifikasi.
 *
 * Kontrak per fase divalidasi via `assertChatBrandingClean`
 * (`_helpers/chat-pin-assertions.ts`) supaya regex PIN/HP tetap
 * satu sumber dengan seluruh suite `chat-pin-mcm-*`.
 */

const STORAGE = "tests/visual/.auth/user.json";
const PORTRAIT = { width: 411, height: 893 } as const; // Pixel 5 potret
const LANDSCAPE = { width: 893, height: 411 } as const; // rotasi 90°
const MAX_DMS = 2;

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

test.describe("orientation flip antar DM — PIN MCM stabil", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("multi-DM × multi-reload × rotate portrait↔landscape: identitas per DM tetap, no phone", async ({
    page,
  }) => {
    await page.setViewportSize({ ...PORTRAIT });
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    const links = page.locator('a[href^="/chat/"]');
    const total = await links.count();
    test.skip(total === 0, "Belum ada DM di akun test — skip.");

    const targetCount = Math.min(MAX_DMS, total);
    const hrefs: string[] = [];
    for (let i = 0; i < targetCount; i++) {
      const h = await links.nth(i).getAttribute("href");
      expect(h, `href DM #${i}`).toMatch(/^\/chat\/[0-9a-f-]{36}$/);
      hrefs.push(h!);
    }
    // Pastikan tiap DM unik supaya assertion identitas antar-DM
    // benar-benar membedakan konvo.
    expect(new Set(hrefs).size, "DM target unik").toBe(hrefs.length);

    const identities = new Map<string, string>();

    for (const href of hrefs) {
      // ── Fase 1: portrait, buka DM langsung via URL.
      await page.setViewportSize({ ...PORTRAIT });
      await page.goto(href, { waitUntil: "networkidle" });
      const portraitInit = await assertChatBrandingClean(
        page,
        `${href} portrait init`,
      );
      expect(portraitInit.header.length, `${href} identitas portrait`).toBeGreaterThan(0);
      identities.set(href, portraitInit.header);

      // ── Fase 2: rotate ke landscape TANPA reload — hanya `setViewportSize`.
      //   Layout responsif tidak boleh mengganti identitas header ke
      //   nomor telp mentah atau token off-format.
      await page.setViewportSize({ ...LANDSCAPE });
      // Beri satu tick supaya listener resize sempat menghitung ulang.
      await page.waitForTimeout(150);
      const landscape = await assertChatBrandingClean(
        page,
        `${href} landscape (no reload)`,
      );
      expect(landscape.header, `${href} identitas portrait→landscape stabil`).toBe(
        portraitInit.header,
      );

      // ── Fase 3: reload di landscape — rehidrasi di viewport lebar
      //   wajib menghasilkan identitas peer yang sama.
      await page.reload();
      await page.waitForLoadState("networkidle");
      const landscapeReload = await assertChatBrandingClean(
        page,
        `${href} landscape + reload`,
      );
      expect(
        landscapeReload.header,
        `${href} identitas landscape+reload`,
      ).toBe(portraitInit.header);

      // ── Fase 4: balik ke portrait + reload — round-trip penuh.
      await page.setViewportSize({ ...PORTRAIT });
      await page.reload();
      await page.waitForLoadState("networkidle");
      const portraitReload = await assertChatBrandingClean(
        page,
        `${href} portrait + reload`,
      );
      expect(
        portraitReload.header,
        `${href} identitas portrait+reload round-trip`,
      ).toBe(portraitInit.header);
    }

    // Identitas antar DM wajib unik — memastikan tidak ada "sticky
    // header" yang tertinggal dari DM sebelumnya saat rotate/reload.
    if (identities.size >= 2) {
      const values = [...identities.values()];
      expect(new Set(values).size, "identitas antar DM unik").toBe(values.length);
    }
  });
});