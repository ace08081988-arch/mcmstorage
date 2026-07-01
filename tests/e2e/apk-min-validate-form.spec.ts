import { test, expect } from "@playwright/test";

/**
 * E2E: form Minimum Versi Kompatibel di halaman Pengaturan APK harus:
 *   1. Menampilkan error inline per-field saat input tidak valid.
 *   2. Membiarkan tombol Simpan disabled selama form invalid.
 *   3. Menampilkan toast error saat tombol ditekan paksa (mengabaikan
 *      status disabled — melalui tombol "Paksa simpan" yang memanggil
 *      handler yang sama).
 *
 * Dijalankan di harness publik `/lovable/visual/min-supported-form` yang
 * memakai `validateMinSupportedForm` sama persis dengan halaman admin.
 */

const URL = "/lovable/visual/min-supported-form";

test.describe("Pengaturan APK · form minSupported", () => {
  // Pesan sumber kebenaran dari `src/lib/apk-min-validate.ts`.
  const MSG = {
    namePrefixV: "Jangan pakai prefix 'v' (mis. tulis 1.2.0)",
    nameSuffix:
      "Tidak boleh ada suffix prerelease/build (mis. -beta, +build)",
    nameFormat: "Format harus MAJOR.MINOR[.PATCH] angka saja (mis. 1.2.3)",
    nameRange: "Setiap segmen harus 0–99999",
    codeInt: "Harus bilangan bulat non-negatif (mis. 45)",
    codeMax: "Melebihi batas versionCode Android (≤ 2.100.000.000)",
    reasonMax: "Alasan maksimum 200 karakter",
    reasonWithoutMin:
      "Alasan hanya berlaku bila minimum versi atau build diisi",
    toastInvalid: "Perbaiki input yang tidak valid dulu",
    toastSaved: "Tersimpan",
  } as const;

  test("input tidak valid → error inline, Simpan disabled", async ({
    page,
  }) => {
    await page.goto(URL);

    const name = page.getByTestId("mf-name");
    const code = page.getByTestId("mf-code");
    const save = page.getByTestId("mf-save");

    // Awal: kosong = valid, Simpan enabled.
    await expect(save).toBeEnabled();

    // Semver invalid (prefix 'v').
    await name.fill("v1.2.0");
    await name.blur();
    const nameErr = page.getByTestId("mf-name-error");
    await expect(nameErr).toBeVisible();
    await expect(nameErr).toContainText(/prefix 'v'/i);
    await expect(save).toBeDisabled();

    // Build invalid (huruf).
    await code.fill("abc");
    await code.blur();
    const codeErr = page.getByTestId("mf-code-error");
    await expect(codeErr).toBeVisible();
    await expect(codeErr).toContainText(/bilangan bulat/i);
    await expect(save).toBeDisabled();

    // Perbaiki semver → error semver hilang, build masih invalid.
    await name.fill("1.2.0");
    await name.blur();
    await expect(page.getByTestId("mf-name-error")).toHaveCount(0);
    await expect(save).toBeDisabled();

    // Perbaiki build → semua valid, Simpan enabled.
    await code.fill("45");
    await code.blur();
    await expect(page.getByTestId("mf-code-error")).toHaveCount(0);
    await expect(save).toBeEnabled();
  });

  test("tekan paksa saat invalid → toast error, tidak tersimpan", async ({
    page,
  }) => {
    await page.goto(URL);

    await page.getByTestId("mf-name").fill("v1.2.0");
    await page.getByTestId("mf-name").blur();
    await expect(page.getByTestId("mf-save")).toBeDisabled();

    // Tombol paksa memanggil handler yang sama tanpa memblokir disabled.
    await page.getByTestId("mf-save-force").click();

    // Toast error muncul (sonner mount di root, top-center) dengan teks
    // persis sesuai handler harness.
    await expect(page.getByText(MSG.toastInvalid, { exact: true })).toBeVisible({
      timeout: 3_000,
    });

    // Tidak ada tersimpan.
    await expect(page.getByTestId("mf-saved-count")).toHaveText("saved=0");
  });

  test("form-level error 'reason tanpa min' → banner muncul, Simpan disabled", async ({
    page,
  }) => {
    await page.goto(URL);
    await page.getByTestId("mf-reason").fill("Perbaikan keamanan");
    await page.getByTestId("mf-reason").blur();

    const formErr = page.getByTestId("mf-form-error");
    await expect(formErr).toBeVisible();
    await expect(formErr).toHaveText(MSG.reasonWithoutMin);
    await expect(page.getByTestId("mf-save")).toBeDisabled();

    // Tekan paksa → toast error dengan teks persis.
    await page.getByTestId("mf-save-force").click();
    await expect(page.getByText(MSG.toastInvalid, { exact: true })).toBeVisible({
      timeout: 3_000,
    });
    await expect(page.getByTestId("mf-saved-count")).toHaveText("saved=0");
  });

  test("pesan inline name: prefix v, suffix, format, range", async ({
    page,
  }) => {
    await page.goto(URL);
    const name = page.getByTestId("mf-name");
    const err = page.getByTestId("mf-name-error");

    await name.fill("v1.2.0");
    await name.blur();
    await expect(err).toHaveText(MSG.namePrefixV);

    await name.fill("1.2.0-beta");
    await expect(err).toHaveText(MSG.nameSuffix);

    await name.fill("1.2.0+build");
    await expect(err).toHaveText(MSG.nameSuffix);

    await name.fill("1.2.x");
    await expect(err).toHaveText(MSG.nameFormat);

    await name.fill("1");
    await expect(err).toHaveText(MSG.nameFormat);

    await name.fill("1.2.3.4.5");
    await expect(err).toHaveText(MSG.nameFormat);

    await name.fill("1.100000.0");
    await expect(err).toHaveText(MSG.nameRange);
  });

  test("pesan inline code: non-integer & melebihi batas Android", async ({
    page,
  }) => {
    await page.goto(URL);
    const code = page.getByTestId("mf-code");
    const err = page.getByTestId("mf-code-error");

    await code.fill("abc");
    await code.blur();
    await expect(err).toHaveText(MSG.codeInt);

    await code.fill("-5");
    await expect(err).toHaveText(MSG.codeInt);

    await code.fill("4.5");
    await expect(err).toHaveText(MSG.codeInt);

    await code.fill("2100000001");
    await expect(err).toHaveText(MSG.codeMax);
  });

  test("pesan inline reason: >200 karakter", async ({ page }) => {
    await page.goto(URL);
    const reason = page.getByTestId("mf-reason");
    // Isi min agar tidak memicu form-level 'reason tanpa min'.
    await page.getByTestId("mf-name").fill("1.2.0");
    await reason.fill("x".repeat(201));
    await reason.blur();
    await expect(page.getByTestId("mf-reason-error")).toHaveText(
      MSG.reasonMax,
    );
  });

  test("toast sukses saat simpan valid", async ({ page }) => {
    await page.goto(URL);
    await page.getByTestId("mf-name").fill("1.2.0");
    await page.getByTestId("mf-code").fill("45");
    await page.getByTestId("mf-save").click();
    await expect(page.getByText(MSG.toastSaved, { exact: true })).toBeVisible({
      timeout: 3_000,
    });
  });

  test("input valid tersimpan → toast sukses & badge 'lawas' menyesuaikan data", async ({
    page,
  }) => {
    await page.goto(URL);

    // Awal (tanpa minimum tersimpan): semua rilis 'ok', tidak ada badge.
    for (const id of ["r-old", "r-mid", "r-new"]) {
      await expect(page.getByTestId(`mf-rel-${id}`)).toHaveAttribute(
        "data-below",
        "0",
      );
    }

    // Isi minimum valid: name=1.2.0, build=45.
    await page.getByTestId("mf-name").fill("1.2.0");
    await page.getByTestId("mf-code").fill("45");
    await expect(page.getByTestId("mf-save")).toBeEnabled();
    await page.getByTestId("mf-save").click();

    // Toast sukses muncul.
    await expect(page.getByText(/^Tersimpan$/)).toBeVisible({
      timeout: 3_000,
    });
    await expect(page.getByTestId("mf-saved-count")).toHaveText("saved=1");

    // Badge menyesuaikan: r-old (1.0.0/10) di bawah → 'lawas';
    // r-mid (1.2.0/45) tepat = ok; r-new (2.0.0/80) di atas = ok.
    await expect(page.getByTestId("mf-rel-r-old")).toHaveAttribute(
      "data-below",
      "1",
    );
    await expect(page.getByTestId("mf-rel-r-old-badge")).toBeVisible();
    await expect(page.getByTestId("mf-rel-r-mid")).toHaveAttribute(
      "data-below",
      "0",
    );
    await expect(page.getByTestId("mf-rel-r-new")).toHaveAttribute(
      "data-below",
      "0",
    );

    // Naikkan minimum: 2.0.0/80 → sekarang r-mid ikut jadi 'lawas',
    // r-new tetap ok (tepat di minimum).
    await page.getByTestId("mf-name").fill("2.0.0");
    await page.getByTestId("mf-code").fill("80");
    await page.getByTestId("mf-save").click();
    await expect(page.getByTestId("mf-saved-count")).toHaveText("saved=2");

    await expect(page.getByTestId("mf-rel-r-old")).toHaveAttribute(
      "data-below",
      "1",
    );
    await expect(page.getByTestId("mf-rel-r-mid")).toHaveAttribute(
      "data-below",
      "1",
    );
    await expect(page.getByTestId("mf-rel-r-mid-badge")).toBeVisible();
    await expect(page.getByTestId("mf-rel-r-new")).toHaveAttribute(
      "data-below",
      "0",
    );
  });

  test("boundary: versi+build tepat sama dengan minimum → tidak 'lawas'", async ({
    page,
  }) => {
    await page.goto(URL);

    // Set minimum tepat sama dengan r-mid (1.2.0 / 45).
    await page.getByTestId("mf-name").fill("1.2.0");
    await page.getByTestId("mf-code").fill("45");
    await expect(page.getByTestId("mf-save")).toBeEnabled();
    await page.getByTestId("mf-save").click();
    await expect(page.getByText(/^Tersimpan$/)).toBeVisible({
      timeout: 3_000,
    });

    // r-mid berada tepat di boundary → harus dianggap kompatibel (bukan lawas).
    await expect(page.getByTestId("mf-rel-r-mid")).toHaveAttribute(
      "data-below",
      "0",
    );
    await expect(page.getByTestId("mf-rel-r-mid-badge")).toHaveCount(0);

    // r-new (2.0.0/80) di atas boundary → tetap ok.
    await expect(page.getByTestId("mf-rel-r-new")).toHaveAttribute(
      "data-below",
      "0",
    );

    // r-old (1.0.0/10) di bawah boundary → 'lawas'.
    await expect(page.getByTestId("mf-rel-r-old")).toHaveAttribute(
      "data-below",
      "1",
    );

    // Boundary hanya-name: build min dikosongkan, name tetap 1.2.0.
    // r-mid name = 1.2.0 → tetap tidak lawas.
    await page.getByTestId("mf-code").fill("");
    await page.getByTestId("mf-save").click();
    await expect(page.getByTestId("mf-saved-count")).toHaveText("saved=2");
    await expect(page.getByTestId("mf-rel-r-mid")).toHaveAttribute(
      "data-below",
      "0",
    );

    // Boundary hanya-build: name min dikosongkan, build min = 45.
    // r-mid build = 45 → tetap tidak lawas; r-old build=10 → lawas.
    await page.getByTestId("mf-name").fill("");
    await page.getByTestId("mf-code").fill("45");
    await page.getByTestId("mf-save").click();
    await expect(page.getByTestId("mf-saved-count")).toHaveText("saved=3");
    await expect(page.getByTestId("mf-rel-r-mid")).toHaveAttribute(
      "data-below",
      "0",
    );
    await expect(page.getByTestId("mf-rel-r-old")).toHaveAttribute(
      "data-below",
      "1",
    );
  });
});
