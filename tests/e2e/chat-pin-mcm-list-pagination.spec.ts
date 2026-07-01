import { test, expect, type Locator, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import {
  PIN_MCM_FORMAT,
  containsRawIndoPhone,
  extractPinTokens,
} from "./_helpers/chat-pin-assertions";

/**
 * E2E — konsistensi format `PIN xxxx-xxxx` di DAFTAR PERCAKAPAN
 * (`/chat`) setelah paginasi / infinite scroll.
 *
 * Motivasi: regresi identitas peer paling sering muncul saat daftar
 * "mekar" (scroll ke bawah untuk virtualisasi / lazy render), pindah
 * antar tab (Aktif ↔ Arsip yang secara efektif memaginasi list slice
 * berbeda), atau setelah reload — cache TanStack Query bisa merehidrasi
 * dari state basi dan sesaat memunculkan nomor telp mentah.
 *
 * Kontrak yang ditegakkan:
 *   1. Setiap baris DM (`a[href^="/chat/"]`) di kedua tab wajib BEBAS
 *      nomor telp Indonesia mentah pada judul + snippet + aria-label.
 *   2. Token `PIN ...` yang muncul di baris apa pun WAJIB berformat
 *      `PIN XXXX-XXXX` (4-4, A-Z0-9).
 *   3. Token PIN per `href` bersifat STABIL — nilai yang tampil pada
 *      baseline harus identik setelah scroll berulang, sesudah pindah
 *      tab bolak-balik, dan sesudah `page.reload()`.
 *
 * Self-skip: butuh storageState hasil global-setup. Bila akun test
 * tidak punya DM sama sekali, seluruh runtime block di-skip supaya PR
 * eksternal tidak salah gagal.
 */

const STORAGE = "tests/visual/.auth/user.json";
const SCROLL_WAVES = 4;

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

type RowSnapshot = { href: string; text: string; aria: string; pinToken: string | null };

async function snapshotRows(rows: Locator): Promise<RowSnapshot[]> {
  const total = await rows.count();
  const out: RowSnapshot[] = [];
  for (let i = 0; i < total; i += 1) {
    const row = rows.nth(i);
    const href = (await row.getAttribute("href").catch(() => "")) || "";
    const text = (await row.innerText().catch(() => "")) || "";
    const aria = (await row.getAttribute("aria-label").catch(() => "")) || "";
    const combined = `${text}\n${aria}`;
    const tokens = extractPinTokens(combined);
    // Ambil token PIN pertama sebagai identitas kanonik baris.
    // Baris tanpa token PIN (mis. hanya display_name) tetap dicatat
    // dengan pinToken = null; kontrak "bebas nomor telp" tetap berlaku.
    out.push({ href, text: combined, aria, pinToken: tokens[0] ?? null });
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

/**
 * Bandingkan token PIN per `href` antara dua fase. Baris dengan
 * pinToken null diabaikan (misal kontak beralias display_name — tidak
 * ada regresi identitas yang bisa diukur). Baris baru yang muncul di
 * fase kedua (mis. DM baru masuk realtime) juga diabaikan; kita hanya
 * memastikan baris yang sudah pernah dilihat tidak MENGUBAH tokennya.
 */
function assertPinTokensStable(
  baseline: RowSnapshot[],
  next: RowSnapshot[],
  phase: string,
): void {
  const byHref = new Map(baseline.filter((r) => r.pinToken).map((r) => [r.href, r.pinToken!]));
  for (const row of next) {
    if (!row.pinToken) continue;
    const before = byHref.get(row.href);
    if (!before) continue;
    expect(
      row.pinToken,
      `${phase}: baris ${row.href} PIN berubah "${before}" → "${row.pinToken}"`,
    ).toBe(before);
  }
}

async function scrollListToBottom(page: Page): Promise<void> {
  await page.evaluate(() => {
    const container =
      document.querySelector<HTMLElement>('[data-testid="chat-list-scroll"]') ||
      document.querySelector<HTMLElement>("main [data-radix-scroll-area-viewport]") ||
      document.querySelector<HTMLElement>("main");
    if (container) container.scrollTop = container.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
  });
}

async function scrollListToTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const container =
      document.querySelector<HTMLElement>('[data-testid="chat-list-scroll"]') ||
      document.querySelector<HTMLElement>("main [data-radix-scroll-area-viewport]") ||
      document.querySelector<HTMLElement>("main");
    if (container) container.scrollTop = 0;
    window.scrollTo(0, 0);
  });
}

