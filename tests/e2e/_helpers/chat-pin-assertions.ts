/**
 * Reusable assertions untuk suite `chat-pin-mcm-*` E2E.
 *
 * Kontrak:
 *   - `PHONE_ID_LIKE`: pola nomor telp Indonesia mentah — HP `08…` atau
 *     `+628…` / `62…`. Cukup ketat untuk menangkap kebocoran umum tanpa
 *     mem-false-positive PIN `xxxx-xxxx` (yang hanya A–Z & 0–9 tanpa
 *     awalan `08` / `62` diikuti 7+ digit).
 *   - `PIN_MCM_FORMAT`: pola resmi `PIN XXXX-XXXX` (huruf/angka uppercase
 *     4-4). Ini yang selalu wajib bila UI memilih menampilkan token PIN.
 *   - `PIN_ANY_TOKEN`: pola loose `PIN <nonspace>` — dipakai untuk
 *     menangkap kandidat token PIN sebelum dicek ke `PIN_MCM_FORMAT`.
 *
 * Semua helper melempar via `expect` Playwright — panggil di dalam
 * `test(...)` body.
 */
import { expect, type Page, type Locator } from "@playwright/test";

export const PHONE_ID_LIKE = /(?:\+?62|0)8\d{7,12}/;
export const PIN_MCM_FORMAT = /PIN\s+[A-Z0-9]{4}-[A-Z0-9]{4}/;
export const PIN_ANY_TOKEN = /PIN\s+\S+/;

/**
 * Ambil semua token yang diawali `PIN ` dari `text` (bisa 0 hasil).
 *
 * Edge case yang secara eksplisit didukung dan dites di
 * `chat-pin-assertions-helper.smoke.spec.ts`:
 *
 *   1. **Ganda dalam satu baris/paragraf** — `"PIN ABCD-1234 dan PIN
 *      EFGH-5678"` menghasilkan DUA token, bukan menggabungkan menjadi
 *      satu blob raksasa.
 *   2. **Ganda menempel tanpa spasi antar token** — `"PIN ABCD-1234PIN
 *      EFGH-5678"` juga menghasilkan dua token. Ini penting karena
 *      transkrip chat kadang mengalirkan preview tanpa separator saat
 *      dirender di layar kecil.
 *   3. **Terpotong di akhir baris** — `"PIN ABCD-\n1234"` menghasilkan
 *      token off-format `"PIN ABCD-"`. Ini SENGAJA tetap ditangkap
 *      supaya `expectPinFormat` bisa menandainya sebagai pelanggaran,
 *      bukan disembunyikan diam-diam.
 *   4. **Punctuation trailing** — `"PIN ABCD-1234."` menghasilkan
 *      `"PIN ABCD-1234"` (titik tidak ikut termakan) sehingga token
 *      valid tidak salah ditandai gara-gara punctuation.
 *   5. **Case lowercase** — `"PIN abcd-1234"` tetap diekstrak apa
 *      adanya. `PIN_MCM_FORMAT` yang uppercase-only lalu menolaknya.
 *
 * Implementasi:
 *   - `\bPIN\s+` — awal token wajib `PIN` yang diikuti whitespace,
 *     dengan word-boundary agar `SPIN` / `PINK` tidak ikut match.
 *   - `(?:(?!PIN)[A-Za-z0-9-])+` — konsumsi char PIN-body yang valid
 *     (huruf/angka/dash) tapi berhenti sebelum urutan `PIN` berikutnya.
 *     Negative lookahead ini yang membuat kasus back-to-back tanpa
 *     spasi (edge case #2) terpisah bersih menjadi dua token.
 */
export function extractPinTokens(text: string): string[] {
  return text.match(/\bPIN\s+(?:(?!PIN)[A-Za-z0-9-])+/g) ?? [];
}

/**
 * Tegas: `text` tidak boleh memuat nomor telepon Indonesia mentah.
 * `label` muncul di pesan kegagalan untuk kemudahan triase.
 */
export function expectNoRawPhone(text: string, label = "text"): void {
  expect(text, `${label} wajib bebas nomor telp Indonesia mentah`).not.toMatch(
    PHONE_ID_LIKE,
  );
}

/**
 * Tegas: setiap token `PIN …` yang muncul di `text` wajib berformat
 * resmi `PIN XXXX-XXXX`. Bila tidak ada token PIN sama sekali, tidak
 * ada assertion yang dipicu (placeholder seperti "Kontak" tetap sah).
 */
export function expectPinFormat(text: string, label = "text"): void {
  const tokens = extractPinTokens(text);
  for (const t of tokens) {
    expect(
      t,
      `${label}: token "${t}" wajib berformat PIN xxxx-xxxx (4-4, A-Z0-9)`,
    ).toMatch(PIN_MCM_FORMAT);
  }
}

/**
 * Kombinasi: bebas nomor telp mentah DAN setiap token PIN berformat
 * resmi. Cocok dipakai per fase di suite fuzz.
 */
export function expectPinBrandingClean(text: string, label = "text"): void {
  expectNoRawPhone(text, label);
  expectPinFormat(text, label);
}

/** Ambil baris pertama non-kosong dari innerText — nama identitas peer. */
export async function readHeaderIdentity(page: Page): Promise<string> {
  const raw =
    (await page
      .locator("header, [role='banner']")
      .first()
      .innerText()
      .catch(() => "")) || "";
  return (
    raw
      .split(/\n+/)
      .map((s) => s.trim())
      .find((s) => s.length > 0) || ""
  );
}

/** innerText body/main halaman — pakai `main` bila ada, fallback ke `body`. */
export async function readTranscript(page: Page): Promise<string> {
  return page.locator("main, body").first().innerText();
}

/**
 * Snapshot lengkap fase: baca header + transcript, jalankan
 * `expectPinBrandingClean` pada keduanya, lalu kembalikan `header`
 * untuk dipakai memverifikasi identitas persist antar fase.
 */
export async function assertChatBrandingClean(
  page: Page,
  phase: string,
): Promise<{ header: string; body: string }> {
  const header = await readHeaderIdentity(page);
  const body = await readTranscript(page);
  expectPinBrandingClean(header, `${phase} header`);
  expectPinBrandingClean(body, `${phase} transkrip`);
  return { header, body };
}

/** Assertion identitas untuk sebuah Locator (mis. baris di daftar chat). */
export async function assertLocatorPinClean(
  locator: Locator,
  phase: string,
): Promise<string> {
  const text = await locator.innerText();
  expectPinBrandingClean(text, phase);
  return text;
}
