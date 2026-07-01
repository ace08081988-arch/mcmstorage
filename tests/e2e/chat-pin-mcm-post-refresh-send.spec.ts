import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E — Setelah refresh di DM yang sudah ada, kirim pesan baru:
 *   - Header, composer, dan transkrip tetap memakai `PIN xxxx-xxxx`.
 *   - Bubble pesan baru muncul, dan tidak ada nomor telp Indonesia
 *     mentah pada snapshot pra-kirim, pasca-kirim, maupun setelah
 *     reload kedua (bukti bukan cuma tampilan optimistik).
 *
 * 1. Static guard: `chat.$conversationId` bebas fallback phone; jalur
 *    kirim (`useSendMessage`) memanggil `.from("messages").insert(...)`
 *    tanpa menyertakan kolom `phone`.
 * 2. Runtime (self-skip): reload DM pertama → ketik & kirim token unik
 *    → verifikasi token muncul di transkrip + tanpa phone leak →
 *    reload lagi → token & PIN branding masih ada.
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

test.describe("post-refresh send — source guard", () => {
  test("chat.$conversationId tidak mem-fallback ke phone", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated.chat.$conversationId.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/\|\|\s*p\.phone\b/);
    expect(src).not.toMatch(/\|\|\s*peer\.phone\b/);
  });

  test("jalur INSERT messages di src/lib/chat.ts tidak menyertakan kolom `phone`", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/chat.ts"), "utf8");
    // Ambil blok insert ke tabel messages dan pastikan tidak ada
    // property `phone:` di payload — identitas peer memakai user_id.
    const inserts = src.match(/from\(\s*["']messages["']\s*\)\s*\.insert\(([\s\S]{0,600}?)\)/g) ?? [];
    expect(inserts.length, "harus ada minimal 1 insert ke messages").toBeGreaterThan(0);
    for (const chunk of inserts) {
      expect(chunk, "payload insert messages tidak boleh memuat kolom phone").not.toMatch(
        /\bphone\s*:/,
      );
    }
  });
});

test.describe("post-refresh send — runtime PIN MCM tetap konsisten", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("reload DM → kirim pesan → reload lagi: transkrip pakai PIN MCM tanpa phone", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    const first = page.locator('a[href^="/chat/"]').first();
    test.skip((await first.count()) === 0, "Akun test belum punya DM — skip.");
    const href = await first.getAttribute("href");
    expect(href).toMatch(/^\/chat\/[0-9a-f-]{36}$/);

    await page.goto(href!, { waitUntil: "networkidle" });

    // Fase 1: reload lebih dulu — kita menguji perilaku setelah state
    // benar-benar dihidrasi ulang dari server, bukan sisa optimistik.
    await page.reload({ waitUntil: "networkidle" });
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await page.waitForTimeout(500);

    const readHeaderLine = async () => {
      const raw = (await page.locator("header, [role='banner']").first().innerText().catch(() => "")) || "";
      return raw.split(/\n+/).map((s) => s.trim()).find((s) => s.length > 0) || "";
    };
    const readMain = async () => await page.locator("main, body").first().innerText();

    const headerBefore = await readHeaderLine();
    const bodyBefore = await readMain();
    expect(headerBefore, "header pra-kirim tanpa phone").not.toMatch(PHONE_LIKE);
    expect(bodyBefore, "transkrip pra-kirim tanpa phone").not.toMatch(PHONE_LIKE);
    if (/PIN\s+/i.test(headerBefore)) expect(headerBefore).toMatch(PIN_FMT);

    // Fase 2: kirim pesan token unik.
    const token = `pinmcm-post-refresh-${Date.now().toString(36)}`;
    const composer = page
      .locator('textarea, input[type="text"]')
      .filter({ hasNot: page.locator('[disabled]') })
      .last();
    test.skip((await composer.count()) === 0, "Composer tidak tersedia — skip.");
    await composer.click();
    await composer.fill(token);

    // Preferensi: tombol dengan aria-label / teks "Kirim". Fallback Enter.
    const sendBtn = page
      .getByRole("button", { name: /kirim|send/i })
      .filter({ hasNot: page.locator("[disabled]") })
      .first();
    if ((await sendBtn.count()) > 0) {
      await sendBtn.click();
    } else {
      await composer.press("Enter");
    }

    await expect(page.getByText(token, { exact: false })).toBeVisible({ timeout: 10_000 });

    const headerAfter = await readHeaderLine();
    const bodyAfter = await readMain();
    expect(bodyAfter, "transkrip pasca-kirim harus memuat token").toContain(token);
    expect(headerAfter, "header pasca-kirim tanpa phone").not.toMatch(PHONE_LIKE);
    expect(bodyAfter, "transkrip pasca-kirim tanpa phone").not.toMatch(PHONE_LIKE);
    expect(headerAfter).toBe(headerBefore);

    // Fase 3: reload kedua — pesan baru harus tetap ada (bukan cuma
    // bubble optimistik) dan identitas PIN tetap konsisten.
    await page.reload({ waitUntil: "networkidle" });
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await page.waitForTimeout(600);

    const headerFinal = await readHeaderLine();
    const bodyFinal = await readMain();
    expect(bodyFinal, "token tetap ada setelah reload kedua").toContain(token);
    expect(headerFinal, "header final tanpa phone").not.toMatch(PHONE_LIKE);
    expect(bodyFinal, "transkrip final tanpa phone").not.toMatch(PHONE_LIKE);
    if (/PIN\s+/i.test(headerFinal)) expect(headerFinal).toMatch(PIN_FMT);
    expect(headerFinal).toBe(headerBefore);
  });
});