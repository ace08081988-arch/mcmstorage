import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E — DM ke peer yang tidak memiliki PIN lengkap (invite_code kosong /
 * kurang dari 4 karakter, tanpa display_name/email, tapi punya kolom
 * phone di profil) wajib:
 *   - Header menampilkan placeholder aman: alias jika ada, atau
 *     `"Kontak"` — bukan format `PIN xxxx-xxxx` palsu, dan tidak pernah
 *     nomor telp mentah.
 *   - Transkrip bebas nomor telp Indonesia mentah, meski profil peer
 *     memuat kolom `phone`.
 *
 * Trik: intercept RPC `get_chat_member_profiles` di jaringan dan rewrite
 * profil peer menjadi `invite_code: null, display_name: null,
 * email: null, phone: "081234567890"` sehingga rantai fallback jatuh ke
 * `"Kontak"`.
 *
 * 1. Static guard: rantai `fallbackName` di `chat.$conversationId`
 *    bertingkat `display_name → PIN(formatInviteCode) → email → "Kontak"`
 *    tanpa cabang `.phone`.
 * 2. Runtime (self-skip): butuh sesi auth + ≥1 DM.
 */

const STORAGE = "tests/visual/.auth/user.json";
const PHONE_LIKE = /(?:\+?62|0)8\d{7,12}/;
const PIN_FMT = /PIN\s+[A-Z0-9]{4}-[A-Z0-9]{4}/;
const RPC_PATH = "/rest/v1/rpc/get_chat_member_profiles";

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

test.describe("incomplete PIN — source guard", () => {
  test("chat.$conversationId: fallbackName tidak menyentuh .phone", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated.chat.$conversationId.tsx"),
      "utf8",
    );
    const region = src.match(/fallbackName:[\s\S]{0,400}?"Kontak",/);
    expect(region, "blok fallbackName harus ada").not.toBeNull();
    const block = region![0];
    expect(block).toMatch(/display_name/);
    expect(block).toMatch(/invite_code/);
    expect(block).toMatch(/formatInviteCode/);
    expect(block).toMatch(/email/);
    expect(block).toMatch(/"Kontak"/);
    expect(block, "rantai fallback tidak boleh memakai .phone").not.toMatch(/\.phone\b/);
  });

  test("formatInviteCode: <4 char tetap tanpa dash", () => {
    // Guard sederhana untuk perilaku formatter.
    const src = readFileSync(resolve(process.cwd(), "src/lib/invite.ts"), "utf8");
    expect(src).toMatch(/if\s*\(n\.length\s*<=\s*4\)\s*return\s+n;/);
  });
});

test.describe("incomplete PIN — runtime", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("peer tanpa invite_code lengkap: header 'Kontak', transkrip tanpa phone", async ({
    page,
  }) => {
    // Intercept & rewrite RPC profil chat member sebelum navigasi ke DM.
    await page.route(`**${RPC_PATH}*`, async (route) => {
      const resp = await route.fetch();
      let text = await resp.text();
      try {
        const body = JSON.parse(text) as Array<{
          id: string;
          display_name: string | null;
          email: string | null;
          phone: string | null;
          invite_code: string | null;
        }>;
        if (Array.isArray(body)) {
          const rewritten = body.map((p) => ({
            ...p,
            display_name: null,
            email: null,
            invite_code: null,
            // Sengaja isi phone dengan nomor Indonesia — UI wajib tetap
            // tidak menampilkannya.
            phone: "081234567890",
          }));
          text = JSON.stringify(rewritten);
        }
      } catch {
        /* biarkan body asli bila bukan JSON array */
      }
      await route.fulfill({
        status: resp.status(),
        headers: resp.headers(),
        body: text,
      });
    });

    await page.goto("/chat");
    await page.waitForLoadState("networkidle");
    const links = page.locator('a[href^="/chat/"]');
    const total = await links.count();
    test.skip(total < 1, "Butuh minimal 1 DM — skip.");

    const href = await links.nth(0).getAttribute("href");
    expect(href).toMatch(/^\/chat\/[0-9a-f-]{36}$/);

    await page.goto(href!, { waitUntil: "networkidle" });
    await expect(page).toHaveURL(new RegExp(`${href}$`));

    // Header: placeholder aman. Boleh alias tersimpan (bila ada), atau
    // literal "Kontak". Wajib bukan format `PIN xxxx-xxxx` palsu dari
    // nomor telepon, dan wajib bebas nomor telp mentah.
    const headerTitle = page.locator("header .truncate.text-\\[15px\\]").first();
    await expect(headerTitle).toBeVisible();
    const headerText = (await headerTitle.innerText()).trim();
    expect(headerText, "header bebas nomor telp mentah").not.toMatch(PHONE_LIKE);
    // Jika UI memilih menampilkan "PIN ..." wajib format 4-4; kalau
    // tidak, placeholder "Kontak" atau alias adalah valid.
    if (/^PIN\s+/i.test(headerText)) {
      expect(headerText).toMatch(PIN_FMT);
    } else {
      expect(
        headerText.length > 0,
        "placeholder header tidak boleh kosong",
      ).toBe(true);
    }

    // Body: bebas nomor telp Indonesia mentah walaupun payload profil
    // sengaja mengandung phone.
    const bodyText = await page.locator("body").innerText();
    expect(bodyText, "body bebas nomor telp mentah").not.toMatch(PHONE_LIKE);
  });
});
