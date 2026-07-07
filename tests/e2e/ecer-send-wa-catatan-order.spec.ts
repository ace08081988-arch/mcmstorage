// E2E: baris "Catatan:" pada pesan WA hanya muncul ketika catatan
// terisi (non-kosong / non-whitespace), dan bila muncul HARUS berada
// setelah "Dibayar:" / "Sisa:" (bila keduanya ada) — tidak pernah
// mendahului "Pembayaran:" / "Dibayar:" / "Sisa:". Kontrak ini harus
// bertahan setelah pengguna:
//   - mengetik lalu menghapus catatan (kosong lagi → baris tidak muncul)
//   - mengetik catatan hanya berisi spasi (dianggap kosong)
//   - berpindah antar item dan meng-edit catatan pada item baru
//   - mengganti metode pembayaran (kas / hutang / partial) di tengah edit
//
// Invarian:
//   1. Catatan kosong / whitespace-only  → tidak ada baris "Catatan:"
//   2. Catatan terisi                    → tepat 1 baris "Catatan: <isi>"
//   3. Bila ada "Dibayar:" / "Sisa:", posisi "Catatan:" > keduanya
//   4. "Catatan:" selalu setelah "Pembayaran:"
//   5. Pindah item me-reset field catatan (tidak ada carry-over)
import { test, expect } from "@playwright/test";

const URL = "/lovable/visual/ready-badges-selector";

function linesOf(msg: string): string[] {
  const lines = msg.split("\n");
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function idx(msg: string, prefix: string): number {
  return linesOf(msg).findIndex((l) => l.startsWith(prefix));
}

function countCatatan(msg: string): number {
  return linesOf(msg).filter((l) => l.startsWith("Catatan:")).length;
}

test.describe("Baris 'Catatan:' hanya muncul saat terisi & selalu setelah Dibayar/Sisa", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByRole("heading", { name: /Ready Badges/i })).toBeVisible();
  });

  test("Catatan kosong (Lunas): tidak ada baris 'Catatan:'", async ({ page }) => {
    await page.getByTestId("send-wa-rp1").click();
    // biarkan payment-note kosong
    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();
    const msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    expect(countCatatan(msg)).toBe(0);
  });

  test("Catatan hanya whitespace: diperlakukan sebagai kosong", async ({ page }) => {
    await page.getByTestId("send-wa-rp1").click();
    await page.getByTestId("payment-note-request").fill("   \t  ");
    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();
    const msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    expect(countCatatan(msg)).toBe(0);
  });

  test("Ketik lalu hapus catatan sebelum kirim: baris 'Catatan:' tidak muncul", async ({ page }) => {
    await page.getByTestId("send-wa-rp1").click();
    await page.getByTestId("payment-note-request").fill("draft yang akan dihapus");
    await page.getByTestId("payment-note-request").fill("");
    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();
    const msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    expect(countCatatan(msg)).toBe(0);
    expect(msg).not.toContain("draft yang akan dihapus");
  });

  test("Bayar sebagian + catatan: 'Catatan:' muncul TEPAT setelah 'Sisa:'", async ({ page }) => {
    await page.getByTestId("send-wa-ep4").click();
    await page.getByTestId("payment-method-partial").click();
    await page.getByTestId("payment-partial-amount-ecer").fill("2500");
    await page.getByTestId("payment-note-ecer").fill("konfirmasi dulu ya");
    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-ecer").textContent()) ?? "";
    const iPembayaran = idx(msg, "Pembayaran:");
    const iDibayar = idx(msg, "Dibayar:");
    const iSisa = idx(msg, "Sisa:");
    const iCatatan = idx(msg, "Catatan:");

    expect(countCatatan(msg)).toBe(1);
    expect(iPembayaran).toBeGreaterThanOrEqual(0);
    expect(iDibayar).toBeGreaterThan(iPembayaran);
    expect(iSisa).toBeGreaterThan(iDibayar);
    expect(iCatatan).toBeGreaterThan(iSisa);
  });

  test("Hutang + catatan: 'Catatan:' hanya harus setelah 'Pembayaran:' (tanpa Dibayar/Sisa)", async ({ page }) => {
    await page.getByTestId("send-wa-rp2").click();
    await page.getByTestId("payment-method-hutang").click();
    await page.getByTestId("payment-note-request").fill("tolong dicatat");
    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    expect(countCatatan(msg)).toBe(1);
    expect(idx(msg, "Dibayar:")).toBe(-1);
    expect(idx(msg, "Sisa:")).toBe(-1);
    expect(idx(msg, "Catatan:")).toBeGreaterThan(idx(msg, "Pembayaran:"));
  });

  test("Toggle metode partial→kas setelah isi catatan: urutan tetap valid (tanpa Dibayar/Sisa)", async ({ page }) => {
    await page.getByTestId("send-wa-rp2").click();
    await page.getByTestId("payment-method-partial").click();
    await page.getByTestId("payment-partial-amount-request").fill("1000");
    await page.getByTestId("payment-note-request").fill("catatan penting");
    // Ganti ke Lunas — Dibayar/Sisa harus hilang; Catatan tetap ada
    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    expect(countCatatan(msg)).toBe(1);
    expect(idx(msg, "Dibayar:")).toBe(-1);
    expect(idx(msg, "Sisa:")).toBe(-1);
    expect(idx(msg, "Catatan:")).toBeGreaterThan(idx(msg, "Pembayaran:"));
  });

  test("Pindah item: catatan sesi lama tidak carry-over; kontrak urutan tetap", async ({ page }) => {
    // Sesi A: rp1 dengan catatan
    await page.getByTestId("send-wa-rp1").click();
    await page.getByTestId("payment-note-request").fill("catatan sesi A");
    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();
    let msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    expect(countCatatan(msg)).toBe(1);

    // Sesi B: rp4 — field catatan harus reset
    await page.getByTestId("send-wa-rp4").click();
    await expect(page.getByTestId("payment-note-request")).toHaveValue("");

    // B1: kirim tanpa isi catatan → baris "Catatan:" TIDAK muncul,
    // dan konten sesi A tidak boleh nyangkut.
    await page.getByTestId("payment-method-partial").click();
    await page.getByTestId("payment-partial-amount-request").fill("500");
    await page.getByTestId("payment-send-wa").click();
    msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    expect(countCatatan(msg)).toBe(0);
    expect(msg).not.toContain("catatan sesi A");
    // Meski kosong, urutan Dibayar/Sisa tetap benar
    expect(idx(msg, "Sisa:")).toBeGreaterThan(idx(msg, "Dibayar:"));

    // B2: kirim ulang dengan catatan baru → harus setelah Sisa:
    await page.getByTestId("payment-note-request").fill("catatan sesi B");
    await page.getByTestId("payment-send-wa").click();
    msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    expect(countCatatan(msg)).toBe(1);
    expect(msg).not.toContain("catatan sesi A");
    expect(idx(msg, "Catatan:")).toBeGreaterThan(idx(msg, "Sisa:"));
  });
});