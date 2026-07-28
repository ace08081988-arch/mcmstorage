import { test, expect, type Locator } from "@playwright/test";

/**
 * E2E responsif — chip hutang/piutang WAJIB tetap rapi di dalam
 * kontainernya pada semua lebar layar yang dipakai Ace (HP kecil 320px
 * s/d desktop 1280px):
 *
 *   1. Tidak menumpah keluar border kontainer (bounding box ⊆ parent).
 *   2. Tidak memicu scroll horizontal pada halaman.
 *   3. Tinggi chip konsisten di semua permukaan (daftar chat, header,
 *      kontainer sempit) — tidak ada satu pun yang lebih tinggi/pendek.
 *   4. Saat nominal terpotong, tersedia keterangan angka penuh
 *      (tooltip/`title`) supaya angka tetap bisa dibaca.
 *
 * Harness publik (tanpa login): /lovable/visual/debt-ssot-consistency
 */
const HARNESS = "/lovable/visual/debt-ssot-consistency?piutang=55000000&nama=Dompeng";

const WIDTHS = [320, 360, 390, 411, 768, 1280];

/** Chip harus berada di dalam kotak parent (toleransi sub-pixel 1px). */
async function expectInsideParent(chip: Locator, parent: Locator, label: string) {
  const c = await chip.boundingBox();
  const p = await parent.boundingBox();
  expect(c, `chip ${label} tidak terlihat`).not.toBeNull();
  expect(p, `kontainer ${label} tidak terlihat`).not.toBeNull();
  if (!c || !p) return;
  expect(c.x + c.width, `${label}: chip tumpah ke kanan`).toBeLessThanOrEqual(
    p.x + p.width + 1,
  );
  expect(c.x, `${label}: chip tumpah ke kiri`).toBeGreaterThanOrEqual(p.x - 1);
  expect(c.y + c.height, `${label}: chip tumpah ke bawah`).toBeLessThanOrEqual(
    p.y + p.height + 1,
  );
}

test.describe("Chip hutang/piutang — responsif", () => {
  for (const width of WIDTHS) {
    test(`rapi tanpa tumpah di lebar ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(HARNESS, { waitUntil: "domcontentloaded" });

      const headerRow = page.getByTestId("header-row");
      const headerChip = page.getByTestId("chip-header-row");
      const narrowBox = page.getByTestId("narrow-box");
      const narrowChip = page.getByTestId("chip-narrow");
      const listChip = page.getByTestId("surface-chat-list").getByRole("button");

      await expect(headerChip).toBeVisible();
      await expect(narrowChip).toBeVisible();

      // 1. Chip tetap di dalam kontainernya.
      await expectInsideParent(headerChip, headerRow, `header @${width}`);
      await expectInsideParent(narrowChip, narrowBox, `sempit @${width}`);

      // 2. Tidak ada scroll horizontal halaman akibat chip.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `halaman scroll horizontal di ${width}px`).toBeLessThanOrEqual(1);

      // 3. Tinggi chip identik di semua permukaan.
      const heights = await Promise.all(
        [headerChip, narrowChip, listChip].map(async (l) => {
          const b = await l.boundingBox();
          return b ? Math.round(b.height) : -1;
        }),
      );
      expect(new Set(heights).size, `tinggi chip berbeda-beda: ${heights.join(", ")}`).toBe(
        1,
      );
      expect(heights[0]).toBeGreaterThan(0);

      // 4. Nominal tidak boleh terpotong tanpa keterangan angka penuh.
      for (const [label, chip] of [
        ["header", headerChip],
        ["sempit", narrowChip],
      ] as const) {
        const clipped = await chip.evaluate((el) => {
          const span = el.querySelector("span:last-child") as HTMLElement | null;
          return span ? span.scrollWidth - span.clientWidth > 1 : false;
        });
        if (!clipped) continue;
        const title = await chip.getAttribute("title");
        expect(
          title ?? "",
          `${label} @${width}: nominal terpotong tapi tanpa keterangan penuh`,
        ).toMatch(/Rp/);
      }
    });
  }
});
