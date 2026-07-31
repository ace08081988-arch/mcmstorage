import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import {
  containsRawIndoPhone,
  expectPinBrandingClean,
  readHeaderIdentity,
} from "./_helpers/chat-pin-assertions";

/**
 * E2E — hardening: selain token `PIN xxxx-xxxx` yang wajib berformat,
 * TIDAK ADA nomor telp Indonesia mentah yang boleh bocor di permukaan
 * berikut selama pengguna melakukan pencarian & mengubah filter:
 *
 *   (A) Header DM (nama peer, subjudul, tooltip/title, aria-label).
 *   (B) Snippet baris daftar (last-message preview) — text + aria-label.
 *   (C) Highlight hasil pencarian — teks di panel Cari termasuk elemen
 *       <mark>, <strong>, <em>, <span class*="highlight"> yang lazim
 *       dipakai untuk menandai match.
 *   (D) Semua atribut `aria-label` / `title` / `alt` yang aktif di
 *       DOM selama fase pengujian (screen-reader path).
 *
 * Fase yang diuji:
 *   1. Baseline /chat (chip Semua, tab Aktif)
 *   2. Chip Belum dibaca / Grup / Favorit
 *   3. Tab Arsip lalu Aktif
 *   4. Ketik query di kotak Cari (2 karakter, 3 karakter, refine)
 *   5. Klik satu hit → header DM
 *   6. Kembali ke /chat + query kosong lagi
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

/** Kumpulkan seluruh nilai atribut aksesibilitas + title + alt di DOM. */
async function collectA11yAttributes(
  page: import("@playwright/test").Page,
): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const attrs = ["aria-label", "aria-description", "aria-valuetext", "title", "alt", "placeholder"];
    document.querySelectorAll<HTMLElement>("*").forEach((el) => {
      for (const a of attrs) {
        const v = el.getAttribute(a);
        if (v && v.trim()) out.push(v);
      }
    });
    return out;
  });
}

/** Kumpulkan innerText dari elemen highlight lazim di panel pencarian. */
async function collectHighlightText(
  page: import("@playwright/test").Page,
): Promise<string[]> {
  return page.evaluate(() => {
    const sel = [
      "mark",
      "strong",
      "em",
      "b",
      "[class*='highlight' i]",
      "[data-highlight]",
      "span[class*='match' i]",
    ].join(",");
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(sel));
    return nodes.map((n) => n.innerText).filter(Boolean);
  });
}

function assertNoPhoneEach(items: string[], label: string): void {
  items.forEach((v, i) => {
    expect(
      containsRawIndoPhone(v),
      `${label}[#${i}] bebas nomor telp Indonesia mentah — nilai="${v}"`,
    ).toBe(false);
  });
}

async function assertAllSurfacesClean(
  page: import("@playwright/test").Page,
  phase: string,
): Promise<void> {
  // Body innerText: satu jaring pengaman umum.
  const body = (await page.locator("body").innerText().catch(() => "")) || "";
  expect(
    containsRawIndoPhone(body),
    `${phase}: body /chat bebas nomor telp mentah`,
  ).toBe(false);
  // Format PIN pun tetap harus resmi.
  expectPinBrandingClean(body, `${phase} body`);

  // Snippet per baris daftar (text + aria-label).
  const rows = page.locator('a[href^="/chat/"]');
  const rowCount = await rows.count();
  for (let i = 0; i < rowCount; i += 1) {
    const t = (await rows.nth(i).innerText().catch(() => "")) || "";
    const aria = (await rows.nth(i).getAttribute("aria-label").catch(() => "")) || "";
    const title = (await rows.nth(i).getAttribute("title").catch(() => "")) || "";
    assertNoPhoneEach([t, aria, title], `${phase} row#${i}`);
    expectPinBrandingClean(`${t}\n${aria}\n${title}`, `${phase} row#${i} combined`);
  }

  // Elemen highlight di panel pencarian (kalau ada).
  const highlights = await collectHighlightText(page);
  assertNoPhoneEach(highlights, `${phase} highlight`);
  highlights.forEach((h, i) => expectPinBrandingClean(h, `${phase} highlight#${i}`));

  // aria-label / title / alt / placeholder di seluruh DOM.
  const a11y = await collectA11yAttributes(page);
  assertNoPhoneEach(a11y, `${phase} a11y-attr`);
}

