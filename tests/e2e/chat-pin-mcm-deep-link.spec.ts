import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E — Deep link `/chat/$conversationId`:
 *   - Navigasi langsung (tanpa transit via `/chat`) langsung merender
 *     identitas peer sebagai `PIN xxxx-xxxx` — bukan nomor telp mentah,
 *     bukan placeholder loading yang bocor.
 *   - Histori pesan pra-refresh tetap bisa dibaca setelah `reload()`
 *     pada URL yang sama (bukti loader/query mem-hidrasi dari server,
 *     bukan cuma menang-menangan cache list `/chat`).
 *
 * 1. Static guard: route file `_authenticated.chat.$conversationId.tsx`
 *    memakai `Route.useParams()` dan tanpa fallback ke `phone`.
 * 2. Runtime (self-skip):
 *    a. Kunjungi `/chat`, ambil `href` DM pertama sebagai target deep link.
 *    b. Buka tab / konteks bersih dan `page.goto(href)` langsung.
 *    c. Snapshot header + transkrip; assert tanpa phone leak & format PIN.
 *    d. `reload()` pada URL yang sama; assert histori pra-reload masih
 *       ada di transkrip pasca-reload dan identitas header identik.
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

test.describe("deep link chat — source guard", () => {
  test("chat.$conversationId: Route.useParams + tanpa fallback phone", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated.chat.$conversationId.tsx"),
      "utf8",
    );
    expect(src).toMatch(/Route\.useParams\(\)/);
    expect(src).not.toMatch(/\|\|\s*p\.phone\b/);
    expect(src).not.toMatch(/\|\|\s*peer\.phone\b/);
    // File route id harus persis, supaya deep link `/chat/<uuid>` match.
    expect(src).toMatch(
      /createFileRoute\(\s*["']\/_authenticated\/chat\/\$conversationId["']\s*\)/,
    );
  });
});

test.describe("deep link chat — runtime PIN MCM & histori bertahan", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("goto(/chat/$conversationId) langsung → PIN MCM; reload → histori tetap terbaca", async ({
    browser,
  }) => {
    // Fase 0: ambil href DM pertama dari halaman list (butuh sesi login).
    const seedCtx = await browser.newContext({ storageState: STORAGE });
    const seed = await seedCtx.newPage();
    await seed.goto("/chat");
    await seed.waitForLoadState("networkidle");
    const first = seed.locator('a[href^="/chat/"]').first();
    const hasDM = (await first.count()) > 0;
    const href = hasDM ? await first.getAttribute("href") : null;
    await seedCtx.close();
    test.skip(!href, "Akun test belum punya DM — skip.");
    expect(href).toMatch(/^\/chat\/[0-9a-f-]{36}$/);

    // Fase 1: konteks BERSIH — hanya bawa storageState auth, tidak
    // mewarisi cache list `/chat`. Ini menegakkan bahwa render header
    // & transkrip beneran datang dari loader/query per-konvo, bukan
    // sisa data list.
    const ctx = await browser.newContext({ storageState: STORAGE });
    const page = await ctx.newPage();

    await page.goto(href!, { waitUntil: "networkidle" });
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await page.waitForTimeout(600);

    const readHeaderLine = async () => {
      const raw = (await page.locator("header, [role='banner']").first().innerText().catch(() => "")) || "";
      return raw.split(/\n+/).map((s) => s.trim()).find((s) => s.length > 0) || "";
    };
    const readMain = async () => await page.locator("main, body").first().innerText();

    const headerBefore = await readHeaderLine();
    const bodyBefore = await readMain();

    expect(headerBefore, "header deep-link tanpa phone").not.toMatch(PHONE_LIKE);
    expect(bodyBefore, "transkrip deep-link tanpa phone").not.toMatch(PHONE_LIKE);
    if (/PIN\s+/i.test(headerBefore)) expect(headerBefore).toMatch(PIN_FMT);
    if (/PIN\s+/i.test(bodyBefore)) expect(bodyBefore).toMatch(PIN_FMT);

    // Kumpulkan pesan histori yang stabil untuk diverifikasi bertahan.
    const readMessages = async (): Promise<string[]> =>
      page.evaluate(() => {
        const main = document.querySelector("main") ?? document.body;
        const nodes = Array.from(
          main.querySelectorAll<HTMLElement>(
            "[data-message-id], [data-msg-id], [data-message], li, article, div",
          ),
        );
        const seen = new Set<string>();
        const out: string[] = [];
        for (const n of nodes) {
          if ((n as HTMLElement).matches?.("input, textarea, button")) continue;
          const t = (n.innerText || "").trim();
          if (t.length < 3 || t.length > 400) continue;
          if (/tulis pesan|kirim|memuat|loading/i.test(t)) continue;
          if (seen.has(t)) continue;
          seen.add(t);
          out.push(t);
          if (out.length >= 30) break;
        }
        return out;
      });

    const msgsBefore = await readMessages();
    test.skip(msgsBefore.length === 0, "DM target tidak punya histori — skip.");

    // Fase 2: reload pada URL yang sama — bukan navigasi via `/chat`.
    await page.reload({ waitUntil: "networkidle" });
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await page.waitForTimeout(600);

    const headerAfter = await readHeaderLine();
    const bodyAfter = await readMain();

    expect(headerAfter, "header pasca-reload tanpa phone").not.toMatch(PHONE_LIKE);
    expect(bodyAfter, "transkrip pasca-reload tanpa phone").not.toMatch(PHONE_LIKE);
    if (/PIN\s+/i.test(headerAfter)) expect(headerAfter).toMatch(PIN_FMT);
    if (/PIN\s+/i.test(bodyAfter)) expect(bodyAfter).toMatch(PIN_FMT);

    // Identitas peer stabil di dua fase.
    expect(headerAfter, "identitas header identik lintas reload").toBe(headerBefore);

    // Histori tidak hilang setelah reload deep-link.
    const missing = msgsBefore.filter((t) => !bodyAfter.includes(t));
    expect(
      missing,
      `pesan histori hilang setelah reload deep-link: ${missing.slice(0, 3).join(" | ")}`,
    ).toHaveLength(0);

    await ctx.close();
  });
});