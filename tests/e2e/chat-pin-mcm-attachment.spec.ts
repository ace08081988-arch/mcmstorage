import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E — mengirim pesan **dengan lampiran** di DM pertama tetap memakai
 * identitas `PIN xxxx-xxxx` di header, list, dan transkrip; tidak boleh
 * mem-fallback ke nomor telepon peer.
 *
 * 1. Static source guard (selalu jalan):
 *    - Komponen render pesan (`chat.$conversationId`) tidak boleh mem-
 *      fallback nama pengirim / peer ke `p.phone` / `peer.phone` di
 *      cabang manapun yang menyertakan `attachment_*`.
 *    - `MessageAttachment.tsx` (bubble lampiran) tidak boleh menaruh
 *      `phone` peer sebagai judul; kolom `phone` yang muncul HANYA milik
 *      kartu kontak (payload contact card) yang eksplisit.
 *    - `AttachMenu.tsx` (sheet "Lampirkan") tidak boleh menaruh
 *      `peer.phone` / `p.phone` sebagai label peer di header sheet.
 *
 * 2. Runtime UI (butuh storageState + minimal 1 DM, self-skip jika
 *    tidak ada):
 *    - Buka DM pertama.
 *    - Buka sheet "Lampirkan" (tanpa perlu benar-benar meng-upload
 *      file — Capacitor path tidak eksis di browser test).
 *    - Header conversation + isi sheet tidak memunculkan nomor telp
 *      mentah; kalau ada label identitas, formatnya harus `PIN xxxx-xxxx`.
 *    - Tutup sheet, kirim pesan teks penanda; token muncul di transkrip
 *      dan main area tetap bebas nomor telp mentah.
 *    - Bila di transkrip sudah ada pesan lampiran lama (bubble
 *      `[data-attachment]` / mime badge), verifikasi label peer di
 *      dekatnya tetap `PIN …`.
 */

const STORAGE = "tests/visual/.auth/user.json";
// Cocok utk nomor Indonesia mentah — tidak akan menangkap `PIN 1234-5678`.
const PHONE_LIKE = /(?:\+?62|0)8\d{7,12}/;
const PIN_FMT = /PIN\s+[A-Z0-9]{4}-[A-Z0-9]{4}/i;

function hasAuthState(): boolean {
  if (!existsSync(STORAGE)) return false;
  try {
    const raw = JSON.parse(readFileSync(STORAGE, "utf8")) as {
      origins?: Array<{ localStorage?: Array<{ name: string }> }>;
    };
    return (raw.origins ?? []).some((o) =>
      (o.localStorage ?? []).some((kv) => /^sb-.*-auth-token$/.test(kv.name)),
    );
  } catch {
    return false;
  }
}

// ── 1) Source guards ──────────────────────────────────────────────────
test.describe("chat + lampiran — source guard: identitas peer tidak boleh fallback ke phone", () => {
  test("chat.$conversationId: baris lampiran tidak memakai p.phone sebagai nama pengirim", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated.chat.$conversationId.tsx"),
      "utf8",
    );
    // Fallback berbahaya `... || p.phone` dilarang sepenuhnya di file ini
    // karena berlaku juga untuk cabang render pesan berlampiran.
    expect(src).not.toMatch(/\|\|\s*p\.phone\b/);
    expect(src).not.toMatch(/\|\|\s*peer\.phone\b/);
    // Jaga: cabang render attachment TETAP mereferensikan formatInviteCode
    // untuk fallback nama, bukan phone.
    expect(src).toMatch(/attachment_path/);
    expect(src).toMatch(/formatInviteCode\(p\.invite_code\)/);
  });

  test("MessageAttachment.tsx: tidak memakai peer.phone sebagai fallback identitas bubble", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/chat/MessageAttachment.tsx"),
      "utf8",
    );
    // `card.phone` (payload contact card) DIIZINKAN — itu memang isi kartu.
    // Yang dilarang: `peer.phone` / `p.phone` sebagai fallback nama tampil.
    expect(src).not.toMatch(/\|\|\s*peer\.phone\b/);
    expect(src).not.toMatch(/\|\|\s*p\.phone\b/);
    // Guard tambahan: setiap kemunculan `phone` di file ini WAJIB
    // berbentuk `card.phone` (payload contact-card yang sengaja dikirim
    // user). Kalau ada bentuk lain, itu regresi identitas.
    const nonCardPhone = (src.match(/\bphone\b/g) ?? []).length
      - (src.match(/\bcard\.phone\b/g) ?? []).length;
    expect(nonCardPhone, "phone di MessageAttachment hanya boleh via card.phone").toBe(0);
  });

  test("AttachMenu.tsx: header sheet tidak mem-render peer.phone sebagai label", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/chat/AttachMenu.tsx"),
      "utf8",
    );
    // `phone` state lokal untuk form contact-card diizinkan; yang dilarang:
    // menempelkan peer.phone / p.phone ke label peer di sheet Lampirkan.
    expect(src).not.toMatch(/\|\|\s*peer\.phone\b/);
    expect(src).not.toMatch(/\|\|\s*p\.phone\b/);
  });
});

