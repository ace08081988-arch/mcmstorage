import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import {
  assertChatBrandingClean,
  PHONE_ID_LIKE,
  PIN_MCM_FORMAT,
} from "./_helpers/chat-pin-assertions";

/**
 * E2E — reload berkali-kali di bawah THROTTLING JARINGAN (Slow 3G-esque)
 * pada beberapa DM. Fokus: tidak ada frame antara yang membocorkan nomor
 * telp Indonesia mentah selama fase skeleton/loading, dan begitu identitas
 * peer muncul, formatnya wajib `PIN xxxx-xxxx`.
 *
 * Strategi:
 *   1. Emulate koneksi Slow 3G via CDP `Network.emulateNetworkConditions`
 *      (400ms RTT, ~400/400 kbps, TCP-like) — dipilih daripada Playwright
 *      `route()` throttle supaya SSE/realtime + HTTP request tunduk pada
 *      throttling yang sama.
 *   2. Untuk N DM pertama: reload M kali; setiap reload dipoll dari awal
 *      (interval ~120ms) sampai `networkidle`. Setiap poll mem-scan
 *      `document.body.innerText` — jika `PHONE_ID_LIKE` pernah cocok
 *      (walau sekejap di skeleton), test gagal dengan pesan kontekstual.
 *   3. Setelah stabil, jalankan `assertChatBrandingClean` untuk kontrak
 *      final (header + transkrip).
 */

const STORAGE = "tests/visual/.auth/user.json";
const DM_COUNT = 2;
const RELOADS_PER_DM = 3;

// Slow 3G profile — mirror Chrome DevTools preset.
const SLOW_3G = {
  offline: false,
  latency: 400, // ms
  downloadThroughput: (500 * 1024) / 8, // 500 kbps
  uploadThroughput: (500 * 1024) / 8,
} as const;

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

/**
 * Sampling loop: selama `page.waitForLoadState('networkidle')` berjalan,
 * poll innerText dan gagalkan test segera jika pola telp mentah muncul —
 * satu frame pun tidak boleh bocor.
 */
async function pollForRawPhoneWhileLoading(
  page: import("@playwright/test").Page,
  label: string,
  maxMs = 12_000,
): Promise<{ pinSeen: boolean }> {
  const start = Date.now();
  let done = false;
  let pinSeen = false;

  const idle = page.waitForLoadState("networkidle").then(() => {
    done = true;
  });

  while (!done && Date.now() - start < maxMs) {
    const text = await page.evaluate(() => {
      // Normalisasi NBSP agar `PIN\u00a0xxxx-xxxx` tetap match `PIN\s+`.
      return document.body ? document.body.innerText.replace(/\u00a0/g, " ") : "";
    });
    if (PHONE_ID_LIKE.test(text)) {
      // Kumpulkan konteks untuk pesan error.
      const match = text.match(PHONE_ID_LIKE)?.[0] ?? "<unknown>";
      throw new Error(
        `[${label}] Nomor telepon Indonesia mentah bocor selama loading: "${match}"`,
      );
    }
    if (PIN_MCM_FORMAT.test(text)) {
      pinSeen = true;
    }
    await page.waitForTimeout(120);
  }

  await idle;
  // Final sweep sesudah idle — beberapa framework flush teks tepat di boundary.
  const finalText = await page.evaluate(() =>
    document.body ? document.body.innerText.replace(/\u00a0/g, " ") : "",
  );
  expect(finalText, `[${label}] final sweep bebas nomor telp`).not.toMatch(
    PHONE_ID_LIKE,
  );
  if (PIN_MCM_FORMAT.test(finalText)) pinSeen = true;
  return { pinSeen };
}

test.describe("throttled reload — no raw phone flash, PIN xxxx-xxxx stabil", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("Slow 3G × multi-DM × multi-reload: identitas selalu PIN xxxx-xxxx", async ({
    page,
    context,
  }) => {
    // Aktifkan throttling via CDP. `newCDPSession` hanya didukung di Chromium.
    test.skip(
      context.browser()?.browserType().name() !== "chromium",
      "Throttling CDP hanya tersedia di Chromium.",
    );

    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { ...SLOW_3G });

    // Kunjungi `/chat` (tanpa throttle-loop di sini supaya sampling
    // fokus di halaman DM). Biarkan idle.
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");
    const finalListText = await page.evaluate(() =>
      document.body.innerText.replace(/\u00a0/g, " "),
    );
    expect(finalListText, "daftar /chat bebas nomor telp").not.toMatch(
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
      for (let round = 1; round <= RELOADS_PER_DM; round++) {
        // Navigasi via `goto` (bukan click) supaya throttling terasa dari
        // request pertama — click akan me-warm cache Vite lebih dulu.
        await page.goto(href, { waitUntil: "commit" });
        const { pinSeen } = await pollForRawPhoneWhileLoading(
          page,
          `${href} reload#${round}`,
        );

        const clean = await assertChatBrandingClean(
          page,
          `${href} reload#${round} — pinSeenDuringLoad=${pinSeen}`,
        );
        expect(clean.header.length, `identitas peer terisi di ${href}`).toBeGreaterThan(
          0,
        );
      }
    }

    // Bersihkan throttling agar teardown cepat.
    await cdp
      .send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      })
      .catch(() => {});
  });
});