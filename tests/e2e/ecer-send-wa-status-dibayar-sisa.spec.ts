// E2E: label status pembayaran (Lunas / Bayar sebagian / Hutang) serta
// baris "Dibayar" & "Sisa" di pesan WA HARUS selalu konsisten dengan data
// item yang aktif, termasuk setelah:
//   1. mengedit nominal `payment-partial-amount-<scope>` beberapa kali
//   2. mengganti-ganti metode (kas/hutang/partial) sebelum kirim
//   3. berpindah antar item (paket A → paket B) dengan total berbeda
//
// Invarian yang dijaga:
//   - Metode = Lunas  → baris "Pembayaran: Lunas", tidak ada Dibayar/Sisa
//   - Metode = Hutang → baris "Pembayaran: Hutang", tidak ada Dibayar/Sisa
//   - Metode = partial → baris "Pembayaran: Bayar sebagian",
//                         Dibayar == input, Sisa == Total - Dibayar,
//                         dan Sisa di dialog UI (`payment-partial-sisa`)
//                         sama persis dengan baris "Sisa:" di pesan WA.
//   - Setelah pindah item, "Total:" dalam pesan == angka
//     `payment-summary-total-<scope>` dari item baru (bukan carry-over
//     dari item sebelumnya). Dibayar/Sisa selanjutnya dihitung terhadap
//     total baru itu.
import { test, expect } from "@playwright/test";

const URL = "/lovable/visual/ready-badges-selector";
const RUPIAH_RE = /^Rp\d{1,3}(?:\.\d{3})*$/;

/** Parse "Rp10.000" → 10000. */
function parseRp(s: string): number {
  const m = /^Rp([\d.]+)$/.exec(s.trim());
  if (!m) throw new Error(`bukan format Rupiah: ${s}`);
  return Number(m[1].replace(/\./g, ""));
}

/** Ambil nilai dari baris "Prefix: <value>" pertama di pesan. */
function lineValue(msg: string, prefix: string): string | null {
  const line = msg.split("\n").find((l) => l.startsWith(`${prefix}:`));
  if (!line) return null;
  return line.slice(prefix.length + 1).trim();
}

