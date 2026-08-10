// E2E: tombol "KIRIM WA" (baik tombol konfirmasi di dialog
// `payment-send-wa` maupun tautan hasil `last-wa-url-<scope>`) tidak
// pernah terduplikasi di DOM saat pengguna mengedit catatan / berpindah
// antar item; dan href yang dihasilkan HARUS mencerminkan item + isi
// dialog yang terakhir dipilih — bukan sisa dari sesi sebelumnya.
//
// Invarian:
//   1. Selama dialog terbuka, hanya ada TEPAT SATU `payment-send-wa`
//      di DOM (tidak ada dialog kedua yang terselip saat pindah item).
//   2. Setelah kirim, hanya ada TEPAT SATU `last-wa-url-<scope>` per
//      surface (elemen kosong tersembunyi digantikan tautan aktif —
//      tidak boleh dua-duanya tampil bersamaan).
//   3. `href` tautan == `https://wa.me/?text=` + `encodeURIComponent`
//      dari body pesan yang ditampilkan di `last-wa-message-<scope>`.
//   4. Setelah pindah item + kirim ulang, href baru:
//      - tidak sama dengan href sebelumnya (berbeda customer/title), dan
//      - konsisten dengan pesan baru (bukan carry-over sesi lama).
import { test, expect } from "@playwright/test";

const URL = "/lovable/visual/ready-badges-selector";

test.describe("Tombol KIRIM WA tidak duplikat & href sesuai pilihan", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByRole("heading", { name: /Ready Badges/i })).toBeVisible();
  });

  test("Dialog: hanya 1 tombol payment-send-wa meski pindah item + edit catatan", async ({ page }) => {
    // Sebelum dibuka: 0 tombol konfirmasi.
    await expect(page.getByTestId("payment-send-wa")).toHaveCount(0);

    // Buka dialog pertama (rp1).
    await page.getByTestId("send-wa-rp1").click();
    await expect(page.getByTestId("payment-send-wa")).toHaveCount(1);

    // Edit catatan → tombol tetap satu.
    await page.getByTestId("payment-note-request").fill("draft A");
    await expect(page.getByTestId("payment-send-wa")).toHaveCount(1);

    // Pindah ke item lain via tombol row (rp2) TANPA menutup dulu —
    // state harus di-replace, bukan di-append. Tombol konfirmasi wajib
    // tetap tepat satu.
    await page.getByTestId("send-wa-rp2").click();
    await expect(page.getByTestId("payment-send-wa")).toHaveCount(1);

    // Field catatan wajib bersih (bukan carry "draft A").
    await expect(page.getByTestId("payment-note-request")).toHaveValue("");

    // Edit lagi + toggle metode → tetap 1 tombol.
    await page.getByTestId("payment-note-request").fill("draft B");
    await page.getByTestId("payment-method-hutang").click();
    await page.getByTestId("payment-method-kas").click();
    await expect(page.getByTestId("payment-send-wa")).toHaveCount(1);

    // Setelah kirim, dialog tertutup → 0 tombol lagi.
    await page.getByTestId("payment-send-wa").click();
    await expect(page.getByTestId("payment-send-wa")).toHaveCount(0);
  });

  test("last-wa-url selalu tunggal & href = encodeURIComponent(pesan)", async ({ page }) => {
    await page.getByTestId("send-wa-rp1").click();
    await page.getByTestId("payment-note-request").fill("catatan pilihan");
    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    const urlEl = page.getByTestId("last-wa-url-request");
    await expect(urlEl).toHaveCount(1);

    const href = await urlEl.getAttribute("href");
    expect(href).not.toBeNull();
    const msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    expect(msg.length).toBeGreaterThan(0);

    const expected = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    expect(href).toBe(expected);

    // Sanity: href memuat catatan (dalam bentuk URL-encoded), bukan
    // literal — memastikan encoding benar-benar dilakukan.
    expect(href).toContain(encodeURIComponent("catatan pilihan"));
  });

  test("Pindah antar item + edit → href baru != href lama & konsisten dengan pesan baru", async ({ page }) => {
    // --- Sesi A: rp1 dengan catatan A ---
    await page.getByTestId("send-wa-rp1").click();
    await page.getByTestId("payment-note-request").fill("catatan A");
    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    const urlEl = page.getByTestId("last-wa-url-request");
    await expect(urlEl).toHaveCount(1);
    const hrefA = await urlEl.getAttribute("href");
    const msgA = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    expect(hrefA).toBe(`https://wa.me/?text=${encodeURIComponent(msgA)}`);

    // --- Sesi B: rp4 (paket & customer berbeda), Hutang, tanpa catatan ---
    await page.getByTestId("send-wa-rp4").click();
    // Edit lalu urungkan catatan → memastikan draft tidak bocor ke href.
    await page.getByTestId("payment-note-request").fill("draft yang dibatalkan");
    await page.getByTestId("payment-note-request").fill("");
    await page.getByTestId("payment-method-hutang").click();
    await page.getByTestId("payment-send-wa").click();

    await expect(urlEl).toHaveCount(1); // tetap satu, bukan dua tautan
    const hrefB = await urlEl.getAttribute("href");
    const msgB = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";

    // href baru mencerminkan pesan baru.
    expect(hrefB).toBe(`https://wa.me/?text=${encodeURIComponent(msgB)}`);
    // href baru berbeda dari href sesi A (paket/customer/method berbeda).
    expect(hrefB).not.toBe(hrefA);
    // Anti-leak: catatan sesi A dan draft yang dibatalkan tidak boleh
    // ikut ter-encode ke dalam href sesi B.
    expect(hrefB!).not.toContain(encodeURIComponent("catatan A"));
    expect(hrefB!).not.toContain(encodeURIComponent("draft yang dibatalkan"));
  });

  test("Batal dialog lalu buka item lain: tombol konfirmasi tetap tunggal", async ({ page }) => {
    await page.getByTestId("send-wa-rp1").click();
    await expect(page.getByTestId("payment-send-wa")).toHaveCount(1);

    await page.getByTestId("payment-cancel").click();
    await expect(page.getByTestId("payment-send-wa")).toHaveCount(0);

    await page.getByTestId("send-wa-rp2").click();
    await expect(page.getByTestId("payment-send-wa")).toHaveCount(1);

    // Buka item ecer di surface berbeda sambil dialog request masih
    // terbuka — harness pakai satu state `payment` per scope, jadi
    // masing-masing surface boleh membuka SATU dialog independen; tapi
    // tidak boleh lebih dari satu tombol per scope.
    await page.getByTestId("send-wa-ep1").click();
    await expect(page.getByTestId("payment-send-wa")).toHaveCount(2); // 1 request + 1 ecer

    // Setelah kedua dialog dikonfirmasi, semua tombol lenyap.
    await page.getByTestId("payment-send-wa").first().click();
    await expect(page.getByTestId("payment-send-wa")).toHaveCount(1);
    await page.getByTestId("payment-send-wa").click();
    await expect(page.getByTestId("payment-send-wa")).toHaveCount(0);
  });
});