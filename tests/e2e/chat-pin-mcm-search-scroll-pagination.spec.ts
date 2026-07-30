import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import {
  containsRawIndoPhone,
  expectPinBrandingClean,
  extractPinTokens,
  PIN_MCM_FORMAT,
} from "./_helpers/chat-pin-assertions";
import {
  armPinChangeTracing,
  capturePinChangeArtifacts,
} from "./_helpers/pin-change-capture";

/**
 * E2E — token `PIN xxxx-xxxx` peer WAJIB identik dan bebas nomor telp
 * mentah pada seluruh hit hasil pencarian selama:
 *   • pengguna menerapkan query di kotak "Cari…"
 *   • lalu men-scroll panel hasil (infinite scroll) atau menekan
 *     tombol "Muat lebih banyak / Load more" (paginasi manual)
 *
 * Untuk hit yang muncul beberapa kali (mis. baris DM yang sama masih
 * ada setelah load-more atau saat filter tab berubah), token PIN-nya
 * wajib IDENTIK di setiap kemunculan yang baru dimount.
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

type HitSnap = { key: string; pin: string };

async function snapshotHits(
  page: import("@playwright/test").Page,
  label: string,
): Promise<HitSnap[]> {
  const hitButtons = page.locator('div.rounded-lg.border ul li button');
  const n = await hitButtons.count();
  const out: HitSnap[] = [];
  for (let i = 0; i < n; i += 1) {
    const txt = (await hitButtons.nth(i).innerText().catch(() => "")) || "";
    expectPinBrandingClean(txt, `${label} hit#${i}`);
    const pin = firstPin(txt);
    // Key stabil per hit: judul (baris pertama) + snippet baris kedua bila ada.
    const lines = txt.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const key = `${lines[0] ?? ""}|${lines[1] ?? ""}`;
    if (pin) out.push({ key, pin });
  }
  return out;
}

async function assertHitPinsIdentical(
  page: import("@playwright/test").Page,
  testInfo: import("@playwright/test").TestInfo,
  base: HitSnap[],
  after: HitSnap[],
  label: string,
): Promise<void> {
  const map = new Map<string, string>();
  for (const s of base) {
    const prev = map.get(s.key);
    if (prev) {
      expect(prev, `PIN duplikat key "${s.key}" identik dalam baseline`).toBe(s.pin);
    } else {
      map.set(s.key, s.pin);
    }
  }
  for (const s of after) {
    const prev = map.get(s.key);
    if (!prev) {
      map.set(s.key, s.pin); // hit baru pasca load-more — catat.
      continue;
    }
    if (prev !== s.pin) {
      await capturePinChangeArtifacts(page, testInfo, {
        href: s.key,
        prev,
        next: s.pin,
        phase: label,
      });
    }
    expect(prev, `PIN untuk hit "${s.key}" identik pada ${label}`).toBe(s.pin);
  }
}

test.describe("konsistensi PIN xxxx-xxxx di hasil pencarian selama scroll/paginasi", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("token PIN tetap identik di setiap hit pencarian saat scroll & load-more", async ({
    page,
  }, testInfo) => {
    await armPinChangeTracing(page, testInfo);
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    const searchInput = page.locator('input[placeholder="Cari…"]').first();
    await expect(searchInput, "kotak Cari… harus tersedia").toBeVisible();

    // ── Pilih needle dari baris daftar; kalau kosong, fallback ke "a" (huruf umum).
    const rows = page.locator('a[href^="/chat/"]');
    const rowCount = await rows.count();
    test.skip(rowCount === 0, "Belum ada DM di akun test — skip.");

    let needle = "";
    for (let i = 0; i < rowCount; i += 1) {
      const text = (await rows.nth(i).innerText().catch(() => "")) || "";
      const w =
        text
          .split(/\s+/)
          .map((s) => s.trim())
          .find(
            (s) =>
              /^[A-Za-z][A-Za-z0-9]{1,}$/.test(s) &&
              !/^PIN$/i.test(s) &&
              !/^(Arsip|Aktif|Baru|Anda|Kontak|Chat|Semua|Grup|Favorit)$/i.test(s),
          ) ?? "";
      if (w) { needle = w.slice(0, 2); break; } // 2 huruf → cakupan hit lebih luas
    }
    if (!needle) needle = "a";

    await searchInput.fill(needle);
    await page.waitForTimeout(700); // debounce

    const bodyEarly = (await page.locator("body").innerText().catch(() => "")) || "";
    expect(
      containsRawIndoPhone(bodyEarly),
      "panel pencarian awal bebas nomor telp mentah",
    ).toBe(false);

    // Panel hasil pencarian.
    const panel = page.locator("div.rounded-lg.border").filter({
      has: page.locator("ul li button, div:has-text('Tidak ada pesan')"),
    }).first();
    await expect(panel, "panel hasil pencarian tampil").toBeVisible();

    // Snapshot awal.
    const initialHits = await snapshotHits(page, "hits awal");
    test.skip(
      initialHits.length === 0,
      "Query needle tidak menghasilkan hit apapun — skip.",
    );

    // ── Loop scroll panel hasil + klik tombol load-more bila ada.
    const scrollContainer = page.locator(
      "div.rounded-lg.border div[class*='overflow'], div.rounded-lg.border ul",
    ).first();

    const loadMoreRe = /Muat lebih|Load more|Selengkapnya|Lainnya/i;
    let lastCount = initialHits.length;
    let cumulative = initialHits.slice();

    for (let step = 0; step < 6; step += 1) {
      // Coba klik load-more kalau ada.
      const btn = page.getByRole("button", { name: loadMoreRe }).first();
      if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
        await btn.click().catch(() => {});
        await page.waitForTimeout(500);
      } else {
        // Fallback: scroll panel sampai bottom untuk memicu infinite loader.
        await scrollContainer.evaluate((el) => {
          (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight;
        }).catch(async () => {
          await page.mouse.wheel(0, 1200);
        });
        await page.waitForTimeout(500);
      }

      const bodyNow = (await page.locator("body").innerText().catch(() => "")) || "";
      expect(
        containsRawIndoPhone(bodyNow),
        `panel pencarian bebas nomor telp mentah pada step#${step}`,
      ).toBe(false);

      const snap = await snapshotHits(page, `hits step#${step}`);
      await assertHitPinsIdentical(page, testInfo, cumulative, snap, `scroll/load-more step#${step}`);
      // Perbarui baseline kumulatif dengan hit yang baru terlihat.
      cumulative = snap.length >= cumulative.length ? snap : cumulative;

      if (snap.length === lastCount) {
        // Tidak ada penambahan → hasil sudah habis; hentikan loop.
        if (step >= 1) break;
      }
      lastCount = snap.length;
    }

    // ── Refine query (append 1 huruf) → hit yang tetap muncul WAJIB pakai PIN yang sama.
    const refined = needle + (needle.charAt(0) || "a");
    await searchInput.fill(refined);
    await page.waitForTimeout(700);
    const bodyRefine = (await page.locator("body").innerText().catch(() => "")) || "";
    expect(
      containsRawIndoPhone(bodyRefine),
      "panel pasca-refine bebas nomor telp mentah",
    ).toBe(false);
    const refineSnap = await snapshotHits(page, "hits pasca-refine");
    await assertHitPinsIdentical(page, testInfo, cumulative, refineSnap, "refine query (append)");
  });
});
