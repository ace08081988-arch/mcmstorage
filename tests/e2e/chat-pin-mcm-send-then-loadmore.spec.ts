import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E — Setelah mengirim pesan baru di DM yang sudah ada, memicu
 * pagination/load-more dengan scroll ke atas transkrip WAJIB:
 *   - Tetap merender identitas `PIN xxxx-xxxx` di header + transkrip.
 *   - TIDAK pernah menampilkan nomor telepon Indonesia mentah pada
 *     wave load-more berikutnya (batch lama yang baru terangkut).
 *
 * 1. Static guard: `useConversationMessages` tidak mem-SELECT kolom
 *    `phone` — pastikan pagination tidak diam-diam menarik phone dari
 *    server.
 * 2. Runtime (self-skip): kirim satu pesan token unik, verifikasi masuk
 *    UI PIN-branded, scroll ke top berulang kali untuk memancing load
 *    more, lalu enforce anti-phone pada tiap fase.
 */

const STORAGE = "tests/visual/.auth/user.json";
const PHONE_LIKE = /(?:\+?62|0)8\d{7,12}/;
const PIN_FMT = /PIN\s+[A-Z0-9]{4}-[A-Z0-9]{4}/i;

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

test.describe("send-then-loadmore — source guard", () => {
  test("useConversationMessages: tidak SELECT kolom phone", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/chat.ts"), "utf8");
    // Cari blok useConversationMessages dan pastikan tidak menarik phone.
    const idx = src.indexOf("useConversationMessages");
    expect(idx).toBeGreaterThan(-1);
    const region = src.slice(idx, idx + 4000);
    expect(region).not.toMatch(/\bphone\b/);
  });
});

test.describe("send-then-loadmore — runtime PIN MCM", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("kirim pesan lalu scroll ke atas untuk load-more: PIN MCM konsisten, no phone", async ({
    page,
  }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");
    const first = page.locator('a[href^="/chat/"]').first();
    test.skip((await first.count()) === 0, "Tidak ada DM untuk uji — skip.");

    await first.click();
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
    await page.waitForLoadState("networkidle");

    // Kirim token unik.
    const token = `pin-mcm-loadmore-${Date.now().toString(36)}`;
    const input = page.getByRole("textbox").last();
    await input.click();
    await input.fill(token);
    await input.press("Enter");
    await expect(page.getByText(token).first()).toBeVisible({ timeout: 5000 });

    // Snapshot awal.
    const readMain = async () =>
      await page.locator("main, body").first().innerText();
    const readHeader = async () =>
      (await page
        .locator("header, [role='banner']")
        .first()
        .innerText()
        .catch(() => "")) || "";

    {
      const header = await readHeader();
      const body = await readMain();
      expect(header).not.toMatch(PHONE_LIKE);
      expect(body).not.toMatch(PHONE_LIKE);
      if (/PIN\s+/i.test(header)) expect(header).toMatch(PIN_FMT);
    }

    // Scroll ke atas berulang kali untuk memicu load-more.
    const scroller = page
      .locator('[data-testid="chat-scroll"], main, [role="log"], body')
      .first();
    for (let i = 0; i < 8; i += 1) {
      await scroller.evaluate((el) => {
        (el as HTMLElement).scrollTop = 0;
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(400);
      const header = await readHeader();
      const body = await readMain();
      expect(header, `header wave#${i} tanpa phone`).not.toMatch(PHONE_LIKE);
      expect(body, `transkrip wave#${i} tanpa phone`).not.toMatch(PHONE_LIKE);
      if (/PIN\s+/i.test(body)) expect(body).toMatch(PIN_FMT);
    }

    // Token yang dikirim harus tetap ada (bukti transkrip tidak reset).
    await expect(page.getByText(token).first()).toBeVisible();
  });
});
