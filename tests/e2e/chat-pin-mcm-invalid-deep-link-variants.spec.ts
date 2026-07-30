import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PHONE_ID_LIKE,
  PIN_MCM_FORMAT,
  PIN_ANY_TOKEN,
} from "./_helpers/chat-pin-assertions";

/**
 * E2E — variasi deep link `/chat/<id>` yang TIDAK ADA / TIDAK BERIZIN.
 *
 * Skenario yang diuji per varian:
 *   - UUID valid tapi tidak ada di DB (`00000000-...`).
 *   - UUID acak yang hampir pasti tidak berizin (RLS reject).
 *   - Slug non-UUID `not-a-real-id` — path tetap match `$conversationId`,
 *     RPC `get_conversation_meta` menolaknya sehingga meta kosong.
 *
 * Kontrak per varian:
 *   1. Banner `data-testid="chat-not-found"` tampil dan berisi teks
 *      "Percakapan tidak ditemukan".
 *   2. SELURUH halaman (banner + body) bebas nomor telp Indonesia mentah
 *      (`PHONE_ID_LIKE`).
 *   3. SETIAP token `PIN …` yang muncul WAJIB lolos `PIN_MCM_FORMAT`
 *      (`PIN xxxx-xxxx`) — tidak boleh ada token PIN "invalid" seperti
 *      raw ID yang dibungkus dengan prefix PIN.
 *   4. CTA "Kembali ke daftar chat" mengarahkan ke `/chat`.
 *
 * Static source guard (selalu jalan):
 *   - Route file me-render banner not-found dan tidak menyentuh
 *     `.phone` di blok banner.
 */

const STORAGE = "tests/visual/.auth/user.json";

const VARIANTS: ReadonlyArray<{ label: string; id: string }> = [
  { label: "uuid-nihil", id: "00000000-0000-4000-8000-000000000000" },
  { label: "uuid-acak-tak-berizin", id: "11111111-2222-4333-8444-555555555555" },
  { label: "slug-non-uuid", id: "not-a-real-id" },
];

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

// ── Static source guard ───────────────────────────────────────────────
test.describe("invalid deep-link variants — source guard", () => {
  test("route file: banner not-found + CTA, blok banner tidak menyentuh .phone", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated.chat.$conversationId.tsx"),
      "utf8",
    );
    expect(src).toMatch(/data-testid="chat-not-found"/);
    expect(src).toMatch(/Percakapan tidak ditemukan/);
    expect(src).toMatch(/Kembali ke daftar chat/);
    const banner = src.match(
      /data-testid="chat-not-found"[\s\S]*?Kembali ke daftar chat[\s\S]*?<\/Button>/,
    );
    expect(banner, "blok banner not-found harus ada").not.toBeNull();
    expect(banner![0]).not.toMatch(/\.phone\b/);
    // Tidak ada literal PIN off-format di source banner.
    for (const tok of banner![0].match(new RegExp(PIN_ANY_TOKEN.source, "g")) ?? []) {
      expect(tok).toMatch(PIN_MCM_FORMAT);
    }
  });
});

// ── Runtime per varian ────────────────────────────────────────────────
test.describe("invalid deep-link variants — runtime", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  for (const v of VARIANTS) {
    test(`/chat/${v.label}: banner error tampil, bebas nomor telp mentah, tanpa PIN off-format`, async ({
      page,
    }) => {
      await page.goto(`/chat/${v.id}`, { waitUntil: "networkidle" });

      const banner = page.getByTestId("chat-not-found");
      await expect(banner, "banner not-found wajib tampil").toBeVisible({
        timeout: 10_000,
      });
      await expect(banner).toContainText(/Percakapan tidak ditemukan/i);

      const bannerText = await banner.innerText();
      const bodyText = await page.locator("body").innerText();

      expect(bannerText, `${v.label} banner: bebas nomor telp mentah`).not.toMatch(
        PHONE_ID_LIKE,
      );
      expect(bodyText, `${v.label} body: bebas nomor telp mentah`).not.toMatch(
        PHONE_ID_LIKE,
      );
      // Raw ID varian tidak boleh muncul di banner (tidak dibocorkan ke user).
      expect(
        bannerText,
        `${v.label} banner: tidak boleh menampilkan raw id`,
      ).not.toContain(v.id);

      // Semua token PIN yang mungkin muncul WAJIB berformat resmi.
      const tokens = bodyText.match(new RegExp(PIN_ANY_TOKEN.source, "g")) ?? [];
      for (const tok of tokens) {
        expect(
          tok,
          `${v.label}: token "${tok}" wajib berformat PIN xxxx-xxxx`,
        ).toMatch(PIN_MCM_FORMAT);
      }

      // CTA balik ke /chat.
      await page
        .getByRole("button", { name: /Kembali ke daftar chat/i })
        .click();
      await expect(page).toHaveURL(/\/chat\/?$/);
    });
  }
});
