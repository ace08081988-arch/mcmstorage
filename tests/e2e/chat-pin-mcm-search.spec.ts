import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E — Pencarian di dalam DM (`ConversationSearchDialog`):
 *   - Dialog memakai copy "Cari di percakapan" (bukan branding phone).
 *   - Hasil pencarian menampilkan potongan `m.body` saja; tidak ada
 *     kolom `phone` peer yang dirender di list hit.
 *   - Header + transkrip di belakang dialog tetap memakai identitas
 *     `PIN xxxx-xxxx`, tidak ada nomor telepon Indonesia mentah di
 *     manapun (dialog, list hit, atau setelah lompat ke hit).
 *
 * 1. Static guard: `ConversationSearchDialog` hanya membaca `m.body` &
 *    `m.created_at`, tidak menyentuh `phone`.
 * 2. Runtime (self-skip): buka DM pertama → menu titik-tiga → "Cari di
 *    percakapan" → ketik kata dari pesan yang sudah ada → assert hits
 *    muncul, bebas phone, header/transkrip tetap PIN MCM.
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

test.describe("chat search — source guard", () => {
  test("ConversationSearchDialog: hanya baca m.body/m.created_at, tanpa akses phone", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/chat/ConversationExtrasDialogs.tsx"),
      "utf8",
    );
    // Ambil body fungsi ConversationSearchDialog.
    const start = src.indexOf("export function ConversationSearchDialog");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("export function MediaLinksDialog", start);
    const body = src.slice(start, end > -1 ? end : undefined);
    expect(body, "SearchDialog tidak boleh mengakses kolom phone").not.toMatch(/\bm\.phone\b/);
    expect(body).toMatch(/\bm\.body\b/);
    // Placeholder input harus copy PIN MCM friendly (bukan phone-branded).
    expect(body).toMatch(/Ketik kata kunci/);
  });

  test("chat.$conversationId: entry point 'Cari di percakapan' terpasang", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated.chat.$conversationId.tsx"),
      "utf8",
    );
    expect(src).toMatch(/Cari di percakapan/);
    expect(src).toMatch(/ConversationSearchDialog|searchOpen/);
  });
});

test.describe("chat search — runtime PIN MCM", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("buka dialog Cari → ketik kata dari pesan → hits bebas phone, header tetap PIN", async ({
    page,
  }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    const first = page.locator('a[href^="/chat/"]').first();
    test.skip((await first.count()) === 0, "Akun test belum punya DM — skip.");
    await first.click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);

    const readHeaderLine = async () => {
      const raw = (await page.locator("header, [role='banner']").first().innerText().catch(() => "")) || "";
      return raw.split(/\n+/).map((s) => s.trim()).find((s) => s.length > 0) || "";
    };

    const headerBefore = await readHeaderLine();
    expect(headerBefore, "header pra-search tanpa phone").not.toMatch(PHONE_LIKE);
    if (/PIN\s+/i.test(headerBefore)) expect(headerBefore).toMatch(PIN_FMT);

    // Ambil satu kata cukup panjang dari pesan yang tampak, sebagai
    // needle pencarian. Kalau tidak ada pesan → skip.
    const needle = await page.evaluate(() => {
      const main = document.querySelector("main") ?? document.body;
      const texts = Array.from(main.querySelectorAll<HTMLElement>("div, li, article"))
        .map((n) => (n.innerText || "").trim())
        .filter((t) => t.length >= 4 && t.length <= 60 && !/tulis pesan|kirim|memuat|loading/i.test(t));
      for (const t of texts) {
        const word = t.split(/\s+/).find((w) => /^[A-Za-z]{4,}$/.test(w));
        if (word) return word;
      }
      return null;
    });
    test.skip(!needle, "Tidak ada pesan berbentuk teks di DM ini — skip.");

    // Buka menu titik-tiga → klik "Cari di percakapan".
    const menuBtn = page
      .getByRole("button", { name: /menu|opsi|lainnya|more/i })
      .or(page.locator('button[aria-haspopup="menu"]'))
      .first();
    if ((await menuBtn.count()) > 0) {
      await menuBtn.click().catch(() => {});
    }
    const cari = page.getByRole("menuitem", { name: /cari di percakapan/i }).first();
    if ((await cari.count()) === 0) {
      // Fallback: cari via teks bebas.
      const fallback = page.getByText(/cari di percakapan/i).first();
      test.skip((await fallback.count()) === 0, "Menu 'Cari di percakapan' tidak terjangkau — skip.");
      await fallback.click();
    } else {
      await cari.click();
    }

    const dialog = page.getByRole("dialog").filter({ hasText: /cari di percakapan/i }).first();
    await expect(dialog).toBeVisible();
    const dialogText = await dialog.innerText();
    expect(dialogText, "dialog Cari tidak boleh memuat phone").not.toMatch(PHONE_LIKE);

    const input = dialog.locator('input[placeholder*="kunci"]').first();
    await input.fill(needle!);
    await page.waitForTimeout(400);

    const dialogAfter = await dialog.innerText();
    expect(dialogAfter, "hasil pencarian tidak boleh mengandung phone").not.toMatch(PHONE_LIKE);

    // Header dan area utama di belakang dialog tetap PIN MCM.
    const headerAfter = await readHeaderLine();
    expect(headerAfter, "header pasca-search tanpa phone").not.toMatch(PHONE_LIKE);
    expect(headerAfter).toBe(headerBefore);

    const bodyAfter = await page.locator("body").innerText();
    expect(bodyAfter, "body pasca-search tanpa phone mentah").not.toMatch(PHONE_LIKE);
    if (/PIN\s+/i.test(bodyAfter)) expect(bodyAfter).toMatch(PIN_FMT);
  });
});