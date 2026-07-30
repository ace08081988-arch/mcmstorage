import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import {
  containsRawIndoPhone,
  expectPinBrandingClean,
  extractPinTokens,
  PIN_MCM_FORMAT,
} from "./_helpers/chat-pin-assertions";

/**
 * E2E — token `PIN xxxx-xxxx` per DM WAJIB identik meski pengguna
 * mengubah:
 *   • Tab daftar percakapan: Aktif ↔ Arsip
 *   • Chip filter: Semua / Belum dibaca / Grup / Favorit
 *   • Urutan (terbaru/terlama) — bila kontrol urut tersedia; jika
 *     UI belum menyediakannya, bagian tersebut di-skip alih-alih
 *     bikin flaky.
 *
 * Selama seluruh interaksi:
 *   - Tidak ada nomor telp Indonesia mentah di DOM.
 *   - Untuk `href` yang sama, token PIN identik dengan snapshot awal.
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

type Snap = { href: string; pin: string };

async function snapshotRows(page: import("@playwright/test").Page): Promise<Snap[]> {
  const rows = page.locator('a[href^="/chat/"]');
  const n = await rows.count();
  const out: Snap[] = [];
  for (let i = 0; i < n; i += 1) {
    const href = (await rows.nth(i).getAttribute("href")) ?? "";
    const text = (await rows.nth(i).innerText().catch(() => "")) || "";
    const aria = (await rows.nth(i).getAttribute("aria-label").catch(() => "")) || "";
    const combined = `${text}\n${aria}`;
    expectPinBrandingClean(combined, `row snapshot ${href}`);
    out.push({ href, pin: firstPin(combined) });
  }
  return out;
}

function assertConsistent(baseline: Snap[], after: Snap[], label: string): void {
  const map = new Map(baseline.filter((s) => s.pin).map((s) => [s.href, s.pin]));
  for (const cur of after) {
    if (!cur.pin) continue;
    const base = map.get(cur.href);
    if (!base) continue; // baris tidak ada di baseline (mis. arsip-only)
    expect(cur.pin, `token PIN untuk ${cur.href} identik pada ${label}`).toBe(base);
  }
}

test.describe("konsistensi PIN xxxx-xxxx lintas filter, tab, & urutan", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("token PIN per DM identik saat mengganti tab Aktif/Arsip, chip filter, dan urutan", async ({
    page,
  }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    // Baseline: tab Aktif, chip Semua.
    const baseline = await snapshotRows(page);
    test.skip(baseline.length === 0, "Belum ada DM — skip.");

    const bodyText0 = (await page.locator("body").innerText().catch(() => "")) || "";
    expect(
      containsRawIndoPhone(bodyText0),
      "baseline /chat bebas nomor telp mentah",
    ).toBe(false);

    // ── Chip filter: Belum dibaca → Grup → Favorit → Semua.
    const chips = ["Belum dibaca", "Grup", "Favorit", "Semua"];
    for (const label of chips) {
      const chip = page.getByRole("button", { name: new RegExp(`^${label}`, "i") }).first();
      if ((await chip.count()) === 0) continue;
      await chip.click().catch(() => {});
      await page.waitForTimeout(300);
      const snap = await snapshotRows(page);
      const body = (await page.locator("body").innerText().catch(() => "")) || "";
      expect(
        containsRawIndoPhone(body),
        `chip filter "${label}" bebas nomor telp mentah`,
      ).toBe(false);
      assertConsistent(baseline, snap, `chip "${label}"`);
    }

    // ── Tab Arsip → snapshot → kembali ke Aktif.
    const arsipTab = page.getByRole("tab", { name: /^Arsip/i }).first();
    if ((await arsipTab.count()) > 0) {
      await arsipTab.click().catch(() => {});
      await page.waitForTimeout(400);
      const arsipSnap = await snapshotRows(page);
      const arsipBody = (await page.locator("body").innerText().catch(() => "")) || "";
      expect(
        containsRawIndoPhone(arsipBody),
        "tab Arsip bebas nomor telp mentah",
      ).toBe(false);
      // Baris di arsip mungkin berbeda; token identik hanya untuk href yang
      // muncul di baseline (jika sebelumnya di aktif lalu diarsipkan runtime).
      assertConsistent(baseline, arsipSnap, "tab Arsip");
    }
    const aktifTab = page.getByRole("tab", { name: /^Aktif/i }).first();
    if ((await aktifTab.count()) > 0) {
      await aktifTab.click().catch(() => {});
      await page.waitForTimeout(400);
      const back = await snapshotRows(page);
      assertConsistent(baseline, back, "kembali ke tab Aktif");
    }

    // ── Urutan (terbaru/terlama) — hanya kalau UI menyediakannya.
    const sortCandidates = [
      page.getByRole("button", { name: /Terlama/i }).first(),
      page.getByRole("menuitem", { name: /Terlama/i }).first(),
      page.getByRole("radio", { name: /Terlama/i }).first(),
    ];
    let sortToggled = false;
    for (const c of sortCandidates) {
      if ((await c.count()) > 0 && (await c.isVisible().catch(() => false))) {
        await c.click().catch(() => {});
        await page.waitForTimeout(300);
        sortToggled = true;
        break;
      }
    }
    if (sortToggled) {
      const sortedSnap = await snapshotRows(page);
      const sortedBody = (await page.locator("body").innerText().catch(() => "")) || "";
      expect(
        containsRawIndoPhone(sortedBody),
        "urutan Terlama bebas nomor telp mentah",
      ).toBe(false);
      assertConsistent(baseline, sortedSnap, "urutan Terlama");

      // Balik ke Terbaru bila kontrolnya ada.
      const back = page.getByRole("button", { name: /Terbaru/i }).first();
      if ((await back.count()) > 0) {
        await back.click().catch(() => {});
        await page.waitForTimeout(300);
        const finalSnap = await snapshotRows(page);
        assertConsistent(baseline, finalSnap, "urutan Terbaru (kembali)");
      }
    } else {
      test.info().annotations.push({
        type: "note",
        description:
          "Kontrol urut (Terbaru/Terlama) belum tersedia di UI /chat — bagian urutan di-skip.",
      });
    }
  });
});
