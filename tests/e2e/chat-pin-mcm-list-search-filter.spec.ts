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
 * E2E — konsistensi format `PIN xxxx-xxxx` LINTAS PERMUKAAN saat
 * pengguna memakai search/filter di halaman daftar percakapan `/chat`.
 *
 * Permukaan yang diuji per DM:
 *   1. Baris daftar `/chat` sebelum search (baseline).
 *   2. Panel hasil pencarian setelah user mengetik query di kotak
 *      "Cari…" — tiap hit menampilkan `conv.display_title` peer.
 *   3. Header DM setelah user meng-klik hit → langsung masuk ke
 *      `/chat/:id` peer yang sama.
 *   4. Baris daftar `/chat` setelah search dibersihkan + setelah
 *      pindah tab Aktif↔Arsip.
 *
 * Kontrak: token `PIN xxxx-xxxx` peer WAJIB IDENTIK di keempat
 * permukaan tersebut, dan tidak pernah ada nomor telp Indonesia
 * mentah pada fase manapun.
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

function firstPinToken(text: string): string {
  const tokens = extractPinTokens(text).filter((t) => PIN_MCM_FORMAT.test(t));
  return tokens[0] ?? "";
}

test.describe("konsistensi PIN xxxx-xxxx saat search / filter daftar percakapan", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("token PIN identik di header, baris hasil pencarian, dan panel detail selama search/filter", async ({
    page,
  }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    // Kotak input pencarian di halaman daftar.
    const searchInput = page.locator('input[placeholder="Cari…"]').first();
    await expect(searchInput, "kotak Cari… harus ada di /chat").toBeVisible();

    const rows = page.locator('a[href^="/chat/"]');
    const rowCount = await rows.count();
    test.skip(rowCount === 0, "Belum ada DM di akun test — skip.");

    // ── (a) Baseline daftar: kumpulkan (href, pinToken, snippet word).
    type RowSnap = {
      href: string;
      text: string;
      pin: string;
      word: string | null;
    };
    const baseline: RowSnap[] = [];
    for (let i = 0; i < rowCount; i += 1) {
      const href = (await rows.nth(i).getAttribute("href")) ?? "";
      const text = (await rows.nth(i).innerText().catch(() => "")) || "";
      const aria =
        (await rows.nth(i).getAttribute("aria-label").catch(() => "")) || "";
      const combined = `${text}\n${aria}`;
      expectPinBrandingClean(combined, `baseline row#${i}`);
      // Pilih 1 kata alfanumerik ≥4 karakter dari snippet baris sebagai
      // needle pencarian; token "PIN xxxx-xxxx" & label UI dihindari.
      const word =
        text
          .split(/\s+/)
          .map((w) => w.trim())
          .find(
            (w) =>
              /^[A-Za-z][A-Za-z0-9]{3,}$/.test(w) &&
              !/^PIN$/i.test(w) &&
              !/^(Arsip|Aktif|Baru|Anda|Kontak|Chat)$/i.test(w),
          ) ?? null;
      baseline.push({ href, text: combined, pin: firstPinToken(combined), word });
    }

    // Cari row yang punya (word untuk search) DAN pin token → kandidat uji.
    const target = baseline.find((r) => r.word && r.pin && /^\/chat\/[0-9a-f-]{36}$/.test(r.href));
    test.skip(!target, "Tidak ada baris dengan snippet+PIN token untuk pengujian — skip.");

    // ── (b) Ketik query di kotak Cari.
    await searchInput.fill(target!.word!);
    await page.waitForTimeout(600); // debounce search hook

    // Panel hasil pencarian: <ul> di dalam kontainer border. Setiap hit
    // adalah <button> di dalam <li>, judul == conv.display_title.
    const hitPanel = page.locator("div.rounded-lg.border").filter({
      has: page.locator("ul li button, div:has-text('Tidak ada pesan')"),
    }).first();

    // Tunggu panel muncul (loading → hits / empty). Bila hits kosong,
    // fallback: cukup verifikasi keseluruhan tampilan tetap bersih PIN.
    await page.waitForTimeout(200);
    const hitButtons = page.locator('div.rounded-lg.border ul li button');
    const hitCount = await hitButtons.count();

    // Snapshot innerText panel — dipakai untuk verifikasi bebas phone.
    const panelText = (await page.locator("body").innerText().catch(() => "")) || "";
    expect(
      containsRawIndoPhone(panelText),
      "panel hasil pencarian bebas nomor telp Indonesia mentah",
    ).toBe(false);

    // Cari hit yang mengarah ke DM target. Klik → verifikasi header.
    let matchedHitPin = "";
    if (hitCount > 0) {
      // Setiap hit berada dalam <button> yang me-navigate ke conversationId
      // via onClick — teks judul == conv.display_title. Kita cocokkan
      // via inclusion token PIN target.
      for (let i = 0; i < hitCount; i += 1) {
        const hitText = (await hitButtons.nth(i).innerText().catch(() => "")) || "";
        expectPinBrandingClean(hitText, `hasil pencarian hit#${i}`);
        if (target!.pin && hitText.includes(target!.pin)) {
          matchedHitPin = firstPinToken(hitText);
          // ── (c) Klik hit → masuk ke DM peer target.
          await hitButtons.nth(i).click();
          await page.waitForLoadState("networkidle");
          break;
        }
      }
    }

    if (matchedHitPin) {
      // Header DM wajib menampilkan token PIN yang identik.
      const header = await readHeaderIdentity(page);
      expectPinBrandingClean(header, "header DM setelah klik hit pencarian");
      const headerPin = firstPinToken(header);
      expect(
        headerPin,
        "token PIN di header DM wajib identik dengan hit pencarian",
      ).toBe(matchedHitPin);
      expect(
        headerPin,
        "token PIN di header DM wajib identik dengan baris daftar (baseline)",
      ).toBe(target!.pin);

      // Body/panel detail transkrip tetap bersih.
      const body = await page.locator("main, body").first().innerText();
      expectPinBrandingClean(body, "transkrip DM setelah dari hit pencarian");
    }

    // ── (d) Kembali ke /chat, bersihkan search, verifikasi baris identik.
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");
    const searchInput2 = page.locator('input[placeholder="Cari…"]').first();
    await searchInput2.fill(""); // pastikan bersih

    const rowsAfter = page.locator('a[href^="/chat/"]');
    const rowCountAfter = await rowsAfter.count();
    for (let i = 0; i < rowCountAfter; i += 1) {
      const href = (await rowsAfter.nth(i).getAttribute("href")) ?? "";
      const text = (await rowsAfter.nth(i).innerText().catch(() => "")) || "";
      expectPinBrandingClean(text, `daftar pasca-search-clear row#${i}`);
      const before = baseline.find((r) => r.href === href);
      if (!before || !before.pin) continue;
      const afterPin = firstPinToken(text);
      if (afterPin) {
        expect(
          afterPin,
          `token PIN baris ${href} identik sebelum & sesudah alur search`,
        ).toBe(before.pin);
      }
    }

    // ── (e) Filter tab: Arsip → Aktif. Token PIN tiap baris masih clean.
    const arsipTab = page.getByRole("tab", { name: /^Arsip/i }).first();
    if ((await arsipTab.count()) > 0) {
      await arsipTab.click().catch(() => {});
      await page.waitForTimeout(300);
      const arsipRows = page.locator('a[href^="/chat/"]');
      const arsipCount = await arsipRows.count();
      for (let i = 0; i < arsipCount; i += 1) {
        const text = (await arsipRows.nth(i).innerText().catch(() => "")) || "";
        expectPinBrandingClean(text, `tab Arsip row#${i}`);
      }
    }
    const aktifTab = page.getByRole("tab", { name: /^Aktif/i }).first();
    if ((await aktifTab.count()) > 0) {
      await aktifTab.click().catch(() => {});
      await page.waitForTimeout(300);
    }

    // ── (f) Ketik query yang PASTI tidak match ('zzqxwvNOHIT'):
    //       panel "Tidak ada pesan yang cocok…" wajib bebas phone + PIN off-format.
    await searchInput2.fill("zzqxwvNOHIT");
    await page.waitForTimeout(500);
    const emptyPanelText =
      (await page.locator("body").innerText().catch(() => "")) || "";
    expect(
      containsRawIndoPhone(emptyPanelText),
      "panel 'tidak ada hasil' bebas nomor telp mentah",
    ).toBe(false);
    expectPinBrandingClean(emptyPanelText, "body saat pencarian tanpa hasil");
  });
});