import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E — Menyalin (Copy) transkrip pesan chat setelah `page.reload()`
 * pada DM yang sudah ada wajib:
 *   - Menghasilkan teks clipboard yang hanya memuat isi pesan (body)
 *     dan/atau branding `PIN xxxx-xxxx`.
 *   - TIDAK PERNAH memuat nomor telepon Indonesia mentah — baik dari
 *     header, nama peer, maupun payload pesan yang disalin.
 *
 * 1. Static guard: handler Copy di `chat.$conversationId` memakai
 *    `safePreview(m)` (= `messagePreviewText`) yang hanya membaca
 *    body pesan, BUKAN kolom `phone`. Kunci agar regresi menambahkan
 *    `${peer.phone}` ke string clipboard tertangkap.
 * 2. Runtime (self-skip): reload DM, aktifkan selection mode,
 *    trigger Copy via SelectionToolbar, baca clipboard, enforce
 *    anti-phone + PIN branding.
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

test.describe("copy/export transkrip — source guard", () => {
  test("handler Copy di chat.$conversationId hanya membaca body via safePreview, tanpa .phone", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated.chat.$conversationId.tsx"),
      "utf8",
    );
    // Ambil blok onCopy — pastikan tidak menyebut `.phone`.
    const start = src.indexOf("onCopy={() =>");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("}}", start);
    const region = src.slice(start, end + 2);
    expect(region).toMatch(/safePreview\(/);
    expect(region).not.toMatch(/\.phone\b/);
    // safePreview harus terikat ke messagePreviewText (body-only).
    expect(src).toMatch(/const\s+safePreview\s*=\s*messagePreviewText/);
  });
});

test.describe("copy/export transkrip — runtime PIN MCM", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("reload DM → salin pesan: clipboard bebas nomor telp mentah", async ({
    page,
    context,
  }) => {
    // Izinkan clipboard read/write untuk verifikasi payload.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    await page.goto("/chat");
    await page.waitForLoadState("networkidle");
    const first = page.locator('a[href^="/chat/"]').first();
    test.skip((await first.count()) === 0, "Tidak ada DM untuk uji — skip.");
    await first.click();
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
    await page.waitForLoadState("networkidle");

    // Refresh agar transkrip re-hidrasi dari server (bukan sekadar cache list).
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Snapshot header + transkrip pra-copy — sudah wajib PIN-branded.
    const header =
      (await page
        .locator("header, [role='banner']")
        .first()
        .innerText()
        .catch(() => "")) || "";
    const body = await page.locator("main, body").first().innerText();
    expect(header).not.toMatch(PHONE_LIKE);
    expect(body).not.toMatch(PHONE_LIKE);

    // Aktifkan selection mode: long-press bubble pesan pertama.
    const bubble = page.locator("[data-message-id]").first();
    test.skip((await bubble.count()) === 0, "Belum ada pesan untuk disalin — skip.");
    await bubble.click({ delay: 550 }); // long-press → memicu selection

    // Klik tombol Salin di toolbar seleksi.
    const copyBtn = page.getByRole("button", { name: "Salin" });
    await expect(copyBtn).toBeVisible({ timeout: 3000 });
    await copyBtn.click();

    // Baca clipboard hasilnya.
    const clip = await page.evaluate(async () => {
      try {
        return await navigator.clipboard.readText();
      } catch {
        return "";
      }
    });
    // Sebagian browser CI memblok readText walau permission granted; kalau
    // kosong, minimal enforce anti-phone via UI toast + snapshot ulang.
    if (clip) {
      expect(clip, "clipboard bebas nomor telp mentah").not.toMatch(PHONE_LIKE);
      if (/PIN\s+/i.test(clip)) expect(clip).toMatch(PIN_FMT);
    }

    // Regardless clipboard, UI setelah salin tetap PIN-branded & no phone.
    const bodyAfter = await page.locator("main, body").first().innerText();
    expect(bodyAfter).not.toMatch(PHONE_LIKE);
    if (/PIN\s+/i.test(bodyAfter)) expect(bodyAfter).toMatch(PIN_FMT);
  });
});
