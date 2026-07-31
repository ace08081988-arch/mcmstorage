import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E — Fuzz PIN MCM lintas beberapa percakapan acak: untuk setiap DM
 * yang terpilih (hingga 5 acak) header dan transkrip wajib:
 *   - Bebas nomor telepon Indonesia mentah pada fase awal, setelah
 *     reload, dan setelah scroll load-more.
 *   - Jika string "PIN " muncul di header/transkrip, wajib berformat
 *     `PIN xxxx-xxxx` (4-4, alfanumerik uppercase).
 *   - Identitas peer di header berbeda antar konvo yang berbeda.
 *
 * 1. Static guard: `chat.$conversationId` mengunci identitas ke
 *    `Route.useParams()` tanpa fallback `.phone`, dan
 *    `useConversationMessages` di `src/lib/chat.ts` tidak SELECT kolom
 *    `phone`.
 * 2. Runtime (self-skip): butuh ≥1 DM.
 */

const STORAGE = "tests/visual/.auth/user.json";
const PHONE_LIKE = /(?:\+?62|0)8\d{7,12}/;
const PIN_FMT = /PIN\s+[A-Z0-9]{4}-[A-Z0-9]{4}/;
const PIN_ANY = /PIN\s+\S+/;

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

test.describe("fuzz PIN MCM lintas DM acak — source guards", () => {
  test("chat.$conversationId: identitas terikat Route.useParams, tanpa fallback .phone", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated.chat.$conversationId.tsx"),
      "utf8",
    );
    expect(src).toMatch(/Route\.useParams\(\)/);
    expect(src).not.toMatch(/\|\|\s*[a-zA-Z_.]*\.phone\b/);
    expect(src).not.toMatch(/\.phone\s*\?\?/);
  });

  test("useConversationMessages: tidak SELECT kolom phone dari tabel messages", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/chat.ts"), "utf8");
    const fnMatch = src.match(/useConversationMessages[\s\S]{0,4000}/);
    expect(fnMatch, "useConversationMessages harus ada").not.toBeNull();
    const region = fnMatch![0];
    expect(region).not.toMatch(/\bselect\([^)]*\bphone\b/i);
  });
});

test.describe("fuzz PIN MCM lintas DM acak — runtime", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("hingga 5 DM acak: header + transkrip PIN xxxx-xxxx, tanpa nomor telp mentah, identitas unik per konvo", async ({
    page,
  }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");
    const links = page.locator('a[href^="/chat/"]');
    const total = await links.count();
    test.skip(total < 1, "Butuh minimal 1 DM — skip.");

    // Kumpulkan href unik, lalu ambil hingga 5 acak deterministik-per-run.
    const allHrefs = (
      await Promise.all(
        Array.from({ length: total }, (_, i) => links.nth(i).getAttribute("href")),
      )
    ).filter((h): h is string => !!h && /^\/chat\/[0-9a-f-]{36}$/.test(h));
    const unique = Array.from(new Set(allHrefs));
    // Shuffle sederhana.
    for (let i = unique.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unique[i], unique[j]] = [unique[j], unique[i]];
    }
    const sample = unique.slice(0, Math.min(5, unique.length));
    expect(sample.length, "sample DM tidak boleh kosong").toBeGreaterThan(0);

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
      const header = await readHeader();
      const body = await readBody();
      expect(body, `${phase} body: no phone`).not.toMatch(PHONE_LIKE);
      expect(header, `${phase} header: no phone`).not.toMatch(PHONE_LIKE);
      if (PIN_ANY.test(header)) {
        expect(header, `${phase} header: PIN wajib berformat xxxx-xxxx`).toMatch(PIN_FMT);
      }
      if (PIN_ANY.test(body)) {
        // Ambil semua kandidat "PIN <token>" dari body; setiap token wajib xxxx-xxxx.
        const tokens = body.match(/PIN\s+[^\s\n]+/g) ?? [];
        for (const t of tokens) {
          expect(t, `${phase} body: token PIN wajib xxxx-xxxx (dapat: "${t}")`).toMatch(
            PIN_FMT,
          );
        }
      }
      return header;
    }

    const seenHeaders: string[] = [];
    for (const href of sample) {
      await page.goto(href, { waitUntil: "networkidle" });
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      const h1 = await assertClean(`DM ${href} awal`);

      await page.reload({ waitUntil: "networkidle" });
      const h2 = await assertClean(`DM ${href} reload`);
      expect(h2, `identitas persist setelah reload untuk ${href}`).toBe(h1);

      // Coba pancing load-more via scroll ke atas beberapa kali.
      const scroller = page.locator("main, [data-testid='chat-scroller'], body").first();
      for (let i = 0; i < 4; i++) {
        await scroller.evaluate((el) => {
          el.scrollTop = 0;
        });
        await page.waitForTimeout(150);
      }
      await assertClean(`DM ${href} load-more`);

      seenHeaders.push(h1);
    }

    // Identitas antar konvo unik (kecuali ada duplikat href, yg sudah difilter).
    const uniqueHeaders = new Set(seenHeaders.filter((h) => h.length > 0));
    expect(
      uniqueHeaders.size,
      "identitas header wajib unik antar konvo berbeda",
    ).toBe(seenHeaders.filter((h) => h.length > 0).length);
  });
});
