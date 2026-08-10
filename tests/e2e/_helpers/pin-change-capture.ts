import type { Page, TestInfo } from "@playwright/test";

/**
 * Capture screenshot + trace-chunk otomatis SETIAP kali token
 * `PIN xxxx-xxxx` berubah untuk row/header yang sudah pernah kanonik.
 *
 * Dipanggil TEPAT SEBELUM `expect().toBe()` melempar, supaya artefak
 * terlampir walaupun test langsung gagal setelahnya. Aktif untuk
 * project Playwright yang namanya mengandung `firefox` atau `webkit`
 * (Chromium diamkan supaya CI Chromium tetap ringan).
 *
 * Prasyarat trace: project menyalakan `use.trace: 'on'` sehingga
 * `context.tracing.startChunk/stopChunk` valid. Screenshot selalu
 * dicoba; kegagalan trace tidak menggagalkan test.
 */
export async function capturePinChangeArtifacts(
  page: Page,
  testInfo: TestInfo,
  ctx: { href?: string; prev: string; next: string; phase: string },
): Promise<void> {
  const name = testInfo.project.name;
  if (!/firefox|webkit/i.test(name)) return;

  const slug =
    `${ctx.phase}-${ctx.href ?? "row"}-${ctx.prev}__to__${ctx.next}`
      .replace(/[^a-z0-9\-_]+/gi, "_")
      .slice(0, 140) || "pin-change";

  // ── Screenshot (best-effort).
  try {
    const shotPath = testInfo.outputPath(`pin-change-${slug}.png`);
    await page.screenshot({ path: shotPath });
    await testInfo.attach(`pin-change-screenshot::${slug}`, {
      path: shotPath,
      contentType: "image/png",
    });
  } catch {
    /* screenshot best-effort */
  }

  // ── Trace chunk (hanya berhasil kalau tracing global `on`).
  try {
    const tracePath = testInfo.outputPath(`pin-change-${slug}.trace.zip`);
    await page.context().tracing.stopChunk({ path: tracePath });
    await testInfo.attach(`pin-change-trace::${slug}`, {
      path: tracePath,
      contentType: "application/zip",
    });
    // Mulai chunk berikutnya supaya perubahan PIN lanjutan tetap tertangkap.
    await page.context().tracing.startChunk({ title: `after ${slug}` });
  } catch {
    /* trace chunk hanya aktif bila tracing on */
  }
}

/**
 * Panggil di `test.beforeEach` supaya `startChunk`/`stopChunk` valid pada
 * project yang menyalakan trace. Aman dipanggil di project apapun.
 */
export async function armPinChangeTracing(page: Page, testInfo: TestInfo): Promise<void> {
  if (!/firefox|webkit/i.test(testInfo.project.name)) return;
  try {
    await page.context().tracing.startChunk({ title: "pin-canonical-baseline" });
  } catch {
    /* trace not on — helper akan otomatis skip attach trace */
  }
}
