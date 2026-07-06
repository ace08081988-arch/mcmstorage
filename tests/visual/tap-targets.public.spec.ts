/**
 * Audit tap-target: memastikan setiap tombol di harness
 * `/lovable/visual/tap-targets` memenuhi ambang 44px untuk mobile.
 *
 * - `[data-tap-target][data-tap-target-kind="text"]`: tinggi ≥ 44px.
 * - `[data-tap-target][data-tap-target-kind="icon"]`: tinggi ≥ 44px
 *   DAN lebar ≥ 44px (target sentuh persegi).
 * - Tombol dalam `[data-action-row]`: jarak antar-tombol tetangga
 *   (baik horizontal maupun vertikal, tergantung layout kontainer)
 *   ≥ 8px supaya jempol tidak salah tap.
 *
 * Snapshot PNG juga direkam supaya perubahan padding/gap yang lolos
 * threshold numerik tetap terlihat lewat visual regression.
 *
 * Jalankan: `bun run test:tap-targets` (project `tap-targets`).
 * URL harness: /lovable/visual/tap-targets (no auth, no network).
 */
import { test, expect } from "@playwright/test";

const MIN_TAP_PX = 44;
const MIN_GAP_PX = 8;

type Measured = {
  index: number;
  kind: "text" | "icon";
  label: string;
  width: number;
  height: number;
  row: number;
};

type RowGap = {
  row: number;
  aIndex: number;
  bIndex: number;
  gap: number;
  axis: "x" | "y";
};

test.describe("tap targets — mobile", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lovable/visual/tap-targets", { waitUntil: "networkidle" });
    await page.evaluate(() => (document as unknown as { fonts?: FontFaceSet }).fonts?.ready);
  });

  test("semua tombol ≥ 44px & gap ≥ 8px", async ({ page }) => {
    const { measured, gaps } = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("[data-action-row]"));
      const measured: Measured[] = [];
      const gaps: RowGap[] = [];
      rows.forEach((row, rIdx) => {
        const btns = Array.from(
          row.querySelectorAll<HTMLElement>("[data-tap-target]"),
        );
        const rects = btns.map((b) => b.getBoundingClientRect());
        btns.forEach((b, i) => {
          const r = rects[i];
          measured.push({
            index: measured.length,
            kind: (b.getAttribute("data-tap-target-kind") as "text" | "icon") ?? "text",
            label: (b.getAttribute("aria-label") ?? b.textContent ?? "").trim().slice(0, 40),
            width: r.width,
            height: r.height,
            row: rIdx,
          });
        });
        // Gap antar-tetangga di dalam baris.
        for (let i = 1; i < rects.length; i++) {
          const prev = rects[i - 1];
          const cur = rects[i];
          const sameLine = Math.abs(prev.top - cur.top) < 4;
          const gap = sameLine
            ? cur.left - prev.right
            : cur.top - prev.bottom;
          gaps.push({
            row: rIdx,
            aIndex: i - 1,
            bIndex: i,
            gap,
            axis: sameLine ? "x" : "y",
          });
        }
      });
      return { measured, gaps };
    });

    // Ukuran tap-target.
    const tooSmall = measured.filter((m) => {
      if (m.height < MIN_TAP_PX) return true;
      if (m.kind === "icon" && m.width < MIN_TAP_PX) return true;
      return false;
    });
    expect(
      tooSmall,
      `Tombol di bawah ${MIN_TAP_PX}px:\n` +
        tooSmall
          .map(
            (m) =>
              `  · row=${m.row} [${m.kind}] "${m.label}" ${m.width.toFixed(1)}×${m.height.toFixed(1)}`,
          )
          .join("\n"),
    ).toEqual([]);

    // Jarak antar-tombol.
    const tooTight = gaps.filter((g) => g.gap < MIN_GAP_PX);
    expect(
      tooTight,
      `Gap di bawah ${MIN_GAP_PX}px:\n` +
        tooTight
          .map(
            (g) =>
              `  · row=${g.row} axis=${g.axis} antara #${g.aIndex}-#${g.bIndex} = ${g.gap.toFixed(1)}px`,
          )
          .join("\n"),
    ).toEqual([]);
  });

  test("snapshot visual", async ({ page }) => {
    await expect(page).toHaveScreenshot("tap-targets.png", { fullPage: true });
  });
});