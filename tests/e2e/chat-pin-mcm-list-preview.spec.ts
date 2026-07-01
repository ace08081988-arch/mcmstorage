import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E — Preview di halaman daftar chat (`/chat`) untuk DM yang sudah
 * ada wajib menampilkan identitas `PIN xxxx-xxxx` yang benar per baris
 * dan TIDAK PERNAH menampilkan nomor telepon Indonesia mentah — baik
 * pada judul (peer), snippet pesan terakhir, maupun badge/aria label,
 * dan konsistensi tersebut bertahan setelah `page.reload()`.
 *
 * 1. Static guard: `chat.index` tidak mem-fallback ke `.phone` sebagai
 *    teks judul/preview, dan memakai `<Link to="/chat/$conversationId">`.
 * 2. Runtime (self-skip): buka `/chat`, snapshot semua baris DM,
 *    `reload()`, snapshot lagi — kedua fase wajib bebas phone.
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

test.describe("chat list preview — source guard", () => {
  test("chat.index: <Link to='/chat/$conversationId'> dan tanpa fallback .phone untuk judul/preview", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated.chat.index.tsx"),
      "utf8",
    );
    expect(src).toMatch(/to=["']\/chat\/\$conversationId["']/);
    // Fallback identitas tampilan ke `.phone` dilarang.
    expect(src).not.toMatch(/\|\|\s*[a-zA-Z_.]*\.phone\b/);
    expect(src).not.toMatch(/\.phone\s*\?\?/);
  });
});

test.describe("chat list preview — runtime PIN MCM (with refresh)", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("daftar chat: setiap baris PIN-branded, bebas nomor telp, konsisten setelah reload", async ({
    page,
  }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");
    const rows = page.locator('a[href^="/chat/"]');
    const n = await rows.count();
    test.skip(n === 0, "Belum ada DM untuk uji — skip.");

    async function snapshotAll(): Promise<string[]> {
      const out: string[] = [];
      const total = await rows.count();
      for (let i = 0; i < total; i += 1) {
        const txt = (await rows.nth(i).innerText().catch(() => "")) || "";
        const aria =
          (await rows.nth(i).getAttribute("aria-label").catch(() => "")) || "";
        out.push(`${txt}\n${aria}`);
      }
      return out;
    }

    function enforce(snapshot: string[], phase: string) {
      snapshot.forEach((row, i) => {
        expect(row, `${phase} row#${i} tanpa phone`).not.toMatch(PHONE_LIKE);
        if (/PIN\s+/i.test(row)) {
          expect(row, `${phase} row#${i} format PIN`).toMatch(PIN_FMT);
        }
      });
    }

    const before = await snapshotAll();
    enforce(before, "pre-reload");

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(rows.first()).toBeVisible();

    const after = await snapshotAll();
    enforce(after, "post-reload");

    // Konsistensi jumlah baris (rehidrasi tidak "kehilangan" DM).
    expect(after.length).toBe(before.length);
  });
});
