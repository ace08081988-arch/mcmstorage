import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { assertChatBrandingClean } from "./_helpers/chat-pin-assertions";

/**
 * E2E — kombinasi back/forward + reload antar DM eksisting.
 *
 * Berbeda dari `chat-pin-mcm-back-forward.spec.ts` (yang hanya menguji
 * back/forward tanpa refresh), suite ini men-`reload()` di setiap
 * checkpoint history: pra-nav DM A, DM B, setelah back ke A, dan
 * setelah forward ke B. Tujuannya membuktikan bahwa rehidrasi cache
 * TanStack Query + parsing `Route.useParams()` menghasilkan identitas
 * peer yang sama di setiap posisi history — tidak "menyangkut" ke DM
 * sebelumnya, tidak fallback ke nomor telepon Indonesia mentah, dan
 * setiap token `PIN …` tetap berformat `PIN xxxx-xxxx`.
 *
 * Kontrak per fase divalidasi lewat helper terpusat
 * (`_helpers/chat-pin-assertions.ts`) supaya regex PIN/HP konsisten
 * dengan seluruh suite `chat-pin-mcm-*`.
 */

const STORAGE = "tests/visual/.auth/user.json";

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

test.describe("back/forward + reload antar DM — PIN MCM tetap konsisten", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("DM A → reload → DM B → reload → back+reload → forward+reload: identitas per konvo stabil, no phone", async ({
    page,
  }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    const links = page.locator('a[href^="/chat/"]');
    const total = await links.count();
    test.skip(total < 2, "Butuh minimal 2 DM eksisting — skip.");

    const hrefA = await links.nth(0).getAttribute("href");
    const hrefB = await links.nth(1).getAttribute("href");
    expect(hrefA, "hrefA UUID").toMatch(/^\/chat\/[0-9a-f-]{36}$/);
    expect(hrefB, "hrefB UUID").toMatch(/^\/chat\/[0-9a-f-]{36}$/);
    expect(hrefA).not.toBe(hrefB);

    // ── Fase 1: buka DM A (in-app click), verifikasi, reload, verifikasi.
    await links.nth(0).click();
    await expect(page).toHaveURL(new RegExp(`${hrefA}$`));
    await page.waitForLoadState("networkidle");
    const a1 = await assertChatBrandingClean(page, "A initial");
    expect(a1.header.length, "identitas A tidak kosong").toBeGreaterThan(0);

    await page.reload();
    await page.waitForLoadState("networkidle");
    const a1r = await assertChatBrandingClean(page, "A initial + reload");
    expect(a1r.header, "identitas A persist antar reload awal").toBe(a1.header);

    // ── Fase 2: navigasi ke DM B via URL supaya history: /chat → A → B.
    //   reload di B → identitas B tidak boleh menjadi identitas A.
    await page.goto(hrefB!, { waitUntil: "networkidle" });
    await expect(page).toHaveURL(new RegExp(`${hrefB}$`));
    const b1 = await assertChatBrandingClean(page, "B initial");
    expect(b1.header, "identitas B ≠ A").not.toBe(a1.header);

    await page.reload();
    await page.waitForLoadState("networkidle");
    const b1r = await assertChatBrandingClean(page, "B initial + reload");
    expect(b1r.header, "identitas B persist antar reload").toBe(b1.header);
    expect(b1r.header, "reload B tidak flip ke A").not.toBe(a1.header);

    // ── Fase 3: back ke A + reload — history pop harus mengembalikan
    //   identitas A yang sama persis dengan Fase 1, bahkan setelah
    //   pageload penuh.
    await page.goBack({ waitUntil: "networkidle" });
    await expect(page).toHaveURL(new RegExp(`${hrefA}$`));
    const a2 = await assertChatBrandingClean(page, "back → A");
    expect(a2.header, "back mengembalikan identitas A").toBe(a1.header);

    await page.reload();
    await page.waitForLoadState("networkidle");
    const a2r = await assertChatBrandingClean(page, "back → A + reload");
    expect(a2r.header, "A persist setelah back + reload").toBe(a1.header);
    expect(a2r.header, "A tidak flip ke B setelah reload").not.toBe(b1.header);

    // ── Fase 4: forward ke B + reload — history maju harus me-mount
    //   ulang komponen dengan param B, dan reload tetap mempertahankan.
    await page.goForward({ waitUntil: "networkidle" });
    await expect(page).toHaveURL(new RegExp(`${hrefB}$`));
    const b2 = await assertChatBrandingClean(page, "forward → B");
    expect(b2.header, "forward mengembalikan identitas B").toBe(b1.header);

    await page.reload();
    await page.waitForLoadState("networkidle");
    const b2r = await assertChatBrandingClean(page, "forward → B + reload");
    expect(b2r.header, "B persist setelah forward + reload").toBe(b1.header);
    expect(b2r.header, "B tidak flip ke A setelah reload").not.toBe(a1.header);
  });
});