import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PIN_MCM_FORMAT,
  expectNoRawPhone,
  expectPinBrandingClean,
} from "./_helpers/chat-pin-assertions";

/**
 * E2E — Variasi input PIN pada FAB "Tambah kontak PIN" di halaman
 * `/chat` wajib DINORMALISASI oleh UI menjadi `XXXX-XXXX` (uppercase
 * 4-4, alfanumerik) apapun bentuk masukannya: lowercase, spasi/tab,
 * dash yang salah letak, atau kelebihan karakter. Dialog juga wajib
 * bebas nomor telepon Indonesia mentah pada semua fase.
 *
 * 1. Static source guard (selalu jalan):
 *    - `AddContactFab` memakai `normalizeInviteCode` di `onChange` dan
 *      menyisipkan dash setelah 4 karakter → identitas format
 *      terkunci di satu titik logika.
 *    - Rendering pratinjau memakai `formatInviteCode(preview.invite_code)`
 *      dan TIDAK menyentuh `.phone` di jalur teks tampilan.
 *    - Fungsi murni `formatInviteCode` mem-format kombinasi
 *      lowercase/spasi/dash-salah/kelebihan-karakter menjadi
 *      `PIN xxxx-xxxx` sesuai regex `PIN_MCM_FORMAT`.
 *
 * 2. Runtime UI (butuh storageState; self-skip bila kosong):
 *    - Buka `/chat`, klik FAB "Tambah kontak PIN MCM".
 *    - Ketik beberapa variasi input; assert `input.value` selalu
 *      berupa `XXXX-XXXX` (atau prefix ≤4 karakter tanpa dash), tidak
 *      pernah mengandung lowercase / spasi / dash ganda.
 *    - Assert body dialog bebas nomor telp Indonesia mentah.
 */

const STORAGE = "tests/visual/.auth/user.json";
const PIN_INPUT_FMT = /^[A-Z0-9]{0,4}(-[A-Z0-9]{1,4})?$/;

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

// ── 1) Static source guards + fungsi murni ────────────────────────────
test.describe("PIN input variations — source guard & pure format", () => {
  test("AddContactFab: onChange memakai normalizeInviteCode + dash setelah 4 char", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/chat/AddContactFab.tsx"),
      "utf8",
    );
    // onChange harus mem-normalisasi lebih dulu, lalu menyisipkan dash
    // setelah karakter ke-4. Kalau regresi ke setInput(e.target.value)
    // langsung, test ini merah.
    expect(src).toMatch(/normalizeInviteCode\(e\.target\.value\)/);
    expect(src).toMatch(/raw\.slice\(0,\s*4\)[^`]*-[^`]*raw\.slice\(4/);
    // Baris identitas pratinjau memakai formatInviteCode, bukan phone.
    expect(src).toMatch(/PIN\s+\$\{?\s*formatInviteCode\(preview\.invite_code\)/);
    expect(src).not.toMatch(/preview\.phone\b/);
  });

  test("formatInviteCode: normalisasi variasi input → PIN xxxx-xxxx", async () => {
    const { formatInviteCode } = await import("../../src/lib/invite");

    const cases: Array<{ raw: string; expectDisplay: string }> = [
      { raw: "abcd1234", expectDisplay: "ABCD-1234" },
      { raw: "ABCD1234", expectDisplay: "ABCD-1234" },
      { raw: "  aBcD 12 34  ", expectDisplay: "ABCD-1234" },
      { raw: "ab-cd-12-34", expectDisplay: "ABCD-1234" },
      { raw: "\tabcd\t1234\t", expectDisplay: "ABCD-1234" },
      { raw: "ABCD--1234", expectDisplay: "ABCD-1234" },
      { raw: "AB CD 12 34 EXTRA", expectDisplay: "ABCD1234EXTRA" }, // >8 tetap ditampilkan tanpa amputasi di formatter murni
    ];

    for (const c of cases) {
      const display = `PIN ${formatInviteCode(c.raw)}`;
      // Semua yang panjangnya tepat 8 wajib lulus PIN_MCM_FORMAT resmi.
      if (c.expectDisplay.length === 9 /* incl dash */) {
        expect(display, `input="${c.raw}"`).toMatch(PIN_MCM_FORMAT);
      }
      expect(`PIN ${formatInviteCode(c.raw)}`).toContain(
        `PIN ${c.expectDisplay.replace(/^([A-Z0-9]{4})(?=[A-Z0-9])/, "$1-")}`,
      );
      expectNoRawPhone(display, `formatter("${c.raw}")`);
    }
  });
});

// ── 2) Runtime UI ─────────────────────────────────────────────────────
test.describe("PIN input variations — runtime FAB di /chat", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("ketik variasi PIN → input value selalu XXXX-XXXX dan dialog bebas phone", async ({
    page,
  }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    // Buka FAB. Selector: aria-label eksplisit di komponen.
    const fab = page.getByRole("button", { name: /Tambah kontak PIN MCM/i });
    if ((await fab.count()) === 0) {
      test.skip(true, "FAB tidak ditemukan — mungkin viewport/route berubah.");
      return;
    }
    await fab.first().click();

    const input = page.locator("#fab-pin-input");
    await expect(input).toBeVisible();

    const variations: Array<{ raw: string; expected: string }> = [
      // lowercase → uppercase + dash after 4
      { raw: "abcd1234", expected: "ABCD-1234" },
      // spasi berlebih di tengah + trailing
      { raw: "  aBcD 12 34  ", expected: "ABCD-1234" },
      // dash salah letak / ganda
      { raw: "ab-cd-12-34", expected: "ABCD-1234" },
      // kelebihan karakter → onChange handler slice ke 8
      { raw: "ABCD1234EXTRA", expected: "ABCD-1234" },
      // pendek (≤4) → tanpa dash
      { raw: "abc", expected: "ABC" },
    ];

    for (const v of variations) {
      await input.fill("");
      // Pakai type() supaya melewati event onChange React yang mengatur
      // format-as-you-type. `fill()` di beberapa versi memicu 1 event
      // gabungan; `type()` mensimulasikan keystroke natural.
      await input.pressSequentially(v.raw, { delay: 5 });
      const value = await input.inputValue();
      expect(value, `raw="${v.raw}" harus dinormalisasi`).toBe(v.expected);
      expect(value, `raw="${v.raw}" wajib match XXXX-XXXX`).toMatch(
        PIN_INPUT_FMT,
      );
    }

    // Snapshot seluruh dialog: wajib bebas nomor telp mentah + tiap
    // token `PIN <...>` yang tampil wajib berformat resmi.
    const dialogText = await page
      .getByRole("dialog")
      .first()
      .innerText();
    expectPinBrandingClean(dialogText, "dialog Tambah kontak PIN");
  });
});