// ── 2) Runtime UI (auth-gated) ────────────────────────────────────────
test.describe("chat + lampiran — runtime: DM pertama tetap pakai PIN saat sheet Lampirkan dibuka & saat kirim", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("buka DM pertama → sheet Lampirkan → header + sheet tanpa phone; kirim pesan penanda tetap bersih", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    const firstConv = page.locator('a[href^="/chat/"]').first();
    test.skip(
      (await firstConv.count()) === 0,
      "Akun test belum punya DM — skip runtime lampiran.",
    );
    await firstConv.click();
    await page.waitForURL(/\/chat\/[0-9a-f-]{36}/);

    // Header conversation: tanpa nomor telp mentah.
    const header = page.locator("header, [role='banner']").first();
    const headerTxt = (await header.innerText().catch(() => "")) || "";
    expect(headerTxt, "header sebelum buka sheet Lampirkan").not.toMatch(PHONE_LIKE);

    // Buka sheet "Lampirkan". Kalau tidak ada (mis. peer bukan friend
    // yang membolehkan attach), self-skip bagian ini tapi tetap
    // pastikan header bersih.
    const attachBtn = page.getByRole("button", { name: /^Lampirkan(?:\s|$)/i });
    if ((await attachBtn.count()) > 0) {
      await attachBtn.first().click();
      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();
      const sheetTxt = await sheet.innerText();
      expect(sheetTxt, "sheet Lampirkan tidak boleh memuat nomor telp peer")
        .not.toMatch(PHONE_LIKE);
      if (/PIN\s+/i.test(sheetTxt)) {
        expect(sheetTxt).toMatch(PIN_FMT);
      }
      // Tutup sheet — Escape lebih tahan banting daripada mencari tombol X.
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden({ timeout: 3000 });
    }

    // Kirim pesan penanda (tanpa file upload — Capacitor path tak ada
    // di browser test). Ini memvalidasi bahwa jalur "kirim di DM
    // pertama" tetap mengunci identitas PIN di header + transkrip.
    const token = `pin-mcm-attach-${Date.now().toString(36)}`;
    const composer = page.getByPlaceholder("Tulis pesan…");
    await expect(composer).toBeVisible();
    await composer.fill(token);
    await page.getByRole("button", { name: /^kirim$/i }).click();
    await expect(page.getByText(token, { exact: false })).toBeVisible({
      timeout: 8000,
    });

    // Setelah kirim: header + main tetap bebas nomor telp mentah.
    const headerTxt2 = (await header.innerText().catch(() => "")) || "";
    expect(headerTxt2, "header setelah kirim").not.toMatch(PHONE_LIKE);
    const mainTxt = await page.locator("main, body").first().innerText();
    expect(mainTxt, "main area setelah kirim").not.toMatch(PHONE_LIKE);

    // Bila di transkrip ada bubble lampiran lama (ditandai tombol
    // "Unduh"/"Buka" atau alt image), pastikan label PIN masih dominan
    // sebagai fallback identitas — pilihannya: minimal satu PIN muncul
    // di area transkrip.
    const hasOldAttachment = await page
      .getByRole("button", { name: /unduh|buka lampiran|preview/i })
      .count();
    if (hasOldAttachment > 0 && /PIN\s+/i.test(mainTxt)) {
      expect(mainTxt).toMatch(PIN_FMT);
    }
  });
});