test.describe("chat list — PIN xxxx-xxxx konsisten pasca scroll/pagination/reload", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("daftar /chat: scroll wave × tab switch × reload → token PIN per baris stabil, no phone", async ({
    page,
  }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    const rows = page.locator('a[href^="/chat/"]');
    const initialCount = await rows.count();
    test.skip(initialCount === 0, "Belum ada DM di akun test — skip.");

    // ── Fase 1: baseline aktif tab.
    const baseline = await snapshotRows(rows);
    enforceRows(baseline, "baseline");

    // ── Fase 2: scroll wave — memicu virtualisasi / lazy render.
    for (let wave = 1; wave <= SCROLL_WAVES; wave += 1) {
      await scrollListToBottom(page);
      await page.waitForTimeout(200);
      await scrollListToTop(page);
      await page.waitForTimeout(200);
      const wavedSnap = await snapshotRows(rows);
      enforceRows(wavedSnap, `scroll wave ${wave}`);
      assertPinTokensStable(baseline, wavedSnap, `scroll wave ${wave}`);
    }

    // ── Fase 3: pindah tab Arsip (jika ada), verifikasi bebas phone
    //           & format PIN. Lalu kembali ke Aktif dan pastikan PIN
    //           per baris tidak "berpindah" identitas.
    const arsipTab = page.getByRole("tab", { name: /arsip/i });
    if ((await arsipTab.count()) > 0) {
      await arsipTab.first().click();
      await page.waitForTimeout(300);
      const arsipRows = page.locator('a[href^="/chat/"]');
      if ((await arsipRows.count()) > 0) {
        const arsipSnap = await snapshotRows(arsipRows);
        enforceRows(arsipSnap, "tab arsip");
        // Tab arsip mungkin berisi DM yang juga pernah muncul di aktif
        //   (mis. baru saja diarsipkan) — token PIN harus tetap sama.
        assertPinTokensStable(baseline, arsipSnap, "tab arsip vs baseline");
      }
      const aktifTab = page.getByRole("tab", { name: /aktif/i });
      if ((await aktifTab.count()) > 0) {
        await aktifTab.first().click();
        await page.waitForTimeout(300);
      }
    }

    // ── Fase 4: reload penuh — rehidrasi cache TanStack Query.
    await page.reload();
    await page.waitForLoadState("networkidle");
    const reloadedRows = page.locator('a[href^="/chat/"]');
    await expect(reloadedRows.first()).toBeVisible();
    const afterReload = await snapshotRows(reloadedRows);
    enforceRows(afterReload, "post-reload");
    assertPinTokensStable(baseline, afterReload, "post-reload vs baseline");

    // ── Fase 5: scroll wave PASCA-reload — cache basi tidak boleh
    //           memuntahkan nomor telp mentah saat item dirender ulang.
    for (let wave = 1; wave <= SCROLL_WAVES; wave += 1) {
      await scrollListToBottom(page);
      await page.waitForTimeout(150);
      await scrollListToTop(page);
      await page.waitForTimeout(150);
      const snap = await snapshotRows(reloadedRows);
      enforceRows(snap, `post-reload scroll wave ${wave}`);
      assertPinTokensStable(baseline, snap, `post-reload scroll wave ${wave}`);
    }
  });
});
