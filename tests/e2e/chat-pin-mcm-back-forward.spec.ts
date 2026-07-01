import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E — Navigasi browser back/forward antar DM eksisting wajib:
 *   - `goBack()` dari DM B ke DM A → header & transkrip kembali ke
 *     identitas peer A (`PIN xxxx-xxxx`) yang benar.
 *   - `goForward()` kembali ke DM B → identitas peer B yang benar.
 *   - Tidak ada nomor telepon Indonesia mentah pada fase pra-nav, nav
 *     mundur, maupun nav maju.
 *
 * 1. Static guard: `chat.$conversationId` mengunci identitas ke
 *    `Route.useParams()` — history pop akan me-render ulang komponen
 *    dengan param baru, bukan menyisakan state peer sebelumnya.
 * 2. Runtime (self-skip): butuh minimal 2 DM.
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

test.describe("back/forward antar DM — source guard", () => {
  test("chat.$conversationId: identitas terikat Route.useParams(), tanpa fallback phone", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated.chat.$conversationId.tsx"),
      "utf8",
    );
    expect(src).toMatch(/Route\.useParams\(\)/);
    expect(src).not.toMatch(/\|\|\s*[a-zA-Z_.]*\.phone\b/);
    expect(src).not.toMatch(/\.phone\s*\?\?/);
  });
});

test.describe("back/forward antar DM — runtime PIN MCM", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("DM A → DM B → back (A) → forward (B): header/transkrip akurat per konvo, no phone", async ({
    page,
  }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");
    const links = page.locator('a[href^="/chat/"]');
    const total = await links.count();
    test.skip(total < 2, "Butuh minimal 2 DM — skip.");

    const hrefA = await links.nth(0).getAttribute("href");
    const hrefB = await links.nth(1).getAttribute("href");
    expect(hrefA).toMatch(/^\/chat\/[0-9a-f-]{36}$/);
    expect(hrefB).toMatch(/^\/chat\/[0-9a-f-]{36}$/);
    expect(hrefA).not.toBe(hrefB);

    const readHeader = async () => {
      const raw =
        (await page
          .locator("header, [role='banner']")
          .first()
          .innerText()
          .catch(() => "")) || "";
      return (
        raw
          .split(/\n+/)
          .map((s) => s.trim())
          .find((s) => s.length > 0) || ""
      );
    };
    const readBody = async () => await page.locator("main, body").first().innerText();

    async function assertClean(phase: string) {
      const h = await readHeader();
      const b = await readBody();
      expect(h, `${phase} header tanpa phone`).not.toMatch(PHONE_LIKE);
      expect(b, `${phase} transkrip tanpa phone`).not.toMatch(PHONE_LIKE);
      if (/PIN\s+/i.test(h)) expect(h).toMatch(PIN_FMT);
      if (/PIN\s+/i.test(b)) expect(b).toMatch(PIN_FMT);
      return h;
    }

    // Nav DM A → DM B (in-app), lalu goBack / goForward via history API.
    await links.nth(0).click();
    await expect(page).toHaveURL(new RegExp(`${hrefA}$`));
    await page.waitForLoadState("networkidle");
    const headerA1 = await assertClean("DM A (initial)");

    // Balik ke daftar, lalu buka DM B agar history stack: /chat → A → /chat → B.
    // Untuk memastikan back/forward antar DM, buka B lewat `page.goto(hrefB)`
    // sehingga stack: /chat → A → B. Kemudian back → A, forward → B.
    await page.goto(hrefB!, { waitUntil: "networkidle" });
    await expect(page).toHaveURL(new RegExp(`${hrefB}$`));
    const headerB1 = await assertClean("DM B (initial)");
    expect(headerB1, "identitas B ≠ A").not.toBe(headerA1);

    await page.goBack({ waitUntil: "networkidle" });
    await expect(page).toHaveURL(new RegExp(`${hrefA}$`));
    const headerA2 = await assertClean("back → DM A");
    expect(headerA2, "back mengembalikan identitas A").toBe(headerA1);
    expect(headerA2, "identitas A ≠ B setelah back").not.toBe(headerB1);

    await page.goForward({ waitUntil: "networkidle" });
    await expect(page).toHaveURL(new RegExp(`${hrefB}$`));
    const headerB2 = await assertClean("forward → DM B");
    expect(headerB2, "forward mengembalikan identitas B").toBe(headerB1);
    expect(headerB2, "identitas B ≠ A setelah forward").not.toBe(headerA2);
  });
});
