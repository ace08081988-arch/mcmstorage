// E2E: urutan & format baris pesan WA harus stabil (dan konsisten
// dengan formatter SSOT) meski pengguna mengedit catatan, mengganti
// metode pembayaran, atau berpindah antar item.
//
// Kontrak urutan baris (setelah "Halo <customer>," sebagai baris 0):
//   1. Paket: <nama>
//   2. Total: Rp<nnn>
//   3. Pembayaran: <Lunas|Hutang|Bayar sebagian>
//   4. (opsional) Dibayar: Rp<nnn>    ← hanya untuk Bayar sebagian
//   5. (opsional) Sisa:    Rp<nnn>    ← hanya untuk Bayar sebagian
//   6. (opsional) Catatan: <teks>     ← hanya jika catatan non-kosong
//   7. (opsional) Lokasi:  <url>      ← hanya jika paket punya locationUrl
//   8. Terima kasih.
//
// Invarian yang di-e2e-kan:
//   - Urutan baris di atas tidak berubah, apa pun kombinasi opsi.
//   - "Catatan:" selalu MENDAHULUI "Lokasi:" (regresi klasik saat catatan
//     diinjek ke tempat salah).
//   - "Dibayar:"/"Sisa:" selalu MENDAHULUI "Catatan:" dan "Lokasi:".
//   - "Terima kasih." selalu baris terakhir.
//   - Regex Rupiah & URL tetap valid pada masing-masing nilai.
//   - Setelah berpindah antar item + edit catatan, pesan baru tetap
//     mengikuti kontrak (tidak "gado-gado" dari sesi sebelumnya).
import { test, expect } from "@playwright/test";

const URL = "/lovable/visual/ready-badges-selector";

const RUPIAH_RE = /^Rp\d{1,3}(?:\.\d{3})*$/;
const URL_RE = /^https?:\/\/\S+$/;

/**
 * Verifikasi urutan baris pesan WA memenuhi kontrak formatter.
 * `opts` menyatakan baris opsional apa saja yang WAJIB muncul.
 */
