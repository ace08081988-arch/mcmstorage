import { test, expect, type Locator } from "@playwright/test";

/**
 * Memverifikasi bahwa label durasi mm:ss identik antar TIGA permukaan
 * attachment yang berbeda pada baris yang sama:
 *   1. `VoiceNotePlayer` — pemutar bubble penerima.
 *   2. `MessageAttachment` cabang `audio/*` — mendelegasikan ke
 *      VoiceNotePlayer di produksi; di harness direplikasi tanpa
 *      network (`signedChatUrl`) supaya spec offline-safe.
 *   3. `VoiceRecorderButton` (formula pengirim) —
 *      `formatDurationMMSS(normalizeDurationSec(seconds) ?? 1)` yang
 *      dipakai saat kirim, menghasilkan nilai `attachment_duration_sec`
 *      yang lalu dibaca pemutar.
 *
 * Kontrak yang diuji:
 *   - Untuk deretan nilai desimal (sub-detik s/d menit), ketiga label
 *     langsung sama dengan hasil `formatDurationMMSS(normalizeDurationSec(raw) ?? 1)`
 *     (integer ≥ 1) — tidak pernah "00:00" dan tidak pernah "—:—".
 *   - Setelah baris di-remount (React key baru), label tetap identik
 *     dan tetap konsisten antar surface — tidak "melompat" saat audio
 *     belum siap.
 *
 * Harness: `/lovable/visual/attachment-duration-consistency?d=<csv>`
 * — publik, no-auth, no-network.
 */

const DECIMALS = [
  "0.01",
  "0.4",
  "0.5",
  "0.99",
  "1",
  "1.4",
  "1.5",
  "2.7",
  "3.499",
  "3.5",
  "59.4",
  "59.6",
];

/** Ambil label mm:ss dari VoiceNotePlayer (span terakhir di footer). */
async function readVnpLabel(cell: Locator): Promise<string> {
  // Footer VoiceNotePlayer: `<div class="flex ..."><span>Voice note</span><span>{label}</span></div>`
  return cell.locator("span").last().innerText();
}

/** Baris harness untuk index i. */
function rowLocator(page: import("@playwright/test").Page, i: number): Locator {
  return page.locator(`[data-testid="ad-row"][data-ad-index="${i}"]`);
}

async function assertRow(
  page: import("@playwright/test").Page,
  i: number,
  phase: string,
): Promise<void> {
  const row = rowLocator(page, i);
  await expect(row, `${phase}: row #${i} harus mount`).toBeVisible();
  const expected = await row.getAttribute("data-ad-expected");
  const raw = await row.getAttribute("data-ad-raw");
  expect(expected, `${phase}: row #${i} data-ad-expected wajib ada`).toMatch(
    /^\d{2}:\d{2}$/,
  );
  expect(expected).not.toBe("00:00");

  const vnp = row.locator('[data-surface="vnp"]');
  const msg = row.locator('[data-surface="msg"]');
  const vrb = row.locator('[data-testid="vrb-label"]');

  const vnpLabel = await readVnpLabel(vnp);
  const msgLabel = await readVnpLabel(msg);
  const vrbLabel = (await vrb.innerText()).trim();

  expect(
    vnpLabel,
    `${phase}: VoiceNotePlayer label (raw=${raw}) harus = ${expected}`,
  ).toBe(expected);
  expect(
    msgLabel,
    `${phase}: MessageAttachment audio label (raw=${raw}) harus = ${expected}`,
  ).toBe(expected);
  expect(
    vrbLabel,
    `${phase}: VoiceRecorderButton label (raw=${raw}) harus = ${expected}`,
  ).toBe(expected);

  for (const [name, v] of [
    ["vnp", vnpLabel],
    ["msg", msgLabel],
    ["vrb", vrbLabel],
  ] as const) {
    expect(v, `${phase}: ${name} label (raw=${raw}) tidak boleh 00:00`).not.toBe(
      "00:00",
    );
    expect(v, `${phase}: ${name} label (raw=${raw}) tidak boleh placeholder`).not.toBe(
      "—:—",
    );
    expect(
      v,
      `${phase}: ${name} label (raw=${raw}) wajib mm:ss dua digit`,
    ).toMatch(/^\d{2}:\d{2}$/);
  }
}

test.describe("attachment duration consistency — formatDurationMMSS", () => {
  test("label mm:ss identik antar VoiceNotePlayer / MessageAttachment / VoiceRecorderButton untuk desimal & setelah remount", async ({
    page,
  }) => {
    await page.goto(
      `/lovable/visual/attachment-duration-consistency?d=${DECIMALS.join(",")}`,
    );
    await page.waitForSelector('[data-testid="ad-row"][data-ad-index="0"]');

    // Fase awal: semua baris.
    for (let i = 0; i < DECIMALS.length; i++) {
      await assertRow(page, i, "initial");
    }

    // Remount: force key baru, harus tetap konsisten dan tidak flash "00:00".
    await page.getByTestId("ad-remount").click();
    await page.waitForSelector('[data-testid="ad-row"][data-ad-index="0"]');
    for (let i = 0; i < DECIMALS.length; i++) {
      await assertRow(page, i, "after-remount");
    }

    // Remount kedua untuk memastikan tidak ada flicker antar-cycle
    // (label harus stabil, bukan "0:00 → 00:01").
    await page.getByTestId("ad-remount").click();
    await page.waitForSelector('[data-testid="ad-row"][data-ad-index="0"]');
    for (let i = 0; i < DECIMALS.length; i++) {
      await assertRow(page, i, "after-remount-2");
    }
  });

  test("expected label per baris sesuai formula normalizeDurationSec ≥ 1", async ({
    page,
  }) => {
    // Cross-check: `data-ad-expected` yang dihitung di harness (produksi
    // formula) sama dengan hasil formatDurationMMSS(Math.max(1, Math.round(raw)))
    // untuk raw > 0, dan "00:01" untuk raw sub-detik positif.
    await page.goto(
      `/lovable/visual/attachment-duration-consistency?d=${DECIMALS.join(",")}`,
    );
    await page.waitForSelector('[data-testid="ad-row"][data-ad-index="0"]');

    for (let i = 0; i < DECIMALS.length; i++) {
      const row = rowLocator(page, i);
      const raw = Number(await row.getAttribute("data-ad-raw"));
      const expected = await row.getAttribute("data-ad-expected");
      const norm = raw > 0 ? Math.max(1, Math.round(raw)) : 1;
      const m = Math.floor(norm / 60);
      const s = norm % 60;
      const wanted = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      expect(expected, `row #${i} raw=${raw}`).toBe(wanted);
    }
  });
});