test.describe("hardening: tidak ada nomor telp mentah di header/snippet/highlight/aria selama search & filter", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("semua permukaan bebas nomor telp Indonesia mentah selama alur search & filter", async ({
    page,
  }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    const searchInput = () => page.locator('input[placeholder="Cari…"]').first();
    await expect(searchInput(), "kotak Cari… harus tampil").toBeVisible();

    const rows = page.locator('a[href^="/chat/"]');
    const rowCount = await rows.count();
    test.skip(rowCount === 0, "Belum ada DM di akun test — skip.");

    // (1) Baseline.
    await assertAllSurfacesClean(page, "baseline");

    // Ambil needle 2-huruf dari salah satu baris untuk memicu hit yang lebar.
    let seed = "";
    for (let i = 0; i < rowCount; i += 1) {
      const t = (await rows.nth(i).innerText().catch(() => "")) || "";
      const w =
        t.split(/\s+/).find(
          (s) =>
            /^[A-Za-z][A-Za-z0-9]{2,}$/.test(s) &&
            !/^PIN$/i.test(s) &&
            !/^(Arsip|Aktif|Baru|Anda|Kontak|Chat|Semua|Grup|Favorit)$/i.test(s),
        ) ?? "";
      if (w) { seed = w.slice(0, 3); break; }
    }
    if (!seed) seed = "an";

    // (2) Chip filter.
    for (const label of ["Belum dibaca", "Grup", "Favorit", "Semua"]) {
      const chip = page.getByRole("button", { name: new RegExp(`^${label}`, "i") }).first();
      if ((await chip.count()) === 0) continue;
      await chip.click().catch(() => {});
      await page.waitForTimeout(300);
      await assertAllSurfacesClean(page, `chip ${label}`);
    }

    // (3) Tab Arsip / Aktif.
    const arsipTab = page.getByRole("tab", { name: /^Arsip/i }).first();
    if ((await arsipTab.count()) > 0) {
      await arsipTab.click().catch(() => {});
      await page.waitForTimeout(400);
      await assertAllSurfacesClean(page, "tab Arsip");
    }
    const aktifTab = page.getByRole("tab", { name: /^Aktif/i }).first();
    if ((await aktifTab.count()) > 0) {
      await aktifTab.click().catch(() => {});
      await page.waitForTimeout(400);
      await assertAllSurfacesClean(page, "tab Aktif kembali");
    }

    // (4) Search + refine.
    for (const q of [seed.slice(0, 2), seed, seed + seed.charAt(0), seed.toUpperCase()]) {
      await searchInput().fill(q);
      await page.waitForTimeout(600);
      await assertAllSurfacesClean(page, `search q="${q}"`);
    }

    // (5) Klik hit pertama (jika ada) → verifikasi header + transkrip DM.
    const hits = page.locator('div.rounded-lg.border ul li button');
    const hitCount = await hits.count();
    if (hitCount > 0) {
      await hits.nth(0).click();
      await page.waitForLoadState("networkidle");
      const header = await readHeaderIdentity(page);
      expect(
        containsRawIndoPhone(header),
        "header DM bebas nomor telp mentah",
      ).toBe(false);
      expectPinBrandingClean(header, "header DM");
      const body = await page.locator("main, body").first().innerText();
      expect(
        containsRawIndoPhone(body),
        "transkrip DM bebas nomor telp mentah",
      ).toBe(false);
      // aria-label / title global di halaman DM.
      const a11y = await collectA11yAttributes(page);
      assertNoPhoneEach(a11y, "DM detail a11y-attr");
    }

    // (6) Kembali ke /chat, bersihkan query.
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");
    await searchInput().fill("");
    await page.waitForTimeout(300);
    await assertAllSurfacesClean(page, "pasca-search clear");
  });
});
