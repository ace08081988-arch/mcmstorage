import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertChatBrandingClean,
  expectPinBrandingClean,
} from "./_helpers/chat-pin-assertions";

/**
 * E2E — Beberapa DM eksisting dibuka bergantian dan tiap DM di-reload
 * berulang kali. Kontrak yang diuji:
 *   - Identitas header (baris pertama non-kosong pada `<header>`) TIDAK
 *     berubah antar reload dalam satu DM — bukti hidrasi peer stabil
 *     dari server, bukan bergantung state realtime yang bisa hilang.
 *   - Header + transkrip tiap DM SELALU bebas nomor telp Indonesia
 *     mentah, dan tiap token `PIN <...>` yang muncul WAJIB berformat
 *     resmi `PIN xxxx-xxxx` (via helper `_helpers/chat-pin-assertions`).
 *   - Identitas antar DM berbeda WAJIB unik — tidak "menyangkut" ke
 *     konvo berikutnya walau di-reload dulu di konvo sebelumnya.
 *
 * 1. Static source guard (selalu jalan): `chat.$conversationId` mengikat
 *    identitas peer ke `Route.useParams()` tanpa fallback `.phone`,
 *    dan `useConversationMessages` di `src/lib/chat.ts` tidak SELECT
 *    kolom `phone`.
 *
 * 2. Runtime (butuh storageState; self-skip bila kosong): sampai 3 DM
 *    pertama diambil dari `/chat`, tiap DM di-`goto` lalu di-reload
 *    `RELOAD_TIMES` kali, dengan verifikasi pada setiap fase.
 */

const STORAGE = "tests/visual/.auth/user.json";
const RELOAD_TIMES = 3;
const MAX_DMS = 3;

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

// ── 1) Static source guards ───────────────────────────────────────────
test.describe("multi-reload — source guard", () => {
  test("chat.$conversationId: identitas terikat useParams, tanpa fallback phone", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated.chat.$conversationId.tsx"),
      "utf8",
    );
    expect(src).toMatch(/Route\.useParams\(/);
    expect(src, "chat.$conversationId tidak boleh mem-fallback ke peer.phone").not.toMatch(/\|\|\s*peer\.phone\b/);
    expect(src, "chat.$conversationId tidak boleh mem-fallback ke p.phone").not.toMatch(/\|\|\s*p\.phone\b/);
  });

  test("useConversationMessages: tidak SELECT kolom phone", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/chat.ts"), "utf8");
    // Regex sengaja longgar — hanya menolak literal "phone" pada select
    // string. Kalau regresi ke `select("*, phone")`, test ini merah.
    expect(src).not.toMatch(/\.select\(\s*["'`][^"'`]*\bphone\b/);
  });
});

// ── 2) Runtime UI ─────────────────────────────────────────────────────
test.describe("multi-reload — runtime: identitas & branding konsisten", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test(`buka ≤${MAX_DMS} DM × reload ${RELOAD_TIMES}× → header persist, PIN konsisten, tanpa nomor telp mentah`, async ({
    page,
  }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    // Daftar chat itu sendiri wajib bebas nomor telp mentah.
    const listText = await page.locator("main, body").first().innerText();
    expectPinBrandingClean(listText, "daftar /chat");

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
      test.skip(true, "Belum ada DM di akun test — skip runtime multi-reload.");
      return;
    }

    const sample = hrefs.slice(0, MAX_DMS);
    // Kumpulkan identitas header pertama per DM untuk memverifikasi
    // keunikan antar konvo di akhir.
    const firstHeaderByDm = new Map<string, string>();

    for (const href of sample) {
      await page.goto(href);
      await page.waitForLoadState("networkidle");

      const phase0 = await assertChatBrandingClean(page, `open ${href}`);
      expect(phase0.header.length, `${href}: header non-empty`).toBeGreaterThan(0);
      firstHeaderByDm.set(href, phase0.header);

      // Reload berkali kali — identitas header WAJIB identik antar reload.
      for (let i = 1; i <= RELOAD_TIMES; i++) {
        await page.reload();
        await page.waitForLoadState("networkidle");
        const phase = await assertChatBrandingClean(
          page,
          `reload#${i} ${href}`,
        );
        expect(
          phase.header,
          `${href}: header wajib persist di reload#${i}`,
        ).toBe(phase0.header);
      }
    }

    // Identitas antar DM berbeda wajib unik. Ini menutup regresi
    // "identitas menyangkut" dari DM sebelumnya lintas reload.
    if (firstHeaderByDm.size > 1) {
      const values = Array.from(firstHeaderByDm.values());
      const unique = new Set(values);
      expect(
        unique.size,
        `identitas header antar ${values.length} DM wajib unik: ${JSON.stringify(values)}`,
      ).toBe(values.length);
    }
  });
});
