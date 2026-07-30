import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E — Deep link ke beberapa DM dengan `conversationId` berbeda:
 *   - `page.goto('/chat/<idA>')` → header & transkrip menampilkan
 *     `PIN xxxx-xxxx` peer A yang benar.
 *   - `page.goto('/chat/<idB>')` (langsung, TANPA lewat daftar) →
 *     identitas berganti ke peer B, tidak "menyangkut" milik peer A.
 *   - Ulangi ke `<idA>` lagi via deep link — identitas kembali ke peer A.
 *   - Tidak pernah ada nomor telepon Indonesia mentah muncul di header
 *     atau transkrip pada tiap kunjungan.
 *
 * 1. Static guard: `chat.$conversationId` mengunci identitas ke param
 *    route (`Route.useParams()`) sehingga ganti URL = re-derive peer,
 *    dan tidak pernah mem-fallback ke `.phone` sebagai teks tampilan.
 * 2. Runtime (self-skip): butuh minimal 2 DM di daftar untuk sumber id.
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

test.describe("deep link multi-DM — source guard", () => {
  test("chat.$conversationId: identitas terikat ke Route.useParams, tanpa fallback phone", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated.chat.$conversationId.tsx"),
      "utf8",
    );
    expect(src).toMatch(/Route\.useParams\(\)/);
    // Larangan fallback `phone` sebagai identitas tampilan.
    expect(src).not.toMatch(/\|\|\s*[a-zA-Z_.]*\.phone\b/);
    expect(src).not.toMatch(/\.phone\b\s*\?\?/);
  });
});

test.describe("deep link multi-DM — runtime PIN MCM per conversationId", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("goto(/chat/idA) → goto(/chat/idB) → goto(/chat/idA): identitas akurat, no phone", async ({
    page,
    context,
  }) => {
    // Panen dua id dari daftar sekali saja, lalu buka lewat deep link.
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");
    const links = page.locator('a[href^="/chat/"]');
    const total = await links.count();
    test.skip(total < 2, "Butuh minimal 2 DM untuk uji deep link multi — skip.");

    const hrefA = await links.nth(0).getAttribute("href");
    const hrefB = await links.nth(1).getAttribute("href");
    expect(hrefA).toMatch(/^\/chat\/[0-9a-f-]{36}$/);
    expect(hrefB).toMatch(/^\/chat\/[0-9a-f-]{36}$/);
    expect(hrefA).not.toBe(hrefB);

    // Pakai tab bersih supaya benar-benar deep link (bukan lanjutan state).
    const fresh = await context.newPage();
    try {
      const readHeaderLine = async () => {
        const raw =
          (await fresh
            .locator("header, [role='banner']")
            .first()
            .innerText()
            .catch(() => "")) || "";
        return raw
          .split(/\n+/)
          .map((s) => s.trim())
          .find((s) => s.length > 0) || "";
      };
      const readMain = async () => await fresh.locator("main, body").first().innerText();

      async function openDeepLink(href: string) {
        await fresh.goto(href, { waitUntil: "networkidle" });
        await expect(fresh).toHaveURL(new RegExp(`${href}$`));
        await fresh.waitForTimeout(500);
        const header = await readHeaderLine();
        const body = await readMain();
        expect(header, `header ${href} tanpa phone`).not.toMatch(PHONE_LIKE);
        expect(body, `transkrip ${href} tanpa phone`).not.toMatch(PHONE_LIKE);
        if (/PIN\s+/i.test(header)) expect(header).toMatch(PIN_FMT);
        if (/PIN\s+/i.test(body)) expect(body).toMatch(PIN_FMT);
        return { header, body };
      }

      const snapA1 = await openDeepLink(hrefA!);
      const snapB = await openDeepLink(hrefB!);
      const snapA2 = await openDeepLink(hrefA!);

      // Identitas per conversationId harus berbeda.
      expect(snapA1.header, "peer DM A ≠ peer DM B").not.toBe(snapB.header);
      // Deep link kembali ke A mengembalikan identitas asli.
      expect(snapA2.header).toBe(snapA1.header);
      expect(snapA2.header).not.toBe(snapB.header);
    } finally {
      await fresh.close();
    }
  });
});
