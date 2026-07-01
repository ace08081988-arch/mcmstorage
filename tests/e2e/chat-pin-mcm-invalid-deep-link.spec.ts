import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E — Deep link ke DM yang tidak ada / tidak berizin wajib:
 *   - Menampilkan banner "Percakapan tidak ditemukan" (role="alert",
 *     `data-testid="chat-not-found"`) dengan pesan yang aman.
 *   - Tidak menampilkan nomor telepon Indonesia mentah pada banner
 *     maupun body halaman.
 *   - Menyediakan CTA "Kembali ke daftar chat" ke `/chat`.
 *
 * 1. Static guard: route `_authenticated.chat.$conversationId` merender
 *    banner not-found saat `!meta.isPending && !meta.data`, tanpa
 *    menyentuh `.phone`.
 * 2. Runtime (self-skip): butuh sesi auth.
 */

const STORAGE = "tests/visual/.auth/user.json";
const PHONE_LIKE = /(?:\+?62|0)8\d{7,12}/;
const INVALID_ID = "00000000-0000-4000-8000-000000000000";

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

test.describe("deep link invalid — source guard", () => {
  test("chat.$conversationId: banner not-found aktif saat meta kosong, tanpa .phone", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated.chat.$conversationId.tsx"),
      "utf8",
    );
    expect(src).toMatch(/data-testid="chat-not-found"/);
    expect(src).toMatch(/!meta\.isPending\s*&&\s*!meta\.data/);
    expect(src).toMatch(/Percakapan tidak ditemukan/);
    // Banner block itself never references .phone.
    const bannerMatch = src.match(
      /data-testid="chat-not-found"[\s\S]*?Kembali ke daftar chat[\s\S]*?<\/Button>/,
    );
    expect(bannerMatch, "banner not-found harus ada").not.toBeNull();
    expect(bannerMatch![0]).not.toMatch(/\.phone\b/);
  });
});

test.describe("deep link invalid — runtime", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("/chat/<uuid-tak-berizin>: banner error tampil, tanpa nomor telp mentah, CTA balik ke /chat", async ({
    page,
  }) => {
    await page.goto(`/chat/${INVALID_ID}`, { waitUntil: "networkidle" });

    const banner = page.getByTestId("chat-not-found");
    await expect(banner, "banner not-found wajib tampil").toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText(/Percakapan tidak ditemukan/i);

    const bannerText = await banner.innerText();
    expect(bannerText, "banner bebas nomor telp mentah").not.toMatch(PHONE_LIKE);

    const bodyText = await page.locator("body").innerText();
    expect(bodyText, "body bebas nomor telp mentah").not.toMatch(PHONE_LIKE);

    await page.getByRole("button", { name: /Kembali ke daftar chat/i }).click();
    await expect(page).toHaveURL(/\/chat\/?$/);
  });
});
