// E2E: pesan WhatsApp yang "dikirim" saat menekan tombol Kirim WA harus
// memuat ringkasan yang ditampilkan di dialog konfirmasi — nama
// pelanggan, total tagihan, dan jenis pembayaran (termasuk rincian
// nominal partial + sisa untuk metode "Bayar sebagian").
//
// Harness: /lovable/visual/ready-badges-selector — pesan terakhir yang
// dibangun dari state dialog dirender ke `data-testid="last-wa-message-<scope>"`.
import { test, expect } from "@playwright/test";

const URL = "/lovable/visual/ready-badges-selector";

test.describe("Pesan WA memuat ringkasan dialog konfirmasi", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByRole("heading", { name: /Ready Badges/i })).toBeVisible();
  });

  test("Metode Lunas: pesan berisi pelanggan, paket, total, dan 'Lunas'", async ({ page }) => {
    await page.getByTestId("send-wa-ep1").click();

    const customer = (await page.getByTestId("payment-summary-customer-ecer").textContent())?.trim();
    const titleName = (await page.getByTestId("payment-summary-title-ecer").textContent())?.trim();
    const total = (await page.getByTestId("payment-summary-total-ecer").textContent())?.trim();
    expect(customer).toBeTruthy();
    expect(titleName).toBeTruthy();
    expect(total).toBe("Rp10.000");

    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-ecer").textContent()) ?? "";
    expect(msg).toContain(customer!);
    expect(msg).toContain(titleName!);
    expect(msg).toContain("Total: Rp10.000");
    expect(msg).toContain("Pembayaran: Lunas");
    // Field partial tidak ikut untuk metode Lunas.
    expect(msg).not.toContain("Dibayar:");
    expect(msg).not.toContain("Sisa:");
  });

  test("Metode Hutang: pesan berisi 'Hutang' dan total tanpa rincian dibayar", async ({ page }) => {
    await page.getByTestId("send-wa-rp1").click();
    const customer = (await page.getByTestId("payment-summary-customer-request").textContent())?.trim();
    const titleName = (await page.getByTestId("payment-summary-title-request").textContent())?.trim();

    await page.getByTestId("payment-method-hutang").click();
    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    expect(msg).toContain(customer!);
    expect(msg).toContain(titleName!);
    expect(msg).toContain("Total: Rp10.000");
    expect(msg).toContain("Pembayaran: Hutang");
    expect(msg).not.toMatch(/Dibayar:/);
  });

  test("Metode Sebagian: pesan berisi nominal Dibayar & Sisa sesuai input", async ({ page }) => {
    await page.getByTestId("send-wa-ep4").click();
    const customer = (await page.getByTestId("payment-summary-customer-ecer").textContent())?.trim();
    const titleName = (await page.getByTestId("payment-summary-title-ecer").textContent())?.trim();

    await page.getByTestId("payment-method-partial").click();
    await page.getByTestId("payment-partial-amount-ecer").fill("3500");
    await expect(page.getByTestId("payment-partial-sisa-ecer")).toHaveText("Rp6.500");

    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-ecer").textContent()) ?? "";
    expect(msg).toContain(customer!);
    expect(msg).toContain(titleName!);
    expect(msg).toContain("Total: Rp10.000");
    expect(msg).toContain("Pembayaran: Bayar sebagian");
    expect(msg).toContain("Dibayar: Rp3.500");
    expect(msg).toContain("Sisa: Rp6.500");
  });

  test("Pesan awal kosong; hanya terisi setelah Kirim WA (bukan setelah pilih metode)", async ({ page }) => {
    await expect(page.getByTestId("last-wa-message-ecer")).toHaveText("");
    await page.getByTestId("send-wa-ep1").click();
    await page.getByTestId("payment-method-hutang").click();
    // Mengubah metode saja tidak boleh menulis pesan.
    await expect(page.getByTestId("last-wa-message-ecer")).toHaveText("");
    await page.getByTestId("payment-cancel").click();
    // Batal juga tidak menulis pesan.
    await expect(page.getByTestId("last-wa-message-ecer")).toHaveText("");
  });

  // Regex Rupiah id-ID: prefix "Rp", angka 1–3 digit, lalu grup 3 digit
  // yang dipisah TITIK. Tidak boleh ada spasi setelah Rp, tidak boleh
  // koma sebagai pemisah ribuan. Contoh valid: "Rp10.000", "Rp1.234.567".
  // Contoh invalid: "Rp 10.000", "Rp10,000", "Rp10000".
  const RUPIAH_RE = /^Rp\d{1,3}(?:\.\d{3})*$/;

  test("Format Rupiah: total & rincian partial di pesan sama persis dengan dialog", async ({ page }) => {
    await page.getByTestId("send-wa-ep4").click();

    // Total pada dialog harus mengikuti format id-ID yang benar.
    const totalDialog = (
      await page.getByTestId("payment-summary-total-ecer").textContent()
    )?.trim() ?? "";
    expect(totalDialog).toMatch(RUPIAH_RE);
    expect(totalDialog).toBe("Rp10.000");

    await page.getByTestId("payment-method-partial").click();

    // Uji beberapa nominal partial: memastikan pemisah ribuan konsisten,
    // termasuk nominal < 1.000 (tanpa titik) dan nominal ribuan.
    const cases: Array<{ input: string; dibayar: string; sisa: string }> = [
      { input: "750", dibayar: "Rp750", sisa: "Rp9.250" },
      { input: "1500", dibayar: "Rp1.500", sisa: "Rp8.500" },
      { input: "9999", dibayar: "Rp9.999", sisa: "Rp1" },
    ];

    for (const c of cases) {
      // Re-open dialog kalau perlu (kasus pertama dialog sudah terbuka).
      if (!(await page.getByTestId("payment-dialog-ecer").isVisible())) {
        // Cari prep aktif berikutnya di seed ecer; ep4 sudah terkirim di
        // iterasi sebelumnya, sehingga kita pakai ep2 lalu ep1.
        for (const id of ["ep2", "ep1"]) {
          const btn = page.getByTestId(`send-wa-${id}`);
          if (await btn.isEnabled()) {
            await btn.click();
            break;
          }
        }
        await page.getByTestId("payment-method-partial").click();
      }

      const amountInput = page.getByTestId("payment-partial-amount-ecer");
      await amountInput.fill(c.input);

      // Sisa di dialog harus cocok format & nilai.
      const sisaDialog = (
        await page.getByTestId("payment-partial-sisa-ecer").textContent()
      )?.trim() ?? "";
      expect(sisaDialog, `sisa dialog untuk input ${c.input}`).toMatch(RUPIAH_RE);
      expect(sisaDialog).toBe(c.sisa);

      await page.getByTestId("payment-send-wa").click();

      const msg = (await page.getByTestId("last-wa-message-ecer").textContent()) ?? "";

      // Ekstrak baris relevan dari pesan.
      const totalLine = /Total: (\S+)/.exec(msg)?.[1] ?? "";
      const dibayarLine = /Dibayar: (\S+)/.exec(msg)?.[1] ?? "";
      const sisaLine = /Sisa: (\S+)/.exec(msg)?.[1] ?? "";

      // Semua nilai di pesan harus mengikuti regex Rupiah id-ID.
      expect(totalLine, `Total format untuk ${c.input}`).toMatch(RUPIAH_RE);
      expect(dibayarLine, `Dibayar format untuk ${c.input}`).toMatch(RUPIAH_RE);
      expect(sisaLine, `Sisa format untuk ${c.input}`).toMatch(RUPIAH_RE);

      // Nilai spesifik: total tetap; dibayar/sisa sesuai input.
      expect(totalLine).toBe("Rp10.000");
      expect(dibayarLine).toBe(c.dibayar);
      expect(sisaLine).toBe(c.sisa);

      // Konsistensi dialog↔pesan: nilai sisa yang tampil di dialog
      // sebelum kirim harus sama persis dengan yang muncul di pesan.
      expect(sisaLine).toBe(sisaDialog);
      // Total dari dialog sebelumnya juga cocok.
      expect(totalLine).toBe(totalDialog);

      // Anti-regresi format: pastikan tidak ada varian yang salah.
      expect(msg).not.toMatch(/Rp\s+\d/); // spasi setelah Rp
      expect(msg).not.toMatch(/Rp\d+,\d{3}/); // koma sebagai ribuan
      expect(msg).not.toMatch(/Total: Rp10000\b/); // tanpa pemisah
    }
  });

  test("Format Rupiah: metode Lunas menampilkan Total dengan pemisah ribuan", async ({ page }) => {
    await page.getByTestId("send-wa-rp2").click();
    const totalDialog = (
      await page.getByTestId("payment-summary-total-request").textContent()
    )?.trim() ?? "";
    expect(totalDialog).toMatch(RUPIAH_RE);

    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    const totalLine = /Total: (\S+)/.exec(msg)?.[1] ?? "";
    expect(totalLine).toMatch(RUPIAH_RE);
    expect(totalLine).toBe(totalDialog);
  });

  test("Catatan pelanggan di dialog muncul apa adanya di pesan WA", async ({ page }) => {
    await page.getByTestId("send-wa-ep1").click();

    const note = "Tolong antar sore ini, titip ke pos satpam.";
    const noteInput = page.getByTestId("payment-note-ecer");
    await noteInput.fill(note);
    // Nilai yang tampil di dialog adalah SSOT — pesan WA harus mencerminkan
    // apa yang user ketik sebelum menekan Kirim WA.
    await expect(noteInput).toHaveValue(note);

    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-ecer").textContent()) ?? "";
    expect(msg).toContain(`Catatan: ${note}`);
  });

  test("Catatan kosong: baris 'Catatan:' tidak muncul di pesan WA", async ({ page }) => {
    await page.getByTestId("send-wa-rp1").click();
    await expect(page.getByTestId("payment-note-request")).toHaveValue("");
    await page.getByTestId("payment-method-hutang").click();
    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    expect(msg).not.toMatch(/^Catatan:/m);
  });

  test("Whitespace-only catatan diperlakukan kosong", async ({ page }) => {
    await page.getByTestId("send-wa-ep2").click();
    await page.getByTestId("payment-note-ecer").fill("   \n\t  ");
    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-ecer").textContent()) ?? "";
    expect(msg).not.toMatch(/^Catatan:/m);
  });

  test("Catatan digabung dengan rincian partial: keduanya muncul di pesan", async ({ page }) => {
    await page.getByTestId("send-wa-ep4").click();
    await page.getByTestId("payment-method-partial").click();
    await page.getByTestId("payment-partial-amount-ecer").fill("2500");
    const note = "Hubungi via WA sebelum antar.";
    await page.getByTestId("payment-note-ecer").fill(note);

    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-ecer").textContent()) ?? "";
    expect(msg).toContain("Dibayar: Rp2.500");
    expect(msg).toContain("Sisa: Rp7.500");
    expect(msg).toContain(`Catatan: ${note}`);
  });
});