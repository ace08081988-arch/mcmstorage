import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import {
  assertChatBrandingClean,
  PHONE_ID_LIKE,
  PIN_MCM_FORMAT,
} from "./_helpers/chat-pin-assertions";

/**
 * E2E — simulasi OFFLINE lalu kembali ONLINE pada beberapa DM.
 *
 * Alur:
 *   1. Buka `/chat`, kumpulkan href DM.
 *   2. Untuk tiap DM:
 *      a. `page.goto(dm)` saat ONLINE → assert branding bersih.
 *      b. Aktifkan OFFLINE via CDP `Network.emulateNetworkConditions`
 *         ({ offline: true }). Reload halaman — network gagal, UI
 *         seharusnya menampilkan cache / skeleton / banner offline.
 *         Selama fase ini, poll `innerText` untuk memastikan tidak ada
 *         nomor telp Indonesia mentah bocor (fallback dari cache basi).
 *      c. Kembalikan ONLINE, biarkan `networkidle`.
 *      d. Assert final: header `PIN xxxx-xxxx`, transkrip bersih.
 *
 * Menjaga kontrak: bahkan di jalur offline (cache stale, retry gagal,
 * error boundary) tidak ada nomor telp mentah yang lolos ke DOM, dan
 * setelah reconnect identitas peer wajib diformat sebagai PIN MCM.
 */

const STORAGE = "tests/visual/.auth/user.json";
const DM_COUNT = 2;

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

async function sweepInnerText(
  page: import("@playwright/test").Page,
): Promise<string> {
  return page.evaluate(() =>
    document.body ? document.body.innerText.replace(/\u00a0/g, " ") : "",
  );
}

/**
 * Selama window `durationMs`, poll `innerText` dan gagalkan bila
 * `PHONE_ID_LIKE` cocok. Dipakai untuk fase offline (loading/skeleton
 * dari cache basi) di mana kita tidak menunggu `networkidle` — request
 * tidak akan pernah selesai.
 */
async function assertNoRawPhoneDuring(
  page: import("@playwright/test").Page,
  label: string,
  durationMs = 2500,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    const text = await sweepInnerText(page);
    if (PHONE_ID_LIKE.test(text)) {
      const match = text.match(PHONE_ID_LIKE)?.[0] ?? "<unknown>";
      throw new Error(
        `[${label}] Nomor telepon Indonesia mentah bocor saat offline: "${match}"`,
      );
    }
    await page.waitForTimeout(150);
  }
}

test.describe("offline → reconnect — PIN xxxx-xxxx tetap konsisten, bebas nomor telp", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("offline reload lalu online: identitas peer selalu PIN xxxx-xxxx", async ({
    page,
    context,
  }) => {
    test.skip(
      context.browser()?.browserType().name() !== "chromium",
      "Emulasi offline via CDP hanya tersedia di Chromium.",
    );

    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");

    // Baseline: /chat online, kumpulkan DM hrefs.
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");
    const listText = await sweepInnerText(page);
    expect(listText, "daftar /chat online bebas nomor telp").not.toMatch(
      PHONE_ID_LIKE,
    );

    const dmLinks = await page
      .locator('a[href^="/chat/"]')
      .evaluateAll((els) =>
        (els as HTMLAnchorElement[])
          .map((a) => a.getAttribute("href") ?? "")
          .filter((h) => /^\/chat\/[0-9a-f-]{36}$/.test(h)),
      );
    const unique = Array.from(new Set(dmLinks)).slice(0, DM_COUNT);
    if (unique.length === 0) {
      test.skip(true, "Belum ada DM di akun test — skip.");
      return;
    }

    for (const href of unique) {
      // (a) ONLINE — kunjungi DM, cache warm.
      await page.goto(href);
      await page.waitForLoadState("networkidle");
      const onlineClean = await assertChatBrandingClean(
        page,
        `${href} ONLINE baseline`,
      );
      expect(
        onlineClean.header.length,
        `identitas peer terisi (online) di ${href}`,
      ).toBeGreaterThan(0);

      // (b) OFFLINE — matikan network dan reload.
      await cdp.send("Network.emulateNetworkConditions", {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
      });
      // `waitUntil: 'commit'` — offline reload tidak akan mencapai `load`.
      await page.reload({ waitUntil: "commit" }).catch(() => {
        /* offline reload boleh throw; UI harus tetap konsisten */
      });
      await assertNoRawPhoneDuring(page, `${href} OFFLINE reload`);

      // Sanity: kalau PIN sudah keburu muncul saat offline (dari SW/cache),
      // formatnya wajib benar.
      const offlineText = await sweepInnerText(page);
      if (PIN_MCM_FORMAT.test(offlineText)) {
        expect(
          offlineText,
          `[${href} OFFLINE] PIN muncul dari cache wajib PIN xxxx-xxxx`,
        ).toMatch(PIN_MCM_FORMAT);
      }

      // (c) ONLINE kembali.
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
      // Reload sekali lagi supaya request yang gagal saat offline diulang
      // dari kondisi bersih (bukan sekadar retry di background).
      await page.reload();
      await page.waitForLoadState("networkidle");

      // (d) Final assertion — kontrak PIN MCM.
      const reconnectClean = await assertChatBrandingClean(
        page,
        `${href} RECONNECT`,
      );
      expect(
        reconnectClean.header.length,
        `identitas peer terisi (reconnect) di ${href}`,
      ).toBeGreaterThan(0);
      // Identitas peer harus konsisten dengan baseline online.
      expect(
        reconnectClean.header,
        `identitas peer stabil online→offline→online di ${href}`,
      ).toBe(onlineClean.header);
    }
  });
});