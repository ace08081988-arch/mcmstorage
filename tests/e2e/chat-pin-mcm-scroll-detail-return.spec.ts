import { test, expect, type Locator, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import {
  PIN_MCM_FORMAT,
  containsRawIndoPhone,
  expectPinBrandingClean,
  extractPinTokens,
  readHeaderIdentity,
} from "./_helpers/chat-pin-assertions";

/**
 * E2E — Alur "scroll → buka detail baris baru dimount → kembali → scroll
 * lagi". Fokus verifikasi:
 *
 *   1. Scroll daftar `/chat` sampai ada baris yang SEBELUMNYA belum
 *      terlihat dan baru saja dimount oleh virtual list.
 *   2. Buka panel detail (`/chat/:id`) untuk baris tersebut; PIN pada
 *      header WAJIB identik dengan PIN yang tampak di baris daftar.
 *   3. Kembali (`history.back`) ke daftar; PIN untuk baris yang sama
 *      TIDAK boleh berubah, lalu setelah scroll tambahan (unmount/remount
 *      baris tsb) PIN tetap sama pula.
 *
 * Berbeda dari `chat-pin-mcm-virtualized-scroll.spec.ts` (fokus mount/
 * unmount murni tanpa navigasi) dan `chat-pin-mcm-search-detail-refine`
 * (pemicu detail = search, bukan scroll).
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

async function scrollListTo(page: Page, target: number | "bottom"): Promise<void> {
  await page.evaluate((arg) => {
    const container =
      document.querySelector<HTMLElement>('[data-testid="chat-list-scroll"]') ||
      document.querySelector<HTMLElement>("main [data-radix-scroll-area-viewport]") ||
      document.querySelector<HTMLElement>("main");
    const t = arg === "bottom" ? Number.MAX_SAFE_INTEGER : (arg as number);
    if (container) container.scrollTop = t;
    window.scrollTo(0, arg === "bottom" ? document.body.scrollHeight : (arg as number));
  }, target);
}

async function snapshotRowsByHref(
  rows: Locator,
): Promise<Map<string, { text: string; pin: string }>> {
  const total = await rows.count();
  const map = new Map<string, { text: string; pin: string }>();
  for (let i = 0; i < total; i += 1) {
    const row = rows.nth(i);
    const href = (await row.getAttribute("href").catch(() => "")) || "";
    if (!href) continue;
    const text = (await row.innerText().catch(() => "")) || "";
    const aria = (await row.getAttribute("aria-label").catch(() => "")) || "";
    const combined = `${text}\n${aria}`;
    map.set(href, { text: combined, pin: firstPin(combined) });
  }
  return map;
}

test.describe("scroll → buka detail baris baru dimount → kembali: PIN xxxx-xxxx identik", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("header detail = PIN baris; setelah kembali dan scroll lagi PIN tetap sama", async ({
    page,
  }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    const rows = page.locator('a[href^="/chat/"]');
    const initialCount = await rows.count();
    test.skip(initialCount === 0, "Belum ada DM di akun test — skip.");

    // ── (1) Snapshot baris yang terlihat di puncak.
    await scrollListTo(page, 0);
    await page.waitForTimeout(150);
    const topSnap = await snapshotRowsByHref(rows);
    for (const [href, s] of topSnap) {
      expect(
        containsRawIndoPhone(s.text),
        `baris atas (${href}) bebas nomor telp mentah`,
      ).toBe(false);
    }

    // ── (2) Scroll ke bawah supaya baris yang belum pernah terlihat
    //        (di luar snapshot puncak) sempat dimount.
    await scrollListTo(page, "bottom");
    await page.waitForTimeout(300);
    const bottomSnap = await snapshotRowsByHref(rows);

    // Pilih target: href yang muncul di bottomSnap tapi TIDAK di topSnap,
    // dan punya PIN token. Kalau tidak ada (list pendek), fallback ke
    // baris manapun di bottomSnap yang punya PIN.
    let targetHref = "";
    let targetPin = "";
    for (const [href, s] of bottomSnap) {
      if (!s.pin) continue;
      if (!topSnap.has(href)) {
        targetHref = href;
        targetPin = s.pin;
        break;
      }
    }
    if (!targetHref) {
      for (const [href, s] of bottomSnap) {
        if (s.pin) {
          targetHref = href;
          targetPin = s.pin;
          break;
        }
      }
    }
    test.skip(
      !targetHref || !targetPin,
      "Tidak menemukan baris dengan PIN token untuk dibuka — skip.",
    );

    // ── (3) Buka detail baris target; header WAJIB menampilkan PIN sama.
    const targetRow = page.locator(`a[href="${targetHref}"]`).first();
    await targetRow.scrollIntoViewIfNeeded().catch(() => {});
    await targetRow.click();
    await page.waitForURL(`**${targetHref}`);
    await page.waitForLoadState("networkidle");

    const header = await readHeaderIdentity(page);
    expectPinBrandingClean(header, "header detail pasca-klik baris baru dimount");
    expect(
      firstPin(header),
      `PIN header detail (${targetHref}) identik dengan PIN baris daftar`,
    ).toBe(targetPin);

    // ── (4) Kembali ke daftar via history.back — bukan navigasi ulang,
    //        supaya state list (scroll + virtualisasi) dipertahankan.
    await page.goBack();
    await page.waitForURL("**/chat");
    await page.waitForLoadState("networkidle");

    const afterBack = await snapshotRowsByHref(rows);
    const backEntry = afterBack.get(targetHref);
    if (backEntry) {
      expect(
        containsRawIndoPhone(backEntry.text),
        `baris ${targetHref} pasca-back bebas nomor telp mentah`,
      ).toBe(false);
      expect(
        backEntry.pin,
        `PIN baris ${targetHref} pasca-back identik dengan sebelum masuk detail`,
      ).toBe(targetPin);
    }

    // ── (5) Scroll tambahan: paksa baris target unmount lalu remount,
    //        lalu verifikasi PIN-nya masih identik.
    await scrollListTo(page, 0);
    await page.waitForTimeout(200);
    await scrollListTo(page, "bottom");
    await page.waitForTimeout(300);

    const afterScroll = await snapshotRowsByHref(rows);
    const remountEntry = afterScroll.get(targetHref);
    if (remountEntry && remountEntry.pin) {
      expect(
        containsRawIndoPhone(remountEntry.text),
        `baris ${targetHref} pasca-remount bebas nomor telp mentah`,
      ).toBe(false);
      expect(
        remountEntry.pin,
        `PIN baris ${targetHref} pasca-scroll remount identik dengan baseline`,
      ).toBe(targetPin);
    }
  });
});
