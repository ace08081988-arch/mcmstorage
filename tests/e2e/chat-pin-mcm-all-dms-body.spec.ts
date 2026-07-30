import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PHONE_ID_LIKE,
  PIN_MCM_FORMAT,
  PIN_ANY_TOKEN,
  extractPinTokens,
} from "./_helpers/chat-pin-assertions";

/**
 * E2E — sweep SELURUH DM yang bisa dijangkau dari `/chat` dan periksa
 * seluruh body transkrip tiap konvo:
 *   - TIDAK ada substring nomor telp Indonesia mentah (`PHONE_ID_LIKE`)
 *     di halaman mana pun.
 *   - SETIAP kemunculan token `PIN …` (`PIN_ANY_TOKEN`) LOLOS
 *     `PIN_MCM_FORMAT` (`PIN xxxx-xxxx`, 4-4 A–Z0-9).
 *
 * Berbeda dari suite lain yang sampling atau fokus fase tertentu,
 * suite ini adalah "full-coverage sweep": setiap DM disatukan
 * innerText body-nya lalu diperiksa sekaligus. Ini menutup regresi
 * lokal (mis. bubble/menu/preview) yang lolos dari sampling.
 *
 * Selain runtime sweep, ada static guard yang selalu jalan:
 *   - `chat.index` (daftar) & `chat.$conversationId` (detail) tidak
 *     boleh me-render `peer.phone` mentah sebagai identitas.
 *   - `useConversationMessages` di `src/lib/chat.ts` tidak SELECT
 *     kolom `phone`.
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

// ── Static source guards ───────────────────────────────────────────────
test.describe("all-dms-body — source guard", () => {
  test("chat.$conversationId tidak mem-fallback identitas ke peer.phone", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated.chat.$conversationId.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/\|\|\s*peer\.phone\b/);
    expect(src).not.toMatch(/\|\|\s*p\.phone\b/);
  });

  test("useConversationMessages tidak SELECT kolom phone", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/chat.ts"), "utf8");
    expect(src).not.toMatch(/\.select\(\s*["'`][^"'`]*\bphone\b/);
  });
});

// ── Runtime sweep ──────────────────────────────────────────────────────
test.describe("all-dms-body — full sweep", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("body semua DM: PIN_MCM_FORMAT untuk tiap token PIN, tanpa nomor telp mentah", async ({
    page,
  }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    // 1) Daftar `/chat` itu sendiri masuk sweep.
    const listBody = await page.locator("main, body").first().innerText();
    expect(
      listBody,
      "daftar /chat: tidak boleh memuat nomor telp Indonesia mentah",
    ).not.toMatch(PHONE_ID_LIKE);
    for (const tok of extractPinTokens(listBody)) {
      expect(
        tok,
        `daftar /chat: token "${tok}" wajib berformat PIN xxxx-xxxx`,
      ).toMatch(PIN_MCM_FORMAT);
    }

    // 2) Kumpulkan seluruh href DM unik.
    const hrefs = await page
      .locator('a[href^="/chat/"]')
      .evaluateAll((els) =>
        Array.from(
          new Set(
            (els as HTMLAnchorElement[])
              .map((a) => a.getAttribute("href") ?? "")
              .filter((h) => /^\/chat\/[0-9a-f-]{8,}/i.test(h)),
          ),
        ),
      );

    if (hrefs.length === 0) {
      test.skip(true, "Belum ada DM di akun test — skip sweep body.");
      return;
    }

    // Kumpulkan pelanggaran alih-alih fail di DM pertama supaya laporan
    // menampilkan seluruh permukaan yang bocor sekaligus. Gagal terakhir.
    const rawPhoneLeaks: Array<{ href: string; sample: string }> = [];
    const badPinTokens: Array<{ href: string; token: string }> = [];

    for (const href of hrefs) {
      await page.goto(href);
      await page.waitForLoadState("networkidle");

      // Body = main bila ada; fallback body. Header sudah termasuk (child
      // dari body), jadi sweep ini betul-betul mencakup seluruh halaman.
      const body = await page.locator("main, body").first().innerText();

      const phoneMatch = body.match(PHONE_ID_LIKE);
      if (phoneMatch) {
        const idx = phoneMatch.index ?? 0;
        rawPhoneLeaks.push({
          href,
          sample: body.slice(Math.max(0, idx - 24), idx + phoneMatch[0].length + 24),
        });
      }

      // Tiap token yang cocok `PIN <nonspace>` wajib juga cocok format resmi.
      const tokens = body.match(new RegExp(PIN_ANY_TOKEN.source, "g")) ?? [];
      for (const tok of tokens) {
        if (!PIN_MCM_FORMAT.test(tok)) {
          badPinTokens.push({ href, token: tok });
        }
      }
    }

    expect(
      rawPhoneLeaks,
      `Nomor telp Indonesia mentah bocor di ${rawPhoneLeaks.length} DM: ${JSON.stringify(
        rawPhoneLeaks,
        null,
        2,
      )}`,
    ).toEqual([]);
    expect(
      badPinTokens,
      `Token PIN off-format ditemukan di ${badPinTokens.length} lokasi: ${JSON.stringify(
        badPinTokens,
        null,
        2,
      )}`,
    ).toEqual([]);
  });
});
