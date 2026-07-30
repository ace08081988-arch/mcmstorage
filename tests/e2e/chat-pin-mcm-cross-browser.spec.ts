import { test, expect, devices } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import {
  assertChatBrandingClean,
  expectPinBrandingClean,
} from "./_helpers/chat-pin-assertions";

/**
 * E2E lintas-browser — skenario PIN MCM (buka `/chat`, buka DM pertama,
 * verifikasi header + transkrip, reload, verifikasi ulang) dijalankan
 * di tiga engine berbeda: Chromium, Firefox, dan WebKit.
 *
 * Tujuan: menutup celah engine-specific. Regex `Intl`/pemisahan grapheme
 * di WebKit, normalisasi whitespace di Firefox, dan quirks font di
 * Chromium bisa mengubah cara token PIN dirender atau di-serialize ke
 * `innerText`. Suite ini memaksa hasil `PIN xxxx-xxxx` konsisten dan
 * BEBAS nomor telepon Indonesia mentah di ketiganya.
 *
 * Registrasi proyek (lihat `playwright.config.ts`):
 *   - chat-pin-mcm-cross-browser-chromium-e2e
 *   - chat-pin-mcm-cross-browser-firefox-e2e
 *   - chat-pin-mcm-cross-browser-webkit-e2e
 *
 * Storage state (`tests/visual/.auth/user.json`) di-share dengan suite
 * chat-pin-mcm lain; test self-skip bila belum ada sesi login atau
 * belum ada DM di akun test.
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

test.describe("chat PIN MCM — lintas browser (Chromium/Firefox/WebKit)", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("daftar → DM pertama → reload: PIN xxxx-xxxx konsisten, bebas nomor telp mentah", async ({
    page,
    browserName,
  }, testInfo) => {
    testInfo.annotations.push({
      type: "browser",
      description: `${browserName} (${testInfo.project.name})`,
    });

    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    const listText = await page.locator("main, body").first().innerText();
    expectPinBrandingClean(listText, `daftar chat @ ${browserName}`);

    const firstDm = page
      .locator('a[href^="/chat/"], [data-testid="chat-list-item"] a')
      .first();
    if ((await firstDm.count()) === 0) {
      test.skip(true, `Belum ada DM di akun test — skip runtime ${browserName}.`);
      return;
    }
    await firstDm.click();
    await page.waitForURL(/\/chat\/[0-9a-f-]{8,}/i);
    await page.waitForLoadState("networkidle");

    const before = await assertChatBrandingClean(page, `pre-reload @ ${browserName}`);
    expect(before.header.length, "header identity kosong").toBeGreaterThan(0);

    await page.reload();
    await page.waitForLoadState("networkidle");

    const after = await assertChatBrandingClean(page, `post-reload @ ${browserName}`);

    // Identitas peer wajib STABIL antar reload di ketiga engine — tidak
    // ada engine yang boleh "flip" fallback ke nomor telp mentah setelah
    // rehidrasi.
    expect(after.header, `header berubah setelah reload di ${browserName}`).toBe(
      before.header,
    );
  });

  // Selain devices default per-project, verifikasi ulang bahwa
  // `extractPinTokens`/`PIN_MCM_FORMAT` menerima payload teks yang keluar
  // dari mesin masing-masing tanpa distorsi (contoh: NBSP vs space,
  // normalisasi baris). Kita ambil ulang innerText body & pastikan
  // token PIN yang terekstrak — bila ada — semuanya lolos regex resmi.
  test("innerText body → semua token PIN lolos format resmi di engine ini", async ({
    page,
    browserName,
  }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");
    const bodyText = await page.locator("body").first().innerText();
    // NBSP → space supaya perbedaan encoding whitespace antar engine
    // tidak memicu false-negative extractor. Regex sendiri sudah
    // memakai `\s+`, tapi normalisasi eksplisit lebih jelas.
    const normalized = bodyText.replace(/\u00A0/g, " ");
    expectPinBrandingClean(normalized, `body @ ${browserName}`);
  });
});

// Re-export `devices` supaya IDE tidak menandai import tak-terpakai bila
// spec diperluas untuk memakai device profile spesifik di masa depan.
export const _crossBrowserDevices = devices;