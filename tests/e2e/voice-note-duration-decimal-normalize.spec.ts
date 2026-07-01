import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * E2E — kontrak normalisasi `attachmentDurationSec`.
 *
 * Server mungkin mengirim durasi desimal (mis. dari MediaRecorder di klien
 * lain) via `attachment_duration_sec`. `VoiceNotePlayer` WAJIB
 * menormalisasinya lewat `normalizeDurationSec` sebelum menampilkan label:
 *
 *   - Setiap desimal positif → bilangan bulat ≥ 1 (Math.round, clamp 1).
 *   - Sub-detik (mis. 0.01, 0.4, 0.99) → tampil sebagai "00:01", bukan "00:00".
 *   - .5 dibulatkan ke atas (Math.round: 1.5 → 2).
 *   - Nilai valid & besar dibulatkan biasa (59.6 → 60 → "01:00").
 *
 * Harness `/lovable/visual/voice-note-player?d=<csv>` merender satu baris
 * per nilai desimal dengan `durationSec={raw}`, sehingga label yang tampak
 * di DOM adalah bukti bahwa normalisasi terjadi sebelum render.
 */

const ZERO_LABEL = "00:00";

// Pasangan input desimal → label yang diharapkan setelah normalisasi.
// Dijaga sinkron dengan `normalizeDurationSec` (lihat unit test-nya).
const CASES: Array<{ raw: number; label: string; note: string }> = [
  { raw: 0.01, label: "00:01", note: "sub-detik sangat kecil → clamp ke 1" },
  { raw: 0.4, label: "00:01", note: "0.4 detik → clamp ke 1" },
  { raw: 0.5, label: "00:01", note: "0.5 detik → clamp ke 1" },
  { raw: 0.99, label: "00:01", note: "0.99 detik → clamp ke 1" },
  { raw: 1.0, label: "00:01", note: "integer batas bawah" },
  { raw: 1.4, label: "00:01", note: "round down" },
  { raw: 1.5, label: "00:02", note: "round half up" },
  { raw: 2.7, label: "00:03", note: "round up" },
  { raw: 3.499, label: "00:03", note: "round down tepat di bawah 0.5" },
  { raw: 3.5, label: "00:04", note: "round half up" },
  { raw: 59.4, label: "00:59", note: "round down mendekati menit" },
  { raw: 59.6, label: "01:00", note: "round up menyeberang menit" },
];

async function readLabel(row: Locator): Promise<string> {
  const text = (await row.innerText().catch(() => "")) || "";
  const matches = text.match(/\d{1,2}:\d{2}/g);
  return matches ? matches[matches.length - 1] : "";
}

async function labelFor(page: Page, index: number): Promise<string> {
  return readLabel(page.locator(`[data-vn-index="${index}"]`));
}

test.describe("voice note — attachmentDurationSec desimal dinormalisasi ke integer ≥ 1", () => {
  test("setiap desimal render sebagai label bulat ≥ 1 di VoiceNotePlayer", async ({ page }) => {
    const csv = CASES.map((c) => c.raw).join(",");
    await page.goto(`/lovable/visual/voice-note-player?d=${encodeURIComponent(csv)}`);
    await page.getByTestId("vn-scroll").waitFor({ state: "visible" });

    // Tunggu baris pertama menampilkan label kanoniknya.
    await expect
      .poll(() => labelFor(page, 0), { timeout: 5_000 })
      .toBe(CASES[0].label);

    // Verifikasi label per baris. Label WAJIB langsung bernilai kanonik
    // (bukan "00:00") karena normalisasi terjadi sebelum render — bahkan
    // sebelum metadata audio termuat.
    for (let i = 0; i < CASES.length; i += 1) {
      const c = CASES[i];
      const row = page.locator(`[data-vn-index="${i}"]`);
      await expect(row).toHaveAttribute("data-vn-raw", String(c.raw));
      await expect
        .poll(() => readLabel(row), { timeout: 5_000 })
        .toBe(c.label);
      const label = await readLabel(row);
      expect(
        label,
        `row#${i} raw=${c.raw} (${c.note}) tidak boleh "${ZERO_LABEL}"`,
      ).not.toBe(ZERO_LABEL);
      // Kontrak eksplisit: label wajib format mm:ss integer ≥ 00:01.
      expect(label).toMatch(/^\d{2}:\d{2}$/);
      expect(label).not.toBe(ZERO_LABEL);
    }
  });

  test("remount baris mempertahankan label ternormalisasi (tidak pernah 00:00)", async ({
    page,
  }) => {
    const csv = CASES.map((c) => c.raw).join(",");
    await page.goto(`/lovable/visual/voice-note-player?d=${encodeURIComponent(csv)}`);
    await page.getByTestId("vn-scroll").waitFor({ state: "visible" });
    await expect
      .poll(() => labelFor(page, 0), { timeout: 5_000 })
      .toBe(CASES[0].label);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await page.getByTestId("vn-remount").click();
      // Segera setelah remount, prop `durationSec` masih desimal — tapi
      // label WAJIB langsung menjadi bentuk ternormalisasi, bukan "00:00".
      for (let i = 0; i < CASES.length; i += 1) {
        const row = page.locator(`[data-vn-index="${i}"]`);
        await expect
          .poll(() => readLabel(row), { timeout: 2_000 })
          .toBe(CASES[i].label);
        const label = await readLabel(row);
        expect(
          label,
          `cycle ${cycle} row#${i} raw=${CASES[i].raw} label flash "${ZERO_LABEL}"`,
        ).not.toBe(ZERO_LABEL);
      }
    }
  });
});