import { test, expect, type Locator } from "@playwright/test";

/**
 * E2E — label durasi voice note WAJIB tetap konsisten:
 *
 *  1. Setelah scroll bolak-balik di daftar virtualized-like (kontainer
 *     scrollable dengan banyak baris). Label tidak boleh sesaat berubah
 *     ke "00:00" saat baris masuk/keluar viewport.
 *  2. Setelah baris di-remount (React key berubah). `attachmentDurationSec`
 *     diteruskan sebagai prop `durationSec`, sehingga `VoiceNotePlayer`
 *     wajib menampilkan durasi kanonik ("00:03" pada harness) segera pada
 *     mount pertama — sebelum metadata audio termuat.
 *
 * Harness publik `/lovable/visual/voice-note-player` menyediakan 40 baris
 * dengan durasi kanonik 3 detik dan tombol "Remount rows" yang memaksa
 * setiap baris dilepas & dipasang ulang lewat key.
 */

const CANONICAL_LABEL = "00:03";
const ZERO_LABEL = "00:00";
const SAMPLE_INTERVAL_MS = 60;
const SAMPLE_WINDOW_MS = 700;

async function readLabel(row: Locator): Promise<string> {
  // Label durasi adalah span terakhir dalam bubble; ambil semua teks
  // baris lalu ekstrak token m:ss terakhir agar tahan terhadap markup.
  const text = (await row.innerText().catch(() => "")) || "";
  const matches = text.match(/\d{1,2}:\d{2}/g);
  return matches ? matches[matches.length - 1] : "";
}

async function assertAllRowsCanonical(page: import("@playwright/test").Page, phase: string) {
  const total = await page.locator("[data-vn-index]").count();
  for (let i = 0; i < total; i += 1) {
    const row = page.locator(`[data-vn-index="${i}"]`);
    const label = await readLabel(row);
    // Baris yang belum sempat render label penuh boleh kosong; TIDAK
    // boleh menampilkan "00:00" karena prop `durationSec=3` seharusnya
    // langsung menandai player siap.
    expect(label, `${phase} row#${i} label tidak boleh "${ZERO_LABEL}"`).not.toBe(ZERO_LABEL);
    if (label) {
      expect(label, `${phase} row#${i} label wajib ${CANONICAL_LABEL}`).toBe(CANONICAL_LABEL);
    }
  }
}

async function pollLabelsDuring(
  page: import("@playwright/test").Page,
  phase: string,
  windowMs = SAMPLE_WINDOW_MS,
) {
  const start = Date.now();
  while (Date.now() - start < windowMs) {
    await assertAllRowsCanonical(page, `${phase} @${Date.now() - start}ms`);
    await page.waitForTimeout(SAMPLE_INTERVAL_MS);
  }
}

test.describe("voice note — durasi konsisten pada remount + scroll bolak-balik", () => {
  test("scroll oscillation + remount tidak pernah menampilkan 0:00", async ({ page }) => {
    await page.goto("/lovable/visual/voice-note-player");
    const scroll = page.getByTestId("vn-scroll");
    await scroll.waitFor({ state: "visible" });
    // Tunggu baris pertama siap & label kanonik terlihat.
    await expect
      .poll(async () => readLabel(page.locator('[data-vn-index="0"]')), { timeout: 5_000 })
      .toBe(CANONICAL_LABEL);

    // Fase 1 — sweep pelan atas → bawah → atas, verifikasi semua baris
    // yang terpasang menampilkan label kanonik.
    await assertAllRowsCanonical(page, "initial");

    await scroll.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await pollLabelsDuring(page, "scroll-to-bottom");

    await scroll.evaluate((el) => {
      el.scrollTop = 0;
    });
    await pollLabelsDuring(page, "scroll-to-top");

    // Fase 2 — rapid oscillation, memaksa reflow & re-mount lokal saat
    // scroll cepat bolak-balik. Label tidak boleh flash ke "00:00".
    for (let wave = 0; wave < 6; wave += 1) {
      await scroll.evaluate((el, w) => {
        el.scrollTop = w % 2 === 0 ? el.scrollHeight : 0;
      }, wave);
      await pollLabelsDuring(page, `oscillation ${wave}`, 350);
    }

    // Fase 3 — remount penuh via tombol harness (React key berubah).
    // Pada mount pertama, prop `durationSec=3` harus langsung memberi
    // label kanonik tanpa menunggu metadata audio.
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await page.getByTestId("vn-remount").click();
      // Segera setelah remount, baris pertama wajib kanonik.
      await expect
        .poll(async () => readLabel(page.locator('[data-vn-index="0"]')), { timeout: 2_000 })
        .toBe(CANONICAL_LABEL);
      await assertAllRowsCanonical(page, `after remount ${cycle}`);
      // Setelah remount, scroll lagi untuk memastikan konsistensi lintas
      // remount + reflow terjaga.
      await scroll.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await pollLabelsDuring(page, `remount ${cycle} + scroll-bottom`, 350);
      await scroll.evaluate((el) => {
        el.scrollTop = 0;
      });
      await pollLabelsDuring(page, `remount ${cycle} + scroll-top`, 350);
    }
  });
});