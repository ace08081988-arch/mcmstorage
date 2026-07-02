import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";

/**
 * E2E: harness publik `/lovable/visual/appearance-import` memakai fungsi
 * `migrateImportedAppearance` yang sama persis dengan halaman
 * `/pengaturan-tampilan`. Test ini membuktikan:
 *
 *   1. Payload skema v1 (field appearance di root) di-migrasi dengan benar
 *      dan diterapkan ke pratinjau UI.
 *   2. Payload skema v2 (nested `appearance`/`appPrefs`) di-migrasi dengan
 *      benar.
 *   3. Payload dari skema versi lebih baru ditandai `forward=true`, field
 *      yang dikenal tetap dimuat, dan field yang belum dikenal diabaikan
 *      tanpa error.
 *   4. Payload dengan `__type` asing ditolak `unknown_type`; payload rusak
 *      ditolak `invalid`.
 *
 * JSON fixture di sini SENGAJA di-inline (bukan di-import dari
 * `src/lib/appearance-migrator.fixtures.ts`) supaya spec berperan sebagai
 * kontrak eksternal: setiap perubahan bentuk fixture harus menyesuaikan
 * spec ini secara eksplisit, mencegah regresi backward-compat "diam".
 */

const URL = "/lovable/visual/appearance-import";

async function runImport(page: Page, payload: unknown | string) {
  const json =
    typeof payload === "string" ? payload : JSON.stringify(payload);
  await page.getByTestId("ai-json").fill(json);
  await page.getByTestId("ai-run").click();
}

/**
 * Buffer console + pageerror + failed request events per test. Diattach ke
 * hasil test HANYA saat gagal (afterEach) supaya:
 *   - run yang sukses tidak dipenuhi log/screenshot,
 *   - kegagalan lokal langsung punya konteks lengkap tanpa harus rerun
 *     dengan flag debug tambahan (bukti reproduksi otomatis).
 *
 * `screenshot: "only-on-failure"` + `trace: "retain-on-failure"` di
 * playwright.config.ts menangani screenshot bawaan; helper ini menambahkan
 * screenshot FRAME AKHIR eksplisit (nama file stabil) + JSON log konsol +
 * daftar request gagal, jadi pesan error di terminal sudah cukup untuk
 * mendiagnosis tanpa membuka HTML report.
 */
type ConsoleEntry = {
  type: string;
  text: string;
  location?: { url: string; lineNumber: number; columnNumber: number } | null;
  timeMs: number;
};
type FailedRequestEntry = {
  url: string;
  method: string;
  failure: string | null;
  timeMs: number;
};

const consoleBuffers = new WeakMap<Page, ConsoleEntry[]>();
const pageErrorBuffers = new WeakMap<Page, string[]>();
const requestFailBuffers = new WeakMap<Page, FailedRequestEntry[]>();

test.beforeEach(async ({ page }) => {
  const t0 = Date.now();
  const consoleLogs: ConsoleEntry[] = [];
  const pageErrors: string[] = [];
  const requestFails: FailedRequestEntry[] = [];
  consoleBuffers.set(page, consoleLogs);
  pageErrorBuffers.set(page, pageErrors);
  requestFailBuffers.set(page, requestFails);

  page.on("console", (msg: ConsoleMessage) => {
    const loc = msg.location();
    consoleLogs.push({
      type: msg.type(),
      text: msg.text(),
      location: loc && loc.url ? loc : null,
      timeMs: Date.now() - t0,
    });
  });
  page.on("pageerror", (err) => {
    pageErrors.push(`${err.name}: ${err.message}\n${err.stack ?? ""}`);
  });
  page.on("requestfailed", (req) => {
    requestFails.push({
      url: req.url(),
      method: req.method(),
      failure: req.failure()?.errorText ?? null,
      timeMs: Date.now() - t0,
    });
  });
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;

  // Screenshot eksplisit dengan nama stabil supaya path-nya predictable
  // di terminal output — beda dari `screenshot: only-on-failure` yang
  // memakai UUID.
  try {
    const buf = await page.screenshot({ fullPage: true });
    await testInfo.attach("failure-screenshot.png", {
      body: buf,
      contentType: "image/png",
    });
  } catch {
    // Halaman mungkin sudah di-close; abaikan.
  }

  const consoleLogs = consoleBuffers.get(page) ?? [];
  const pageErrors = pageErrorBuffers.get(page) ?? [];
  const requestFails = requestFailBuffers.get(page) ?? [];

  await testInfo.attach("console-logs.json", {
    body: JSON.stringify(
      { consoleLogs, pageErrors, requestFails, url: page.url() },
      null,
      2,
    ),
    contentType: "application/json",
  });

  // Ringkasan human-readable — dicetak ke stderr supaya langsung terlihat
  // di terminal, tidak hanya di HTML report.
  const errorCount = consoleLogs.filter((c) => c.type === "error").length;
  const summary = [
    `\n──── [appearance-import-e2e] Debug dump untuk: ${testInfo.title} ────`,
    `URL saat gagal   : ${page.url()}`,
    `Console entries  : ${consoleLogs.length} (${errorCount} error)`,
    `Page errors      : ${pageErrors.length}`,
    `Request failed   : ${requestFails.length}`,
  ];
  if (errorCount > 0) {
    summary.push("  · error terakhir:");
    for (const c of consoleLogs.filter((c) => c.type === "error").slice(-3)) {
      summary.push(`    [${c.timeMs}ms] ${c.text}`);
    }
  }
  if (pageErrors.length > 0) {
    summary.push("  · page error terakhir:");
    summary.push(`    ${pageErrors[pageErrors.length - 1].split("\n")[0]}`);
  }
  if (requestFails.length > 0) {
    summary.push("  · request gagal terakhir:");
    const r = requestFails[requestFails.length - 1];
    summary.push(`    ${r.method} ${r.url} → ${r.failure ?? "unknown"}`);
  }
  summary.push(
    `Attachments      : failure-screenshot.png, console-logs.json`,
    `──────────────────────────────────────────────────────────────\n`,
  );
  // eslint-disable-next-line no-console
  console.error(summary.join("\n"));
});

