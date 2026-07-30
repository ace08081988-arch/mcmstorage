import { test, expect, type Locator, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import {
  PIN_MCM_FORMAT,
  containsRawIndoPhone,
  extractPinTokens,
} from "./_helpers/chat-pin-assertions";
import {
  armPinChangeTracing,
  capturePinChangeArtifacts,
} from "./_helpers/pin-change-capture";

/**
 * E2E — konsistensi `PIN xxxx-xxxx` pada BARIS YANG BARU DIMOUNT saat
 * scroll di daftar percakapan `/chat` (virtualized/lazy list), termasuk
 * skenario scroll cepat bolak-balik. Tujuan spesifik yang berbeda dari
 * `chat-pin-mcm-list-pagination.spec.ts`:
 *
 *   1. Merekam kanonik token PIN per `href` di seluruh set (baseline
 *      "full sweep" — scroll pelan dari atas ke bawah supaya SEMUA baris
 *      sempat dimount minimal sekali).
 *   2. Melakukan **rapid oscillation** — scroll ke bawah lalu ke atas
 *      berulang tanpa jeda panjang, memaksa virtual list me-unmount &
 *      me-remount baris yang sama. Setiap kali baris ter-remount, token
 *      PIN yang dibaca WAJIB identik dengan kanonik dan TIDAK boleh
 *      sesaat berupa nomor telp Indonesia mentah.
 *   3. Sampling frekuensi tinggi selama oscillation (poll `innerText`
 *      per ~80ms) untuk menangkap frame transisi — mirip pola yang
 *      dipakai spec throttled reload, tapi di sini pemicunya adalah
 *      mount/unmount virtualisasi, bukan network.
 */

const STORAGE = "tests/visual/.auth/user.json";
const OSCILLATION_WAVES = 8;
const SAMPLE_INTERVAL_MS = 80;
const SAMPLE_WINDOW_MS = 900;

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

type RowSnapshot = { href: string; text: string; pinToken: string | null };

async function scrollContainer(page: Page, top: number | "bottom"): Promise<void> {
  await page.evaluate((arg) => {
    const container =
      document.querySelector<HTMLElement>('[data-testid="chat-list-scroll"]') ||
      document.querySelector<HTMLElement>("main [data-radix-scroll-area-viewport]") ||
      document.querySelector<HTMLElement>("main");
    const target = arg === "bottom" ? Number.MAX_SAFE_INTEGER : (arg as number);
    if (container) container.scrollTop = target;
    window.scrollTo(0, target === Number.MAX_SAFE_INTEGER ? document.body.scrollHeight : target);
  }, top);
}

async function snapshotVisibleRows(rows: Locator): Promise<RowSnapshot[]> {
  const total = await rows.count();
  const out: RowSnapshot[] = [];
  for (let i = 0; i < total; i += 1) {
    const row = rows.nth(i);
    const href = (await row.getAttribute("href").catch(() => "")) || "";
    const text = (await row.innerText().catch(() => "")) || "";
    const aria = (await row.getAttribute("aria-label").catch(() => "")) || "";
    const combined = `${text}\n${aria}`;
    const tokens = extractPinTokens(combined);
    out.push({ href, text: combined, pinToken: tokens[0] ?? null });
  }
  return out;
}

function enforceRows(snapshot: RowSnapshot[], phase: string): void {
  snapshot.forEach((row, i) => {
    expect(
      containsRawIndoPhone(row.text),
      `${phase} row#${i} (${row.href}) wajib bebas nomor telp Indonesia mentah`,
    ).toBe(false);
    if (row.pinToken) {
      expect(
        row.pinToken,
        `${phase} row#${i} (${row.href}) token PIN wajib format PIN xxxx-xxxx`,
      ).toMatch(PIN_MCM_FORMAT);
    }
  });
}

async function reconcileCanonical(
  page: Page,
  testInfo: import("@playwright/test").TestInfo,
  canonical: Map<string, string>,
  snapshot: RowSnapshot[],
  phase: string,
): Promise<void> {
  for (const row of snapshot) {
    if (!row.pinToken) continue;
    const existing = canonical.get(row.href);
    if (existing === undefined) {
      canonical.set(row.href, row.pinToken);
      continue;
    }
    if (row.pinToken !== existing) {
      // Artefak lebih dulu — expect di bawah akan menggagalkan test.
      await capturePinChangeArtifacts(page, testInfo, {
        href: row.href,
        prev: existing,
        next: row.pinToken,
        phase,
      });
    }
    expect(
      row.pinToken,
      `${phase}: token PIN berubah untuk ${row.href} "${existing}" → "${row.pinToken}"`,
    ).toBe(existing);
  }
}

async function pollBrandingDuringScroll(
  page: Page,
  testInfo: import("@playwright/test").TestInfo,
  rows: Locator,
  canonical: Map<string, string>,
  phase: string,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < SAMPLE_WINDOW_MS) {
    const snap = await snapshotVisibleRows(rows);
    enforceRows(snap, `${phase} @${Date.now() - start}ms`);
    await reconcileCanonical(page, testInfo, canonical, snap, `${phase} @${Date.now() - start}ms`);
    await page.waitForTimeout(SAMPLE_INTERVAL_MS);
  }
}

