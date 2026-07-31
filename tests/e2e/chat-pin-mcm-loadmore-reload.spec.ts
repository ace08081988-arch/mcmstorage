import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { assertChatBrandingClean } from "./_helpers/chat-pin-assertions";

/**
 * E2E — scroll-up untuk load-more + reload berulang.
 *
 * Alur:
 *   1. Buka DM eksisting pertama.
 *   2. Verifikasi awal (header + transkrip bersih).
 *   3. Scroll ke atas beberapa kali untuk memicu pagination
 *      (`useConversationMessages` fetchNextPage) hingga tidak ada
 *      pesan lama baru yang muncul.
 *   4. Verifikasi lagi sesudah setiap wave pagination.
 *   5. Reload halaman N kali; setelah tiap reload, verifikasi ulang
 *      supaya rehidrasi cache TanStack Query yang mem-flush infinite
 *      pages tetap merender `PIN xxxx-xxxx` dan bebas nomor telp.
 *
 * Berbeda dari `chat-pin-mcm-send-then-loadmore.spec.ts` (yang
 * mem-send pesan sebelum load-more) dan `chat-pin-mcm-pagination.spec.ts`
 * (yang hanya menguji pagination sekali), suite ini fokus pada
 * interaksi *load-more berulang* + *reload berkali-kali* dalam satu
 * konvo — kombinasi yang paling sering memicu regresi identitas peer
 * karena scroll container reset ke nol setelah reload.
 */

const STORAGE = "tests/visual/.auth/user.json";
const LOADMORE_WAVES = 4;
const RELOAD_ROUNDS = 3;

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
 * Ambil jumlah bubble pesan yang tampil. Selector fleksibel supaya
 * bekerja lintas skin bubble (owner vs peer, teks vs lampiran).
 */
async function countBubbles(page: import("@playwright/test").Page): Promise<number> {
  const candidates = [
    '[data-testid="chat-message-bubble"]',
    '[data-message-id]',
    'article[data-role="message"]',
  ];
  for (const sel of candidates) {
    const c = await page.locator(sel).count();
    if (c > 0) return c;
  }
  // Fallback konservatif: hitung elemen dengan atribut `data-message-*`.
  return page.locator("[data-message-id], [data-message-key]").count();
}

/**
 * Scroll transkrip ke paling atas untuk memicu pagination. Support
 * baik container khusus (data-testid) maupun window scroll fallback.
 */
async function scrollToTop(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    const el =
      document.querySelector<HTMLElement>('[data-testid="chat-scroll-region"]') ||
      document.querySelector<HTMLElement>('main [data-radix-scroll-area-viewport]') ||
      document.querySelector<HTMLElement>("main");
    if (el) el.scrollTop = 0;
    // Sekaligus scroll window untuk layout yang menaruh transkrip
    // langsung di body.
    window.scrollTo(0, 0);
  });
}

test.describe("scroll-up load-more + reload berulang — PIN MCM stabil", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("buka DM → wave load-more → reload×N: header/transkrip tetap PIN xxxx-xxxx, no phone", async ({
    page,
  }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    const firstDm = page
      .locator('a[href^="/chat/"], [data-testid="chat-list-item"] a')
      .first();
    if ((await firstDm.count()) === 0) {
      test.skip(true, "Belum ada DM di akun test — skip.");
      return;
    }
    const href = await firstDm.getAttribute("href");
    expect(href, "href DM").toMatch(/^\/chat\/[0-9a-f-]{36}$/);

    await firstDm.click();
    await page.waitForURL(new RegExp(`${href}$`));
    await page.waitForLoadState("networkidle");

    // Baseline: verifikasi awal + snapshot identitas peer.
    const initial = await assertChatBrandingClean(page, "initial");
    expect(initial.header.length, "identitas peer awal").toBeGreaterThan(0);

    // ── Wave load-more: scroll ke atas berulang, hitung apakah jumlah
    //   bubble bertambah. Verifikasi branding sesudah TIAP wave —
    //   pesan lama yang baru masuk tidak boleh membawa nomor telp
    //   mentah maupun token PIN off-format.
    let previousCount = await countBubbles(page);
    for (let wave = 1; wave <= LOADMORE_WAVES; wave++) {
      await scrollToTop(page);
      // Beri waktu fetchNextPage + render.
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(400);

      const now = await countBubbles(page);
      const clean = await assertChatBrandingClean(
        page,
        `load-more wave ${wave} (bubble ${previousCount}→${now})`,
      );
      expect(clean.header, `identitas peer persist wave ${wave}`).toBe(
        initial.header,
      );

      if (now <= previousCount) {
        // Sudah mentok — tidak ada pesan lama baru. Berhenti scroll.
        break;
      }
      previousCount = now;
    }

    // ── Reload berulang: setelah pagination "mekar", scroll container
    //   akan direset. Rehidrasi wajib tetap menampilkan identitas peer
    //   yang sama dan tidak ada nomor telp mentah bocor di halaman.
    for (let round = 1; round <= RELOAD_ROUNDS; round++) {
      await page.reload();
      await page.waitForLoadState("networkidle");
      const clean = await assertChatBrandingClean(page, `reload #${round}`);
      expect(clean.header, `identitas peer persist reload #${round}`).toBe(
        initial.header,
      );

      // Setelah reload terakhir, scroll ulang untuk memastikan wave
      //   load-more pasca-reload juga bersih (bukan hanya baseline).
      if (round === RELOAD_ROUNDS) {
        await scrollToTop(page);
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(400);
        const post = await assertChatBrandingClean(
          page,
          `post-reload load-more wave`,
        );
        expect(post.header, "identitas peer setelah reload+load-more").toBe(
          initial.header,
        );
      }
    }
  });
});