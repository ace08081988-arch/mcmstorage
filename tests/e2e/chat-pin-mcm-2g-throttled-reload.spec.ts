import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import {
  assertChatBrandingClean,
  PHONE_ID_LIKE,
  PIN_MCM_FORMAT,
} from "./_helpers/chat-pin-assertions";

/**
 * E2E — reload di bawah throttling REGULAR 2G (lebih lambat daripada
 * Slow 3G). Fase skeleton/loading jauh lebih panjang di 2G, jadi window
 * kebocoran nomor telp mentah lebih besar. Test ini mem-poll `innerText`
 * di setiap frame sampling untuk memastikan `PHONE_ID_LIKE` TIDAK PERNAH
 * cocok — sekejap pun tidak boleh — pada beberapa DM × 3 reload.
 */

const STORAGE = "tests/visual/.auth/user.json";
const DM_COUNT = 2;
const RELOADS_PER_DM = 3;

// Regular 2G — mirror Chrome DevTools preset "Regular 2G".
// ~300 kbps down / 50 kbps up, RTT ~800ms.
const REGULAR_2G = {
  offline: false,
  latency: 800,
  downloadThroughput: (250 * 1024) / 8, // 250 kbps
  uploadThroughput: (50 * 1024) / 8, //   50 kbps
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

async function pollWhileLoading(
  page: import("@playwright/test").Page,
  label: string,
  maxMs = 25_000,
): Promise<{ pinSeen: boolean; samples: number }> {
  const start = Date.now();
  let done = false;
  let pinSeen = false;
  let samples = 0;

  const idle = page.waitForLoadState("networkidle").then(() => {
    done = true;
  });

  while (!done && Date.now() - start < maxMs) {
    const text = await page.evaluate(() =>
      document.body ? document.body.innerText.replace(/\u00a0/g, " ") : "",
    );
    samples++;
    if (PHONE_ID_LIKE.test(text)) {
      const match = text.match(PHONE_ID_LIKE)?.[0] ?? "<unknown>";
      throw new Error(
        `[${label}] Nomor telp Indonesia bocor pada 2G (frame ${samples}): "${match}"`,
      );
    }
    if (PIN_MCM_FORMAT.test(text)) pinSeen = true;
    // Sampling padat: 100ms — 2G punya banyak state antara.
    await page.waitForTimeout(100);
  }

  await idle;
  const finalText = await page.evaluate(() =>
    document.body ? document.body.innerText.replace(/\u00a0/g, " ") : "",
  );
  expect(finalText, `[${label}] final sweep 2G bebas nomor telp`).not.toMatch(
    PHONE_ID_LIKE,
  );
  if (PIN_MCM_FORMAT.test(finalText)) pinSeen = true;
  return { pinSeen, samples };
}

test.describe("2G throttled reload — no raw phone flash even at ~250 kbps", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");
  // Regular 2G × multi-DM × 3 reload memakan waktu; naikkan test timeout.
  test.setTimeout(240_000);

  test("Regular 2G × multi-DM × 3 reload: PIN xxxx-xxxx tanpa kebocoran", async ({
    page,
    context,
  }) => {
    test.skip(
      context.browser()?.browserType().name() !== "chromium",
      "Throttling CDP hanya tersedia di Chromium.",
    );

    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { ...REGULAR_2G });

    // Muat /chat pada 2G — ambil hrefs DM.
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");
    const listText = await page.evaluate(() =>
      document.body.innerText.replace(/\u00a0/g, " "),
    );
    expect(listText, "daftar /chat (2G) bebas nomor telp").not.toMatch(
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
        await page.goto(href, { waitUntil: "commit" });
        const { pinSeen, samples } = await pollWhileLoading(
          page,
          `${href} 2G reload#${round}`,
        );

        const clean = await assertChatBrandingClean(
          page,
          `${href} 2G reload#${round} — samples=${samples} pinSeen=${pinSeen}`,
        );
        expect(
          clean.header.length,
          `identitas peer terisi (2G) di ${href}`,
        ).toBeGreaterThan(0);
      }
    }

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