test.describe("Status & Dibayar/Sisa selalu match data item", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByRole("heading", { name: /Ready Badges/i })).toBeVisible();
  });

  test("Lunas: 'Pembayaran: Lunas' + tidak ada Dibayar/Sisa", async ({ page }) => {
    await page.getByTestId("send-wa-rp1").click();
    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    expect(lineValue(msg, "Pembayaran")).toBe("Lunas");
    expect(lineValue(msg, "Dibayar")).toBeNull();
    expect(lineValue(msg, "Sisa")).toBeNull();
  });

  test("Hutang: 'Pembayaran: Hutang' + tidak ada Dibayar/Sisa", async ({ page }) => {
    await page.getByTestId("send-wa-rp2").click();
    await page.getByTestId("payment-method-hutang").click();
    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    expect(lineValue(msg, "Pembayaran")).toBe("Hutang");
    expect(lineValue(msg, "Dibayar")).toBeNull();
    expect(lineValue(msg, "Sisa")).toBeNull();
  });

  test("Bayar sebagian: Dibayar == input, Sisa == Total - Dibayar (dialog & WA)", async ({ page }) => {
    await page.getByTestId("send-wa-ep4").click();

    const totalTxt = (
      await page.getByTestId("payment-summary-total-ecer").textContent()
    )?.trim() ?? "";
    expect(totalTxt).toMatch(RUPIAH_RE);
    const total = parseRp(totalTxt);

    await page.getByTestId("payment-method-partial").click();
    await page.getByTestId("payment-partial-amount-ecer").fill("2500");

    // Dialog UI harus menampilkan sisa yang benar sebelum kirim.
    const sisaDialog = (
      await page.getByTestId("payment-partial-sisa-ecer").textContent()
    )?.trim() ?? "";
    expect(sisaDialog).toMatch(RUPIAH_RE);
    expect(parseRp(sisaDialog)).toBe(total - 2500);

    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-ecer").textContent()) ?? "";
    expect(lineValue(msg, "Pembayaran")).toBe("Bayar sebagian");
    const dibayar = lineValue(msg, "Dibayar") ?? "";
    const sisa = lineValue(msg, "Sisa") ?? "";
    expect(dibayar).toMatch(RUPIAH_RE);
    expect(sisa).toMatch(RUPIAH_RE);
    expect(parseRp(dibayar)).toBe(2500);
    expect(parseRp(sisa)).toBe(total - 2500);

    // Total di pesan == total di dialog (SSOT).
    const totalMsg = lineValue(msg, "Total") ?? "";
    expect(parseRp(totalMsg)).toBe(total);
  });

  test("Edit nominal berkali-kali: Dibayar/Sisa akhir mengikuti nilai terakhir", async ({ page }) => {
    await page.getByTestId("send-wa-ep1").click();

    const total = parseRp(
      (await page.getByTestId("payment-summary-total-ecer").textContent())?.trim() ?? "",
    );

    await page.getByTestId("payment-method-partial").click();
    // Beberapa edit — hanya nilai TERAKHIR yang harus terkirim.
    await page.getByTestId("payment-partial-amount-ecer").fill("1000");
    await page.getByTestId("payment-partial-amount-ecer").fill("3000");
    await page.getByTestId("payment-partial-amount-ecer").fill("4500");

    // Verifikasi reaktifitas dialog: sisa live == total - 4500.
    const sisaLive = parseRp(
      (await page.getByTestId("payment-partial-sisa-ecer").textContent())?.trim() ?? "",
    );
    expect(sisaLive).toBe(total - 4500);

    await page.getByTestId("payment-send-wa").click();
    const msg = (await page.getByTestId("last-wa-message-ecer").textContent()) ?? "";
    expect(lineValue(msg, "Pembayaran")).toBe("Bayar sebagian");
    expect(parseRp(lineValue(msg, "Dibayar") ?? "")).toBe(4500);
    expect(parseRp(lineValue(msg, "Sisa") ?? "")).toBe(total - 4500);
    // Draft nominal sebelumnya tidak boleh nyangkut.
    expect(msg).not.toMatch(/Dibayar: Rp1\.000\b/);
    expect(msg).not.toMatch(/Dibayar: Rp3\.000\b/);
  });

  test("Toggle metode partial → hutang → kas: hanya metode terakhir yang berlaku", async ({ page }) => {
    // rp2 masih aktif (rp3 sudah `sold_at` di harness — tombolnya disabled).
    await page.getByTestId("send-wa-rp2").click();

    await page.getByTestId("payment-method-partial").click();
    await page.getByTestId("payment-partial-amount-request").fill("2000");
    // Ganti ke Hutang — Dibayar/Sisa harus HILANG dari pesan.
    await page.getByTestId("payment-method-hutang").click();
    // Lalu ke Kas — final: Lunas.
    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    expect(lineValue(msg, "Pembayaran")).toBe("Lunas");
    expect(lineValue(msg, "Dibayar")).toBeNull();
    expect(lineValue(msg, "Sisa")).toBeNull();
  });

  test("Pindah antar item: Total/Dibayar/Sisa mengikuti item baru, bukan carry-over", async ({ page }) => {
    // Sesi A: rp1, partial 1500.
    await page.getByTestId("send-wa-rp1").click();
    const totalA = parseRp(
      (await page.getByTestId("payment-summary-total-request").textContent())?.trim() ?? "",
    );
    await page.getByTestId("payment-method-partial").click();
    await page.getByTestId("payment-partial-amount-request").fill("1500");
    await page.getByTestId("payment-send-wa").click();

    let msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    expect(parseRp(lineValue(msg, "Total") ?? "")).toBe(totalA);
    expect(parseRp(lineValue(msg, "Dibayar") ?? "")).toBe(1500);
    expect(parseRp(lineValue(msg, "Sisa") ?? "")).toBe(totalA - 1500);

    // Sesi B: item berbeda (rp4) — total mungkin sama atau beda, tapi
    // yang penting Dibayar/Sisa DIHITUNG ULANG dari total item B, bukan
    // dari totalA.
    await page.getByTestId("send-wa-rp4").click();
    const totalB = parseRp(
      (await page.getByTestId("payment-summary-total-request").textContent())?.trim() ?? "",
    );
    // Field partial harus reset (bukan carry "1500" dari sesi A).
    await expect(page.getByTestId("payment-method-partial")).not.toHaveClass(/font-semibold/);
    await page.getByTestId("payment-method-partial").click();
    await page.getByTestId("payment-partial-amount-request").fill("500");

    const sisaLive = parseRp(
      (await page.getByTestId("payment-partial-sisa-request").textContent())?.trim() ?? "",
    );
    expect(sisaLive).toBe(totalB - 500);

    await page.getByTestId("payment-send-wa").click();
    msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    expect(lineValue(msg, "Pembayaran")).toBe("Bayar sebagian");
    expect(parseRp(lineValue(msg, "Total") ?? "")).toBe(totalB);
    expect(parseRp(lineValue(msg, "Dibayar") ?? "")).toBe(500);
    expect(parseRp(lineValue(msg, "Sisa") ?? "")).toBe(totalB - 500);
    // Anti-carry: nominal sesi A (1500) tidak boleh muncul lagi.
    expect(msg).not.toMatch(/Dibayar: Rp1\.500\b/);
  });
});