test.describe("chat list virtualized — PIN xxxx-xxxx stabil pada baris yang baru dimount", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("scroll cepat bolak-balik → tidak ada token PIN yang berubah, tidak ada phone leak", async ({
    page,
  }, testInfo) => {
    await armPinChangeTracing(page, testInfo);
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    const rows = page.locator('a[href^="/chat/"]');
    const initialCount = await rows.count();
    test.skip(initialCount === 0, "Belum ada DM di akun test — skip.");

    // Kanonik token PIN per href. Dibangun bertahap saat baris pertama
    // kali termunculkan; sekali terisi, tidak boleh berubah lagi.
    const canonical = new Map<string, string>();

    // ── Fase 1: full sweep pelan — atas → bawah → atas — supaya semua
    //           baris sempat dimount minimal sekali di viewport dan
    //           kanoniknya terekam.
    await scrollContainer(page, 0);
    await page.waitForTimeout(150);
    const sweepTop = await snapshotVisibleRows(rows);
    enforceRows(sweepTop, "sweep top");
    await reconcileCanonical(page, testInfo, canonical, sweepTop, "sweep top");

    await scrollContainer(page, "bottom");
    await page.waitForTimeout(250);
    const sweepBottom = await snapshotVisibleRows(rows);
    enforceRows(sweepBottom, "sweep bottom");
    await reconcileCanonical(page, testInfo, canonical, sweepBottom, "sweep bottom");

    await scrollContainer(page, 0);
    await page.waitForTimeout(150);
    const sweepBack = await snapshotVisibleRows(rows);
    enforceRows(sweepBack, "sweep back-to-top");
    await reconcileCanonical(page, testInfo, canonical, sweepBack, "sweep back-to-top");

    // ── Fase 2: rapid oscillation — memaksa unmount/remount virtual
    //           dengan target scroll yang berpindah cepat. Antar wave
    //           kita poll `innerText` frekuensi tinggi untuk menangkap
    //           frame transisi.
    for (let wave = 1; wave <= OSCILLATION_WAVES; wave += 1) {
      const target = wave % 2 === 0 ? 0 : "bottom";
      await scrollContainer(page, target as number | "bottom");
      await pollBrandingDuringScroll(page, testInfo, rows, canonical, `oscillation wave ${wave}`);
    }

    // ── Fase 3: konfirmasi akhir — kembali ke atas, verifikasi baris
    //           yang tampak masih memakai token kanonik yang sama.
    await scrollContainer(page, 0);
    await page.waitForTimeout(200);
    const finalSnap = await snapshotVisibleRows(rows);
    enforceRows(finalSnap, "final settle");
    await reconcileCanonical(page, testInfo, canonical, finalSnap, "final settle");

    expect(
      canonical.size,
      "Minimal satu baris kanonik dengan token PIN harus terekam sepanjang oscillation",
    ).toBeGreaterThan(0);
  });
});