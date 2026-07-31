import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E: seluruh permukaan chat menampilkan `PIN xxxx-xxxx` sebagai
 * fallback identitas — bukan nomor telepon. Cakupan:
 *
 *  1. Static source guard (selalu jalan): file rute & komponen chat
 *     tidak boleh mem-fallback `p.phone` / `peer.phone` untuk NAMA
 *     yang tampil. Menangkap regresi meski CI tidak punya auth state.
 *  2. Runtime UI (butuh storageState, self-skip jika kosong):
 *     - `/chat` tidak menampilkan string nomor telepon Indonesia
 *       (`+62…`, `62…`, `08…`) sebagai judul percakapan.
 *     - Dialog "Chat baru" memakai placeholder "PIN MCM"; kolom teks
 *       hasil kontak memformat invite_code jadi `PIN xxxx-xxxx`.
 *     - Membuka percakapan DM: header memakai `PIN xxxx-xxxx` bila
 *       peer tidak punya display_name; mengirim pesan sukses dan
 *       teks pesan tampil di transkrip tanpa memunculkan nomor telp.
 */

const STORAGE = "tests/visual/.auth/user.json";
const PHONE_LIKE = /(?:\+?62|0)8\d{7,12}/; // heuristik nomor Indonesia
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

// ── 1) Static source guard ────────────────────────────────────────────
test.describe("chat surface — source guard: tidak boleh fallback ke phone untuk display name", () => {
  const files = [
    "src/components/chat/NewDmDialog.tsx",
    "src/routes/_authenticated.chat.$conversationId.tsx",
    "src/routes/_authenticated.chat.index.tsx",
  ];

  for (const rel of files) {
    test(`${rel}: tidak memakai p.phone / peer.phone sebagai fallback nama`, () => {
      const src = readFileSync(resolve(process.cwd(), rel), "utf8");
      // Pola berbahaya: `... || p.phone` atau `... || peer.phone` sebagai
      // ekspresi nama tampilan. Kalau balik lagi, spec langsung merah.
      expect(src).not.toMatch(/\|\|\s*p\.phone\b/);
      expect(src).not.toMatch(/\|\|\s*peer\.phone\b/);
      expect(src).not.toMatch(/\|\|\s*profile\.phone\b/);
    });
  }

  test("NewDmDialog: placeholder pencarian menyebut PIN MCM, bukan nomor telepon", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/chat/NewDmDialog.tsx"),
      "utf8",
    );
    expect(src).toMatch(/placeholder="Cari nama atau PIN MCM…"/);
    expect(src).not.toMatch(/placeholder="Cari nama atau nomor telepon/i);
    // Rendering item: harus memformat invite_code jadi `PIN xxxx-xxxx`.
    expect(src).toMatch(/PIN \$\{formatInviteCode\(c\.invite_code\)\}/);
  });

  test("header/typing conversation: fallback pakai formatInviteCode, bukan phone", () => {
    const src = readFileSync(
      resolve(
        process.cwd(),
        "src/routes/_authenticated.chat.$conversationId.tsx",
      ),
      "utf8",
    );
    // Minimal 3 lokasi (header, dmPeer.fallbackName, typing) yang wajib pakai PIN.
    const hits = src.match(
      /invite_code\s*\?\s*`PIN \$\{formatInviteCode\(p\.invite_code\)\}`/g,
    );
    expect(hits?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

// ── 2) Runtime UI (auth-gated) ────────────────────────────────────────
test.describe("chat surface — runtime: PIN MCM di /chat, dialog DM baru, dan kirim pesan", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("/chat: judul percakapan tidak menampilkan nomor telepon mentah", async ({ page }) => {
    await page.goto("/chat");
    // Tunggu list ter-mount (empty state pun OK).
    await page.waitForLoadState("networkidle");
    // Ambil hanya teks judul di list, bukan seluruh DOM (input pencarian
    // & elemen tersembunyi tidak dihitung).
    const titles = await page.locator("main").innerText();
    expect(titles, "judul chat tidak boleh mengandung nomor telp mentah")
      .not.toMatch(PHONE_LIKE);
  });

  test("dialog 'Chat baru': placeholder PIN MCM & format PIN pada hasil", async ({ page }) => {
    await page.goto("/chat");
    await page.getByRole("button", { name: /chat baru/i }).click();
    const input = page.getByPlaceholder("Cari nama atau PIN MCM…");
    await expect(input).toBeVisible();
    // Ketik apa pun; kalau ada hasil, minimal satu row memformat `PIN xxxx-xxxx`.
    await input.fill("PIN");
    await page.waitForTimeout(400);
    const dialogText = await page.getByRole("dialog").innerText();
    // Tidak wajib punya hasil (tenant test mungkin kosong), tapi kalau ada
    // teks "PIN …" harus formatnya benar; dan tidak boleh menyisipkan
    // nomor telp mentah di dialog.
    if (/PIN\s+/i.test(dialogText)) {
      expect(dialogText).toMatch(PIN_FMT);
    }
    expect(dialogText).not.toMatch(PHONE_LIKE);
  });

  test("buka percakapan pertama & kirim pesan: header pakai PIN, transkrip menampilkan pesan tanpa phone", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");
    const firstConv = page.locator('a[href^="/chat/"]').first();
    test.skip(
      (await firstConv.count()) === 0,
      "Akun test belum punya percakapan — skip.",
    );
    await firstConv.click();
    await page.waitForURL(/\/chat\/[0-9a-f-]{36}/);

    // Header tidak menampilkan nomor telepon.
    const header = page.locator("header, [role='banner']").first();
    const headerTxt = (await header.innerText().catch(() => "")) || "";
    expect(headerTxt).not.toMatch(PHONE_LIKE);

    // Kirim pesan sederhana; token unik supaya bisa dilacak di transkrip.
    const token = `pin-mcm-e2e-${Date.now().toString(36)}`;
    const composer = page.getByPlaceholder("Tulis pesan…");
    await expect(composer).toBeVisible();
    await composer.fill(token);
    await page.getByRole("button", { name: /^kirim$/i }).click();

    // Pesan muncul di transkrip.
    await expect(page.getByText(token, { exact: false })).toBeVisible({
      timeout: 8000,
    });

    // Setelah kirim, seluruh main area tetap bebas nomor telp mentah
    // (guard tambahan: transkrip merender nama peer dengan fallback PIN).
    const mainTxt = await page.locator("main").innerText();
    expect(mainTxt).not.toMatch(PHONE_LIKE);
  });
});