function assertOrderedMessage(
  msg: string,
  opts: {
    customer: string;
    titleName: string;
    method: "Lunas" | "Hutang" | "Bayar sebagian";
    dibayar?: string; // "Rp2.500"
    sisa?: string;    // "Rp7.500"
    catatan?: string;
    lokasi?: string;
  },
) {
  const lines = msg.split("\n");
  // Buang trailing empty lines (elemen <pre> di React kadang trailing
  // newline; formatter kita tidak menambahkannya, jadi ini defensif saja).
  while (lines.length && lines[lines.length - 1] === "") lines.pop();

  // Rekonstruksi urutan yang diharapkan.
  const expected: RegExp[] = [
    new RegExp(`^Halo ${escapeRegExp(opts.customer)},$`),
    new RegExp(`^Paket: ${escapeRegExp(opts.titleName)}$`),
    /^Total: Rp\d{1,3}(?:\.\d{3})*$/,
    new RegExp(`^Pembayaran: ${escapeRegExp(opts.method)}$`),
  ];
  if (opts.dibayar) {
    expected.push(new RegExp(`^Dibayar: ${escapeRegExp(opts.dibayar)}$`));
  }
  if (opts.sisa) {
    expected.push(new RegExp(`^Sisa: ${escapeRegExp(opts.sisa)}$`));
  }
  if (opts.catatan) {
    expected.push(new RegExp(`^Catatan: ${escapeRegExp(opts.catatan)}$`));
  }
  if (opts.lokasi) {
    expected.push(new RegExp(`^Lokasi: ${escapeRegExp(opts.lokasi)}$`));
  }
  expected.push(/^Terima kasih\.$/);

  expect(lines, "jumlah baris harus persis").toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(lines[i], `baris #${i} tidak sesuai kontrak: ${lines[i]}`).toMatch(
      expected[i],
    );
  }

  // Cross-check regex format pada nilai numerik/URL.
  const totalVal = /^Total: (.+)$/.exec(lines[2])?.[1] ?? "";
  expect(totalVal).toMatch(RUPIAH_RE);
  if (opts.dibayar) {
    expect(opts.dibayar).toMatch(RUPIAH_RE);
  }
  if (opts.sisa) {
    expect(opts.sisa).toMatch(RUPIAH_RE);
  }
  if (opts.lokasi) {
    expect(opts.lokasi).toMatch(URL_RE);
  }

  // Invarian relasi urutan (defensif — sudah tercakup di array `expected`).
  const idx = (needle: string) => lines.findIndex((l) => l.startsWith(needle));
  const iTotal = idx("Total:");
  const iPembayaran = idx("Pembayaran:");
  const iDibayar = idx("Dibayar:");
  const iSisa = idx("Sisa:");
  const iCatatan = idx("Catatan:");
  const iLokasi = idx("Lokasi:");
  const iTerima = idx("Terima kasih.");

  expect(iTotal).toBeGreaterThan(idx("Paket:"));
  expect(iPembayaran).toBeGreaterThan(iTotal);
  if (iDibayar >= 0) expect(iDibayar).toBeGreaterThan(iPembayaran);
  if (iSisa >= 0) expect(iSisa).toBeGreaterThan(iDibayar);
  if (iCatatan >= 0) {
    if (iSisa >= 0) expect(iCatatan).toBeGreaterThan(iSisa);
    else expect(iCatatan).toBeGreaterThan(iPembayaran);
  }
  if (iLokasi >= 0) {
    if (iCatatan >= 0) expect(iLokasi).toBeGreaterThan(iCatatan);
    else expect(iLokasi).toBeGreaterThan(iPembayaran);
  }
  expect(iTerima).toBe(lines.length - 1);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test.describe("Urutan & format pesan WA stabil setelah edit & pindah item", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByRole("heading", { name: /Ready Badges/i })).toBeVisible();
  });

  test("Lunas + catatan + lokasi: urutan sesuai kontrak", async ({ page }) => {
    await page.getByTestId("send-wa-rp1").click();
    const customer = (
      await page.getByTestId("payment-summary-customer-request").textContent()
    )?.trim() ?? "";
    const titleName = (
      await page.getByTestId("payment-summary-title-request").textContent()
    )?.trim() ?? "";
    const lokasi = (
      await page.getByTestId("payment-summary-location-request").textContent()
    )?.trim() ?? "";

    await page.getByTestId("payment-note-request").fill("kirim pagi");
    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    assertOrderedMessage(msg, {
      customer,
      titleName,
      method: "Lunas",
      catatan: "kirim pagi",
      lokasi,
    });
  });

  test("Bayar sebagian: Dibayar/Sisa muncul di antara Pembayaran & Catatan", async ({ page }) => {
    await page.getByTestId("send-wa-ep4").click();
    const customer = (
      await page.getByTestId("payment-summary-customer-ecer").textContent()
    )?.trim() ?? "";
    const titleName = (
      await page.getByTestId("payment-summary-title-ecer").textContent()
    )?.trim() ?? "";
    const lokasi = (
      await page.getByTestId("payment-summary-location-ecer").textContent()
    )?.trim() ?? "";

    await page.getByTestId("payment-method-partial").click();
    await page.getByTestId("payment-partial-amount-ecer").fill("2500");
    await page.getByTestId("payment-note-ecer").fill("tolong konfirmasi");
    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-ecer").textContent()) ?? "";
    assertOrderedMessage(msg, {
      customer,
      titleName,
      method: "Bayar sebagian",
      dibayar: "Rp2.500",
      sisa: "Rp7.500",
      catatan: "tolong konfirmasi",
      lokasi,
    });
  });

  test("Edit catatan berkali-kali sebelum kirim: urutan tetap benar", async ({ page }) => {
    await page.getByTestId("send-wa-rp2").click();
    const customer = (
      await page.getByTestId("payment-summary-customer-request").textContent()
    )?.trim() ?? "";
    const titleName = (
      await page.getByTestId("payment-summary-title-request").textContent()
    )?.trim() ?? "";
    const lokasi = (
      await page.getByTestId("payment-summary-location-request").textContent()
    )?.trim() ?? "";

    // Toggle metode di antara edit catatan — invarian urutan harus
    // bertahan.
    await page.getByTestId("payment-note-request").fill("draft 1");
    await page.getByTestId("payment-method-partial").click();
    await page.getByTestId("payment-partial-amount-request").fill("1000");
    await page.getByTestId("payment-note-request").fill("draft 2");
    await page.getByTestId("payment-method-hutang").click();
    await page.getByTestId("payment-note-request").fill("final note");
    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    assertOrderedMessage(msg, {
      customer,
      titleName,
      method: "Lunas",
      catatan: "final note",
      lokasi,
    });
    // Catatan draft tidak boleh nyangkut.
    expect(msg).not.toContain("draft 1");
    expect(msg).not.toContain("draft 2");
  });

  test("Beralih antar item (rp1 → rp4): urutan konsisten & tidak bocor antar sesi", async ({ page }) => {
    // Sesi #1: rp1 (Paket Alpha) dengan catatan A.
    await page.getByTestId("send-wa-rp1").click();
    const custA = (
      await page.getByTestId("payment-summary-customer-request").textContent()
    )?.trim() ?? "";
    const titleA = (
      await page.getByTestId("payment-summary-title-request").textContent()
    )?.trim() ?? "";
    const locA = (
      await page.getByTestId("payment-summary-location-request").textContent()
    )?.trim() ?? "";
    await page.getByTestId("payment-note-request").fill("catatan sesi A");
    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    let msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    assertOrderedMessage(msg, {
      customer: custA,
      titleName: titleA,
      method: "Lunas",
      catatan: "catatan sesi A",
      lokasi: locA,
    });

    // Sesi #2: rp4 (Paket Beta) — Hutang tanpa catatan.
    await page.getByTestId("send-wa-rp4").click();
    const custB = (
      await page.getByTestId("payment-summary-customer-request").textContent()
    )?.trim() ?? "";
    const titleB = (
      await page.getByTestId("payment-summary-title-request").textContent()
    )?.trim() ?? "";
    const locB = (
      await page.getByTestId("payment-summary-location-request").textContent()
    )?.trim() ?? "";
    expect(titleB).not.toBe(titleA);
    expect(locB).not.toBe(locA);

    // Konfirmasi field catatan bersih setelah pindah item.
    await expect(page.getByTestId("payment-note-request")).toHaveValue("");
    await page.getByTestId("payment-method-hutang").click();
    await page.getByTestId("payment-send-wa").click();

    msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    assertOrderedMessage(msg, {
      customer: custB,
      titleName: titleB,
      method: "Hutang",
      lokasi: locB,
    });
    // Anti-bocor: konten sesi A tidak boleh muncul di pesan sesi B.
    expect(msg).not.toContain(custA);
    expect(msg).not.toContain(titleA);
    expect(msg).not.toContain(locA);
    expect(msg).not.toContain("catatan sesi A");
    expect(msg).not.toMatch(/^Catatan:/m); // tidak ada catatan di sesi B
  });
});