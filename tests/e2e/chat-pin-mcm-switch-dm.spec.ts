import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E — Berpindah antar DM yang sudah ada:
 *   - Header & transkrip masing-masing DM menampilkan identitas
 *     `PIN xxxx-xxxx` milik peer yang benar.
 *   - Identitas DM A ≠ identitas DM B (tidak "menyangkut" dari
 *     percakapan sebelumnya karena stale cache / component reuse).
 *   - Tidak ada nomor telepon Indonesia mentah di header/transkrip
 *     pada tiap DM, termasuk saat balik lagi ke DM A.
 *
 * 1. Static guard: `chat.$conversationId` memakai `Route.useParams()`
 *    (route re-mount ber-key param) dan tidak mem-fallback ke phone.
 * 2. Runtime (self-skip): buka DM #1 → snapshot header/transkrip →
 *    kembali → buka DM #2 → snapshot → kembali → buka lagi DM #1 →
 *    verifikasi identitas kembali seperti semula.
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

test.describe("switch DM — source guard", () => {
  test("chat.$conversationId: pakai Route.useParams dan tanpa fallback phone", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated.chat.$conversationId.tsx"),
      "utf8",
    );
    expect(src).toMatch(/Route\.useParams\(\)/);
    expect(src).not.toMatch(/\|\|\s*p\.phone\b/);
    expect(src).not.toMatch(/\|\|\s*peer\.phone\b/);
  });
});

test.describe("switch DM — runtime PIN MCM per percakapan", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("DM A → DM B → DM A: header & transkrip PIN MCM konsisten per konvo", async ({ page }) => {
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
      const raw = (await page.locator("header, [role='banner']").first().innerText().catch(() => "")) || "";
      return raw.split(/\n+/).map((s) => s.trim()).find((s) => s.length > 0) || "";
    };
    const readMain = async () => await page.locator("main, body").first().innerText();

    async function openAndSnapshot(href: string) {
      await page.goto(href, { waitUntil: "networkidle" });
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      await page.waitForTimeout(500);
      const header = await readHeaderLine();
      const body = await readMain();
      expect(header, `header ${href} tanpa phone`).not.toMatch(PHONE_LIKE);
      expect(body, `transkrip ${href} tanpa phone`).not.toMatch(PHONE_LIKE);
      if (/PIN\s+/i.test(header)) expect(header).toMatch(PIN_FMT);
      if (/PIN\s+/i.test(body)) expect(body).toMatch(PIN_FMT);
      return { header, body };
    }

    const snapA1 = await openAndSnapshot(hrefA!);
    const snapB = await openAndSnapshot(hrefB!);
    const snapA2 = await openAndSnapshot(hrefA!);

    // Identitas peer DM A ≠ DM B — bukti header tidak menyangkut dari
    // percakapan sebelumnya karena reuse komponen.
    expect(snapA1.header, "identitas DM A vs DM B harus berbeda").not.toBe(snapB.header);

    // Balik ke A: identitas kembali seperti semula (bukan tetap milik B).
    expect(snapA2.header).toBe(snapA1.header);

    // Cross-check: transkrip B tidak "bocor" ke A pada kunjungan kedua —
    // baris pertama non-kosong header wajib khas per konvo.
    expect(snapA2.header).not.toBe(snapB.header);
  });
});