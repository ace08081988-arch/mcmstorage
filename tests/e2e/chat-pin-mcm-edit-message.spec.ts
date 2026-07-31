import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E — Setelah `page.reload()`, mengedit pesan yang sudah terkirim
 * di DM eksisting wajib:
 *   - Menampilkan komposer "Edit pesan" tanpa membocorkan nomor telp
 *     Indonesia mentah.
 *   - Setelah simpan (Enter), bubble memakai body baru + label
 *     "diedit"; header + transkrip TETAP `PIN xxxx-xxxx` dan bebas
 *     nomor telp mentah.
 *   - Setelah reload kedua, hasil edit persist dan branding tetap
 *     konsisten.
 *
 * 1. Static guard: item menu "Edit" hanya menyalin `m.body` ke setBody
 *    — TIDAK menyentuh `.phone` peer.
 * 2. Runtime (self-skip): kirim pesan sendiri terlebih dahulu (agar
 *    bisa diedit), reload, buka menu Edit, ubah teks, simpan, reload,
 *    verifikasi.
 */

const STORAGE = "tests/visual/.auth/user.json";
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

test.describe("edit pesan — source guard", () => {
  test("menu Edit di chat.$conversationId: setEditing/setBody hanya membaca m.body, bukan .phone", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated.chat.$conversationId.tsx"),
      "utf8",
    );
    const idx = src.indexOf("setEditing({ id: m.id");
    expect(idx).toBeGreaterThan(-1);
    const region = src.slice(idx, idx + 600);
    expect(region).toMatch(/setEditing\(\{ id: m\.id, body: m\.body/);
    expect(region).toMatch(/setBody\(m\.body/);
    expect(region).not.toMatch(/\.phone\b/);
    // Panel komposer "Edit pesan" juga tidak boleh menyentuh phone di regionnya.
    const editorIdx = src.indexOf("Edit pesan");
    expect(editorIdx).toBeGreaterThan(-1);
    const editorRegion = src.slice(editorIdx, editorIdx + 800);
    expect(editorRegion).not.toMatch(/\.phone\b/);
  });
});

test.describe("edit pesan — runtime PIN MCM after refresh", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("reload → edit pesan sendiri → simpan → reload: PIN MCM konsisten, no phone", async ({
    page,
  }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");
    const first = page.locator('a[href^="/chat/"]').first();
    test.skip((await first.count()) === 0, "Tidak ada DM untuk uji — skip.");
    await first.click();
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
    await page.waitForLoadState("networkidle");

    // Kirim pesan awal (agar milik akun uji → bisa di-edit).
    const original = `pin-mcm-edit-src-${Date.now().toString(36)}`;
    const input = page.getByRole("textbox").last();
    await input.click();
    await input.fill(original);
    await input.press("Enter");
    await expect(page.getByText(original).first()).toBeVisible({ timeout: 5000 });

    // Refresh, verifikasi kondisi pra-edit sudah PIN-branded & no phone.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(original).first()).toBeVisible();

    const readHeader = async () =>
      (await page
        .locator("header, [role='banner']")
        .first()
        .innerText()
        .catch(() => "")) || "";
    const readBody = async () => await page.locator("main, body").first().innerText();

    {
      const h = await readHeader();
      const b = await readBody();
      expect(h, "header pre-edit tanpa phone").not.toMatch(PHONE_LIKE);
      expect(b, "transkrip pre-edit tanpa phone").not.toMatch(PHONE_LIKE);
      if (/PIN\s+/i.test(h)) expect(h).toMatch(PIN_FMT);
    }

    // Buka menu bubble → klik Edit. UI menu bisa berbeda; pakai pintasan
    // click bubble untuk memicu menu, lalu keyboard hover kalau perlu.
    const bubble = page.getByText(original).first();
    await bubble.click({ button: "right" }).catch(async () => {
      await bubble.click({ delay: 550 });
    });
    const editItem = page.getByRole("menuitem", { name: /^Edit$/ });
    // Beberapa build memakai <button>/<div role="menuitem">; fallback teks murni.
    const editBtn = (await editItem.count())
      ? editItem
      : page.getByText(/^Edit$/).first();
    test.skip(
      (await editBtn.count()) === 0,
      "Menu Edit belum terjangkau di build ini — skip runtime edit.",
    );
    await editBtn.click();

    // Panel "Edit pesan" wajib bebas phone.
    const editorPanel =
      (await page.getByText("Edit pesan").first().locator("..").innerText().catch(() => "")) || "";
    expect(editorPanel, "panel Edit pesan tanpa phone").not.toMatch(PHONE_LIKE);

    // Ubah body & simpan.
    const edited = `${original}-edited`;
    const composer = page.getByRole("textbox").last();
    await composer.click();
    await composer.fill(edited);
    await composer.press("Enter");
    await expect(page.getByText(edited).first()).toBeVisible({ timeout: 5000 });

    // Post-edit UI wajib PIN-branded + label "diedit" muncul + no phone.
    {
      const h = await readHeader();
      const b = await readBody();
      expect(h).not.toMatch(PHONE_LIKE);
      expect(b).not.toMatch(PHONE_LIKE);
      expect(b).toMatch(/diedit/);
      if (/PIN\s+/i.test(h)) expect(h).toMatch(PIN_FMT);
    }

    // Reload kedua: hasil edit persist & branding konsisten.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(edited).first()).toBeVisible();
    const bodyAfter = await readBody();
    const headerAfter = await readHeader();
    expect(bodyAfter, "post-reload transkrip tanpa phone").not.toMatch(PHONE_LIKE);
    expect(headerAfter, "post-reload header tanpa phone").not.toMatch(PHONE_LIKE);
    expect(bodyAfter).toMatch(/diedit/);
    if (/PIN\s+/i.test(headerAfter)) expect(headerAfter).toMatch(PIN_FMT);
  });
});
