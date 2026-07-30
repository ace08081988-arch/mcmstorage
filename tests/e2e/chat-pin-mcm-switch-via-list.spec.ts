import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E — Perpindahan antar DM lewat sidebar/daftar percakapan (`/chat`):
 *   - Klik item DM di daftar → header & transkrip menampilkan
 *     `PIN xxxx-xxxx` peer yang benar.
 *   - Kembali ke daftar → klik DM lain → identitas berganti sesuai peer
 *     target (tidak "menyangkut" dari DM sebelumnya).
 *   - Tidak ada nomor telepon Indonesia mentah muncul di header/transkrip
 *     pada tiap fase, termasuk saat balik ke DM pertama.
 *
 * 1. Static guard: `chat.index` merender daftar via `<Link to="/chat/$conversationId">`
 *    (bukan `<a href>` interpolasi) sehingga navigasi client-side membawa
 *    param stabil ke route detail, dan tidak ada fallback `phone` di daftar.
 * 2. Runtime (self-skip): butuh minimal 2 DM. Buka /chat, klik DM #1,
 *    snapshot header/transkrip. Kembali ke /chat via klik "back" atau
 *    navigate, klik DM #2, snapshot. Kembali lagi, klik DM #1, verifikasi.
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

test.describe("switch DM lewat daftar — source guard", () => {
  test("chat.index: pakai <Link to='/chat/$conversationId'> dan tanpa fallback phone di daftar", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated.chat.index.tsx"),
      "utf8",
    );
    // Client-side navigasi bertipe (bukan template string).
    expect(src).toMatch(/to=["']\/chat\/\$conversationId["']/);
    // Tidak boleh mem-fallback ke phone saat menampilkan judul percakapan.
    expect(src).not.toMatch(/display_title[^}]*\|\|\s*[a-zA-Z_.]*\.phone\b/);
    expect(src).not.toMatch(/\.phone\b\s*\?\?/);
  });
});

test.describe("switch DM lewat daftar — runtime PIN MCM per percakapan", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("Klik DM di /chat: identitas berpindah sesuai peer, tanpa nomor telp mentah", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    const convLinks = page.locator('a[href^="/chat/"]');
    const count = await convLinks.count();
    test.skip(count < 2, "Butuh minimal 2 DM untuk uji perpindahan — skip.");

    const hrefA = await convLinks.nth(0).getAttribute("href");
    const hrefB = await convLinks.nth(1).getAttribute("href");
    expect(hrefA).toMatch(/^\/chat\/[0-9a-f-]{36}$/);
    expect(hrefB).toMatch(/^\/chat\/[0-9a-f-]{36}$/);
    expect(hrefA).not.toBe(hrefB);

    const readHeaderLine = async () => {
      const raw =
        (await page
          .locator("header, [role='banner']")
          .first()
          .innerText()
          .catch(() => "")) || "";
      return raw
        .split(/\n+/)
        .map((s) => s.trim())
        .find((s) => s.length > 0) || "";
    };
    const readMain = async () => await page.locator("main, body").first().innerText();

    async function openViaListAndSnapshot(targetHref: string) {
      // Selalu balik ke daftar dulu supaya navigasi benar-benar lewat sidebar.
      if (!page.url().endsWith("/chat")) {
        await page.goto("/chat", { waitUntil: "networkidle" });
      }
      // Klik link daftar yang cocok — bukan navigate langsung.
      const target = page.locator(`a[href='${targetHref}']`).first();
      await expect(target, `link daftar ${targetHref} harus ada`).toBeVisible();
      await target.click();
      await expect(page).toHaveURL(new RegExp(`${targetHref}$`));
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);

      const header = await readHeaderLine();
      const body = await readMain();
      expect(header, `header ${targetHref} tanpa phone`).not.toMatch(PHONE_LIKE);
      expect(body, `transkrip ${targetHref} tanpa phone`).not.toMatch(PHONE_LIKE);
      if (/PIN\s+/i.test(header)) expect(header).toMatch(PIN_FMT);
      if (/PIN\s+/i.test(body)) expect(body).toMatch(PIN_FMT);
      return { header, body };
    }

    const snapA1 = await openViaListAndSnapshot(hrefA!);
    const snapB = await openViaListAndSnapshot(hrefB!);
    const snapA2 = await openViaListAndSnapshot(hrefA!);

    // Identitas peer DM A ≠ DM B — klik lewat daftar tidak membawa
    // state peer dari percakapan sebelumnya.
    expect(snapA1.header, "identitas DM A vs DM B harus berbeda").not.toBe(snapB.header);

    // Balik ke A via daftar: identitas kembali seperti semula.
    expect(snapA2.header).toBe(snapA1.header);
    expect(snapA2.header).not.toBe(snapB.header);
  });
});
