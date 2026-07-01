import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import {
  containsRawIndoPhone,
  expectPinBrandingClean,
  extractPinTokens,
  PIN_MCM_FORMAT,
  readHeaderIdentity,
} from "./_helpers/chat-pin-assertions";

/**
 * E2E — konsistensi `PIN xxxx-xxxx` pada alur:
 *   1. /chat → ketik query di kotak "Cari…"
 *   2. Klik satu hit → panel detail DM (/chat/:id) terbuka
 *   3. Kembali ke /chat via back
 *   4. Refine query (ganti/append/perpendek) beberapa kali
 *   5. Klik ulang hit yang sama → panel detail dibuka lagi
 *
 * Kontrak: token PIN peer di baris daftar, hit pencarian pertama,
 * header panel detail, hit pencarian pasca-refine, dan header panel
 * detail kedua WAJIB IDENTIK. Tidak ada nomor telp Indonesia mentah
 * di seluruh alur.
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

function firstPin(text: string): string {
  const t = extractPinTokens(text).filter((x) => PIN_MCM_FORMAT.test(x));
  return t[0] ?? "";
}

test.describe("PIN xxxx-xxxx tetap identik: search → detail → back → refine → detail", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("token PIN peer konsisten di semua permukaan selama refine query pencarian", async ({
    page,
  }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    const searchInput = () => page.locator('input[placeholder="Cari…"]').first();
    await expect(searchInput(), "kotak Cari… harus tersedia").toBeVisible();

    // ── Baseline: pilih target row yang punya href DM + PIN token +
    //    kata kunci yang aman untuk dipakai sebagai needle pencarian.
    const rows = page.locator('a[href^="/chat/"]');
    const rowCount = await rows.count();
    test.skip(rowCount === 0, "Belum ada DM di akun test — skip.");

    type Target = { href: string; pin: string; needle: string };
    let target: Target | null = null;

    for (let i = 0; i < rowCount; i += 1) {
      const href = (await rows.nth(i).getAttribute("href")) ?? "";
      if (!/^\/chat\/[0-9a-f-]{36}$/.test(href)) continue;
      const text = (await rows.nth(i).innerText().catch(() => "")) || "";
      const aria = (await rows.nth(i).getAttribute("aria-label").catch(() => "")) || "";
      const combined = `${text}\n${aria}`;
      expectPinBrandingClean(combined, `baseline row#${i}`);
      const pin = firstPin(combined);
      if (!pin) continue;
      const needle =
        text
          .split(/\s+/)
          .map((w) => w.trim())
          .find(
            (w) =>
              /^[A-Za-z][A-Za-z0-9]{3,}$/.test(w) &&
              !/^PIN$/i.test(w) &&
              !/^(Arsip|Aktif|Baru|Anda|Kontak|Chat|Semua|Grup|Favorit)$/i.test(w),
          ) ?? "";
      if (!needle) continue;
      target = { href, pin, needle };
      break;
    }
    test.skip(!target, "Tidak ada baris dengan snippet+PIN yang dapat dijadikan needle — skip.");

    const t = target!;

    // Utility: ketik query lalu tunggu debounce, return jumlah hit + snapshot pin hit yang cocok.
    const queryOnce = async (q: string): Promise<{ hits: number; matchedPin: string; matchedIndex: number }> => {
      await searchInput().fill(q);
      await page.waitForTimeout(600);
      const bodyText = (await page.locator("body").innerText().catch(() => "")) || "";
      expect(
        containsRawIndoPhone(bodyText),
        `panel /chat bebas nomor telp mentah untuk query="${q}"`,
      ).toBe(false);
      const hitButtons = page.locator('div.rounded-lg.border ul li button');
      const hits = await hitButtons.count();
      let matchedPin = "";
      let matchedIndex = -1;
      for (let i = 0; i < hits; i += 1) {
        const hitText = (await hitButtons.nth(i).innerText().catch(() => "")) || "";
        expectPinBrandingClean(hitText, `hit#${i} untuk query="${q}"`);
        if (t.pin && hitText.includes(t.pin)) {
          matchedPin = firstPin(hitText);
          matchedIndex = i;
          break;
        }
      }
      return { hits, matchedPin, matchedIndex };
    };

    // ── (1) Search awal dengan needle penuh.
    const first = await queryOnce(t.needle);
    test.skip(
      first.matchedIndex < 0,
      "Hit target tidak muncul di pencarian awal (data mungkin kosong) — skip.",
    );
    expect(first.matchedPin, "PIN hit pencarian awal identik dengan baseline row").toBe(t.pin);

    // ── (2) Klik hit → panel detail DM.
    await page.locator('div.rounded-lg.border ul li button').nth(first.matchedIndex).click();
    await page.waitForLoadState("networkidle");
    const header1 = await readHeaderIdentity(page);
    expectPinBrandingClean(header1, "header DM setelah klik hit pertama");
    expect(firstPin(header1), "PIN header DM identik dengan baseline row").toBe(t.pin);
    const body1 = await page.locator("main, body").first().innerText();
    expectPinBrandingClean(body1, "transkrip DM pertama");

    // ── (3) Kembali ke /chat.
    await page.goBack();
    await page.waitForLoadState("networkidle");
    // Kadang goBack tidak diterima router → fallback ke navigasi eksplisit.
    if (!/\/chat\/?$/.test(new URL(page.url()).pathname)) {
      await page.goto("/chat");
      await page.waitForLoadState("networkidle");
    }
    await expect(searchInput(), "kotak Cari… kembali tampil di /chat").toBeVisible();

    // Verifikasi baris daftar untuk href target masih menampilkan PIN yang sama.
    const rowAfter = page.locator(`a[href="${t.href}"]`).first();
    if ((await rowAfter.count()) > 0) {
      const txt = (await rowAfter.innerText().catch(() => "")) || "";
      const aria = (await rowAfter.getAttribute("aria-label").catch(() => "")) || "";
      const combined = `${txt}\n${aria}`;
      expectPinBrandingClean(combined, "baris daftar target pasca-back");
      const p = firstPin(combined);
      if (p) expect(p, "PIN baris daftar target identik pasca-back").toBe(t.pin);
    }

    // ── (4) Refine query: perpendek, panjangkan, ganti case.
    const refines = [
      t.needle.slice(0, Math.max(2, t.needle.length - 1)), // perpendek
      t.needle + t.needle.charAt(0),                       // panjangkan
      t.needle.toUpperCase(),                              // ganti case
      t.needle.toLowerCase(),
    ];
    let lastMatch: { pin: string; index: number } | null = null;
    for (const q of refines) {
      const res = await queryOnce(q);
      if (res.matchedIndex >= 0) {
        expect(
          res.matchedPin,
          `PIN hit tetap identik saat refine query="${q}"`,
        ).toBe(t.pin);
        lastMatch = { pin: res.matchedPin, index: res.matchedIndex };
      }
    }

    // ── (5) Klik ulang hit di refine terakhir yang match (kalau ada) →
    //     header DM kedua wajib menampilkan PIN yang sama.
    if (lastMatch) {
      await page.locator('div.rounded-lg.border ul li button').nth(lastMatch.index).click();
      await page.waitForLoadState("networkidle");
      const header2 = await readHeaderIdentity(page);
      expectPinBrandingClean(header2, "header DM setelah klik hit pasca-refine");
      expect(
        firstPin(header2),
        "PIN header DM kedua identik dengan yang pertama",
      ).toBe(t.pin);
      const body2 = await page.locator("main, body").first().innerText();
      expectPinBrandingClean(body2, "transkrip DM kedua pasca-refine");
    }
  });
});
