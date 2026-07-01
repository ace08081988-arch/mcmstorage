import { test, expect, type ConsoleMessage } from "@playwright/test";

/**
 * Verifikasi dev-mode `press-audit`:
 *
 * Membuka harness `/lovable/visual/press-audit` yang berisi empat
 * offender **tanpa** `data-no-press`. Auditor harus mencetak
 * `console.warn` untuk masing-masing rule, dengan reference elemen
 * (arg kedua warn) yang menunjuk selector yang benar via
 * `data-testid`. Kontrol positif (ber-`data-no-press`) tidak boleh
 * ikut disebutkan.
 *
 * Catatan runtime:
 *  - Auditor hanya aktif di `import.meta.env.DEV` (dipasang dari
 *    `src/routes/__root.tsx`). Suite ini mengasumsikan Playwright
 *    dijalankan terhadap dev server (BASE_URL default 5173).
 *  - Sweep pertama dijadwalkan lewat `requestIdleCallback` / setTimeout,
 *    jadi kita panggil `window.__pressAudit()` untuk memaksa scan
 *    deterministik dan mereset dedupe.
 */

type CapturedWarn = {
  text: string;
  targetTestId: string | null;
};

// Suggestion text (substring) yang di-hardcode di `src/lib/press-audit.ts`
// per rule. Test ini sengaja mengeja ulang supaya perubahan teks di
// production tercium sebagai regresi.
const RULE_SIGNATURES: Record<string, { needle: RegExp; expectedTestId: string }> = {
  "radix-animated-surface": {
    needle: /Radix Overlay\/Content/i,
    expectedTestId: "offender-radix",
  },
  "motion-whiletap-wraps-button": {
    needle: /motion\.\* dengan `whileTap`/i,
    expectedTestId: "offender-motion-btn",
  },
  "sortable-handle": {
    needle: /Sortable\/drag handle/i,
    expectedTestId: "offender-sortable",
  },
  "destructive-menuitem": {
    needle: /Menu item destruktif/i,
    expectedTestId: "offender-destructive",
  },
};

test("press-audit mencetak warning dengan selector yang benar", async ({ page }) => {
  const warns: CapturedWarn[] = [];

  const handler = async (msg: ConsoleMessage) => {
    if (msg.type() !== "warning") return;
    const args = msg.args();
    if (args.length < 2) return;
    // Auditor selalu memanggil `console.warn(suggestion, el)` — argumen
    // kedua adalah reference elemen DOM. Baca `data-testid` supaya
    // kita bisa memverifikasi selector target di sisi test.
    let targetTestId: string | null = null;
    try {
      targetTestId = await args[1].evaluate((el) => {
        if (!el || typeof (el as Element).getAttribute !== "function") return null;
        return (el as Element).getAttribute("data-testid");
      });
    } catch {
      targetTestId = null;
    }
    warns.push({ text: msg.text(), targetTestId });
  };
  page.on("console", handler);

  await page.goto("/lovable/visual/press-audit", { waitUntil: "domcontentloaded" });

  // Tunggu auditor terpasang lalu paksa sweep deterministik. Fungsi
  // global ini dipasang oleh `installPressAudit()`.
  await expect
    .poll(async () => page.evaluate(() => typeof (window as any).__pressAudit === "function"), {
      timeout: 10_000,
    })
    .toBe(true);

  await page.evaluate(() => (window as any).__pressAudit());

  // Beri waktu callback console meng-flush ke Node.
  await expect
    .poll(() => warns.length, { timeout: 5_000 })
    .toBeGreaterThanOrEqual(4);

  // Setiap rule harus punya minimal satu warning dengan targetTestId
  // yang tepat.
  for (const [rule, { needle, expectedTestId }] of Object.entries(RULE_SIGNATURES)) {
    const match = warns.find(
      (w) => needle.test(w.text) && w.targetTestId === expectedTestId,
    );
    expect(match, `rule "${rule}" harus menargetkan [data-testid="${expectedTestId}"]`).toBeTruthy();
  }

  // Kontrol positif tidak boleh ikut dilaporkan.
  const controlIds = new Set(["control-ok-sortable", "control-ok-motion-btn"]);
  const leaked = warns.filter((w) => w.targetTestId && controlIds.has(w.targetTestId));
  expect(leaked, "kontrol dengan data-no-press tidak boleh muncul di warning").toEqual([]);

  page.off("console", handler);
});