test.describe("Appearance migrator · impor via UI harness", () => {
  test("skema v1 (field di root) → patch lengkap + pratinjau ter-update", async ({
    page,
  }) => {
    await page.goto(URL);

    await runImport(page, {
      __type: "mcm.appearance-settings",
      version: 1,
      theme: "dark",
      font: "serif",
      size: "lg",
      accent: "emerald",
      radius: "0.875",
      bgImage: "https://example.com/bg-v1.jpg",
      bgOverlay: "0.6",
      bgBlur: "12",
      compact: true,
      fontScale: 1.1,
      highContrast: true,
      reduceMotion: false,
    });

    await expect(page.getByTestId("ai-status")).toHaveText("ok");
    await expect(page.getByTestId("ai-from-version")).toHaveText("1");
    await expect(page.getByTestId("ai-forward")).toHaveText("false");

    await expect(page.getByTestId("ai-patch-theme")).toHaveText("dark");
    await expect(page.getByTestId("ai-patch-font")).toHaveText("serif");
    await expect(page.getByTestId("ai-patch-size")).toHaveText("lg");
    await expect(page.getByTestId("ai-patch-accent")).toHaveText("emerald");
    await expect(page.getByTestId("ai-patch-radius")).toHaveText("0.875");
    await expect(page.getByTestId("ai-patch-bgImage")).toHaveText(
      "https://example.com/bg-v1.jpg",
    );
    await expect(page.getByTestId("ai-patch-bgOverlay")).toHaveText("0.6");
    await expect(page.getByTestId("ai-patch-bgBlur")).toHaveText("12");
    await expect(page.getByTestId("ai-patch-compact")).toHaveText("true");
    await expect(page.getByTestId("ai-patch-fontScale")).toHaveText("1.1");
    await expect(page.getByTestId("ai-patch-highContrast")).toHaveText("true");
    await expect(page.getByTestId("ai-patch-reduceMotion")).toHaveText("false");

    // Bukti "migrator terpakai di UI": pratinjau ikut ter-update.
    await expect(page.getByTestId("ai-preview-theme")).toHaveText("dark");
    await expect(page.getByTestId("ai-preview-accent")).toHaveText("emerald");
    const previewStyle = await page
      .getByTestId("ai-preview")
      .getAttribute("style");
    expect(previewStyle ?? "").toMatch(/border-radius:\s*0\.875rem/);
    expect(previewStyle ?? "").toMatch(/font-size:\s*1\.1rem/);
  });

  test("skema v1 tanpa `version` sama sekali → default ke v1", async ({
    page,
  }) => {
    await page.goto(URL);
    await runImport(page, {
      __type: "mcm.appearance-settings",
      theme: "light",
      font: "mono",
      size: "sm",
      accent: "blue",
      radius: "0.25",
      fontScale: 0.9,
      reduceMotion: true,
    });

    await expect(page.getByTestId("ai-status")).toHaveText("ok");
    await expect(page.getByTestId("ai-from-version")).toHaveText("1");
    await expect(page.getByTestId("ai-forward")).toHaveText("false");
    await expect(page.getByTestId("ai-patch-theme")).toHaveText("light");
    await expect(page.getByTestId("ai-patch-font")).toHaveText("mono");
    await expect(page.getByTestId("ai-patch-reduceMotion")).toHaveText("true");
  });

  test("skema v2 (appearance/appPrefs bersarang) → patch lengkap", async ({
    page,
  }) => {
    await page.goto(URL);
    await runImport(page, {
      __type: "mcm.appearance-settings",
      schemaVersion: 2,
      version: 2,
      appearance: {
        theme: "light",
        font: "display",
        size: "xl",
        accent: "rose",
        radius: "1.25",
        bgImage: "https://example.com/bg-v2.jpg",
        bgOverlay: "0.5",
        bgBlur: "20",
      },
      compact: true,
      appPrefs: {
        fontScale: 1.25,
        highContrast: true,
        reduceMotion: true,
      },
    });

    await expect(page.getByTestId("ai-status")).toHaveText("ok");
    await expect(page.getByTestId("ai-from-version")).toHaveText("2");
    await expect(page.getByTestId("ai-forward")).toHaveText("false");
    await expect(page.getByTestId("ai-patch-theme")).toHaveText("light");
    await expect(page.getByTestId("ai-patch-font")).toHaveText("display");
    await expect(page.getByTestId("ai-patch-size")).toHaveText("xl");
    await expect(page.getByTestId("ai-patch-accent")).toHaveText("rose");
    await expect(page.getByTestId("ai-patch-radius")).toHaveText("1.25");
    await expect(page.getByTestId("ai-patch-bgOverlay")).toHaveText("0.5");
    await expect(page.getByTestId("ai-patch-bgBlur")).toHaveText("20");
    await expect(page.getByTestId("ai-patch-compact")).toHaveText("true");
    await expect(page.getByTestId("ai-patch-fontScale")).toHaveText("1.25");
    await expect(page.getByTestId("ai-patch-highContrast")).toHaveText("true");
    await expect(page.getByTestId("ai-patch-reduceMotion")).toHaveText("true");
  });

  test("skema versi lebih baru (v3, hipotetis) → forward=true & field baru diabaikan", async ({
    page,
  }) => {
    await page.goto(URL);
    await runImport(page, {
      __type: "mcm.appearance-settings",
      schemaVersion: 3,
      version: 3,
      appearance: {
        theme: "dark",
        font: "sans",
        size: "md",
        accent: "violet",
        radius: "0.75",
        bgImage: "",
        bgOverlay: "0.4",
        bgBlur: "10",
        animatedGradient: true,
        glassMorphism: { strength: 3 },
      },
      compact: false,
      appPrefs: {
        fontScale: 1.05,
        highContrast: false,
        reduceMotion: false,
        dyslexiaFriendly: true,
      },
      motionProfile: { style: "reduced-fancy" },
    });

    await expect(page.getByTestId("ai-status")).toHaveText("ok");
    await expect(page.getByTestId("ai-from-version")).toHaveText("3");
    await expect(page.getByTestId("ai-forward")).toHaveText("true");
    await expect(page.getByTestId("ai-patch-theme")).toHaveText("dark");
    await expect(page.getByTestId("ai-patch-accent")).toHaveText("violet");
    await expect(page.getByTestId("ai-patch-fontScale")).toHaveText("1.05");

    // Field baru TIDAK boleh bocor ke patch — pratinjau hanya berisi
    // field yang dikenal migrator.
    const patchJson = await page
      .getByTestId("ai-patch-json")
      .innerText();
    const parsed = JSON.parse(patchJson);
    expect(Object.keys(parsed).sort()).toEqual(
      [
        "accent",
        "bgBlur",
        "bgImage",
        "bgOverlay",
        "compact",
        "font",
        "fontScale",
        "highContrast",
        "radius",
        "reduceMotion",
        "size",
        "theme",
      ].sort(),
    );
  });

  test("payload dari aplikasi lain → status `unknown_type`", async ({
    page,
  }) => {
    await page.goto(URL);
    await runImport(page, {
      __type: "some.other-app.settings",
      schemaVersion: 2,
      appearance: { theme: "dark" },
    });

    await expect(page.getByTestId("ai-status")).toHaveText("unknown_type");
    await expect(page.getByTestId("ai-from-version")).toHaveText("");
    await expect(page.getByTestId("ai-forward")).toHaveText("");
  });

  test("JSON rusak / bukan objek → status `invalid`", async ({ page }) => {
    await page.goto(URL);

    // JSON tidak valid.
    await runImport(page, "{ not valid json");
    await expect(page.getByTestId("ai-status")).toHaveText("invalid");
    await expect(page.getByTestId("ai-parse-error")).not.toHaveText("");

    // Reset & coba array (bukan objek).
    await page.getByTestId("ai-reset").click();
    await runImport(page, [1, 2, 3]);
    await expect(page.getByTestId("ai-status")).toHaveText("invalid");

    // Reset & coba null.
    await page.getByTestId("ai-reset").click();
    await runImport(page, "null");
    await expect(page.getByTestId("ai-status")).toHaveText("invalid");
  });

  test("payload kosong `{ __type }` saja → semua field jatuh ke default", async ({
    page,
  }) => {
    await page.goto(URL);
    await runImport(page, {
      __type: "mcm.appearance-settings",
      schemaVersion: 2,
    });

    await expect(page.getByTestId("ai-status")).toHaveText("ok");
    await expect(page.getByTestId("ai-from-version")).toHaveText("2");
    // CURRENT_DEFAULT dari harness — dijaga selaras dengan fixtures.ts.
    await expect(page.getByTestId("ai-patch-theme")).toHaveText("system");
    await expect(page.getByTestId("ai-patch-font")).toHaveText("sans");
    await expect(page.getByTestId("ai-patch-size")).toHaveText("md");
    await expect(page.getByTestId("ai-patch-accent")).toHaveText("slate");
  });
});