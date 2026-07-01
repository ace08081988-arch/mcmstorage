import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E — mulai DM baru **dari halaman daftar kontak** (`/kontak`), bukan
 * dari `/chat`. Fokus:
 *
 *   1. Static source guard (selalu jalan): tombol "Chat" di halaman
 *      `/kontak` memanggil `useStartDm` lalu `navigate({ to:
 *      "/chat/$conversationId", ... })` sehingga pesan yang dikirim
 *      pasti masuk ke ID percakapan yang sama dengan yang dibuat oleh
 *      RPC. Dan NewDmDialog global memakai placeholder PIN MCM.
 *   2. Runtime UI (butuh storageState + minimal 1 kontak `Tertaut`,
 *      self-skip bila tidak ada): buka `/kontak` → klik "Chat" di baris
 *      tertaut → URL berpindah ke `/chat/<uuid>` → header bebas nomor
 *      telp → kirim pesan token unik → token muncul di transkrip →
 *      reload halaman percakapan → token tetap ada (bukti pesan masuk
 *      ke percakapan yang benar, bukan sekadar optimistik lokal).
 *   3. Cross-check: kembali ke `/chat`, buka dialog "Chat baru", pastikan
 *      placeholder PIN MCM juga terlihat di flow ini — sehingga pintu
 *      masuk lain (dari daftar kontak → dari daftar chat) tetap konsisten.
 */

const STORAGE = "tests/visual/.auth/user.json";
const PHONE_LIKE = /(?:\+?62|0)8\d{7,12}/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

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

// ── 1) Source guard: kontak → chat wiring & dialog placeholder ────────
test.describe("kontak → DM: wiring startDm + navigate($conversationId)", () => {
  test("halaman /kontak: tombol Chat pakai startDm.mutateAsync lalu navigate ke /chat/$conversationId", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated.kontak.tsx"),
      "utf8",
    );
    // Harus memakai mutateAsync (bukan mutate) supaya id percakapan
    // dipakai untuk navigate — kalau ada regresi ke `mutate` fire-and-forget
    // navigate akan pakai id yang undefined dan pesan masuk ke percakapan
    // yang salah.
    expect(src).toMatch(/startDm\.mutateAsync\(\s*row\.account_user_id\s*\)/);
    expect(src).toMatch(
      /navigate\(\s*\{\s*to:\s*"\/chat\/\$conversationId"\s*,\s*params:\s*\{\s*conversationId\s*\}/,
    );
    // Guard: jangan sampai berubah ke redirect string manual (mis. `/chat`)
    // yang bikin pesan mendarat di list, bukan di conversation baru.
    expect(src).not.toMatch(/navigate\(\s*\{\s*to:\s*"\/chat"\s*\}\s*\)\s*;[^\n]*startDm/);
  });

  test("halaman /buku-alamat: tombol Chat juga memakai pola yang sama", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated.buku-alamat.tsx"),
      "utf8",
    );
    expect(src).toMatch(/startDm\.mutateAsync\(\s*row\.linked_user_id\s*\)/);
    expect(src).toMatch(
      /navigate\(\s*\{\s*to:\s*"\/chat\/\$conversationId"\s*,\s*params:\s*\{\s*conversationId:\s*cid\s*\}/,
    );
  });

  test("NewDmDialog (dipakai oleh entry dari halaman chat): placeholder PIN MCM", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/chat/NewDmDialog.tsx"),
      "utf8",
    );
    expect(src).toMatch(/placeholder="Cari nama atau PIN MCM…"/);
    expect(src).not.toMatch(/placeholder="Cari nama atau nomor telepon/i);
  });
});

// ── 2) Runtime: buka /kontak → klik Chat → kirim pesan → verifikasi ───
test.describe("kontak → DM: runtime flow (auth-gated)", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("dari /kontak: klik Chat pada baris tertaut memulai DM & pesan masuk percakapan yang benar", async ({ page }) => {
    await page.goto("/kontak");
    await page.waitForLoadState("networkidle");

    // Cari baris kontak yang punya tombol "Chat" (artinya sudah tertaut
    // akun). Kalau tidak ada, skip — akun test belum siap.
    const chatBtn = page.getByRole("button", { name: /^chat$/i }).first();
    test.skip(
      (await chatBtn.count()) === 0,
      "Belum ada kontak dengan akun tertaut — skip runtime.",
    );

    await Promise.all([
      page.waitForURL(new RegExp(`/chat/${UUID.source}`)),
      chatBtn.click(),
    ]);
    const convUrl = page.url();
    const convId = convUrl.match(UUID)?.[0] ?? "";
    expect(convId, "URL /chat/<uuid> harus punya UUID valid").toMatch(UUID);

    // Header bebas nomor telepon mentah (fallback PIN MCM).
    const header = page.locator("header, [role='banner']").first();
    const headerTxt = (await header.innerText().catch(() => "")) || "";
    expect(headerTxt, "header tidak boleh menampilkan nomor telp mentah")
      .not.toMatch(PHONE_LIKE);

    // Kirim pesan dengan token unik agar bisa dilacak setelah reload.
    const token = `pin-mcm-kontak-${Date.now().toString(36)}`;
    const composer = page.getByPlaceholder("Tulis pesan…");
    await expect(composer).toBeVisible();
    await composer.fill(token);
    await page.getByRole("button", { name: /^kirim$/i }).click();

    // Token muncul di transkrip percakapan (bukti optimistik/insert OK).
    await expect(page.getByText(token, { exact: false })).toBeVisible({
      timeout: 8000,
    });

    // Reload halaman percakapan yang sama; token TETAP ada → pesan
    // memang tersimpan ke conversation id yang benar (bukan drop lokal).
    await page.reload({ waitUntil: "networkidle" });
    await expect(page).toHaveURL(new RegExp(convId));
    await expect(page.getByText(token, { exact: false })).toBeVisible({
      timeout: 10_000,
    });

    // Konsistensi: main area tetap bebas nomor telp mentah.
    const mainTxt = await page.locator("main, body").first().innerText();
    expect(mainTxt).not.toMatch(PHONE_LIKE);
  });

  test("balik ke /chat: dialog 'Chat baru' tetap pakai placeholder PIN MCM", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");
    const newBtn = page.getByRole("button", { name: /chat baru/i });
    test.skip((await newBtn.count()) === 0, "Tombol Chat baru tidak ada — skip.");
    await newBtn.click();
    const input = page.getByPlaceholder("Cari nama atau PIN MCM…");
    await expect(input).toBeVisible();
    // Isi tidak boleh membuka fallback nomor telp mentah di dialog.
    const dialogTxt = await page.getByRole("dialog").innerText();
    expect(dialogTxt).not.toMatch(PHONE_LIKE);
  });
});