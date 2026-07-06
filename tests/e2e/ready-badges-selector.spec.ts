// README scenario: konsistensi badge Aktif/Terkirim vs helper selector
// pasca aksi Tandai/Batalkan Terkirim.
import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: badge Aktif & Terkirim di surface Request + Ecer selalu identik
 * dengan angka yang dihitung ulang oleh helper selector setelah tiap
 * transisi mark/cancel.
 *
 * Harness: /lovable/visual/ready-badges-selector (publik, no-auth).
 *
 * Invariants (per surface, per title, per aksi):
 *   1. `badge-active` == jumlah prep dengan sold_at === null.
 *   2. `badge-sent`   == jumlah prep dengan sold_at !== null.
 *   3. Klik Tandai pada prep aktif → active-1, sent+1 di title-nya;
 *      surface lain tidak berubah.
 *   4. Klik Batalkan pada prep terkirim → active+1, sent-1 di title-nya;
 *      surface lain tidak berubah.
 *   5. Tombol Tandai disabled untuk prep sudah terkirim, dan Batalkan
 *      disabled untuk prep aktif (regresi guard supaya UI tidak memicu
 *      state ilegal).
 */

const URL = "/lovable/visual/ready-badges-selector";

type Prep = { id: string; title_id: string; sold_at: string | null };
type Scope = "request" | "ecer";

async function readOracle(page: Page, scope: Scope): Promise<Prep[]> {
  const raw = await page
    .locator(`[data-oracle="preps-${scope}"]`)
    .getAttribute("data-json");
  if (!raw) throw new Error(`oracle ${scope} tidak ditemukan`);
  return JSON.parse(raw) as Prep[];
}

/** Hitung expected Aktif/Terkirim per title dari oracle, tanpa memakai
 *  helper produksi — supaya spec tidak tautologis: bila helper berubah
 *  semantiknya (mis. deleted_at ikut kondisi), spec ikut menangkap. */
function computeExpected(preps: Prep[]): Map<string, { active: number; sent: number }> {
  const out = new Map<string, { active: number; sent: number }>();
  for (const p of preps) {
    if (!p.title_id) continue;
    const cur = out.get(p.title_id) ?? { active: 0, sent: 0 };
    if (p.sold_at === null || p.sold_at === undefined) cur.active += 1;
    else cur.sent += 1;
    out.set(p.title_id, cur);
  }
  return out;
}

async function assertBadgesMatchOracle(page: Page, scope: Scope, titleIds: string[]) {
  const preps = await readOracle(page, scope);
  const expected = computeExpected(preps);
  for (const id of titleIds) {
    const want = expected.get(id) ?? { active: 0, sent: 0 };
    await expect(
      page.getByTestId(`badge-active-${scope}-${id}`),
      `badge Aktif ${scope}/${id}`,
    ).toHaveText(String(want.active));
    await expect(
      page.getByTestId(`badge-sent-${scope}-${id}`),
      `badge Terkirim ${scope}/${id}`,
    ).toHaveText(String(want.sent));
  }
}

const REQUEST_TITLES = ["r-A", "r-B", "r-C"] as const;
const ECER_TITLES = ["e-X", "e-Y"] as const;

async function assertConsistent(page: Page) {
  await assertBadgesMatchOracle(page, "request", [...REQUEST_TITLES]);
  await assertBadgesMatchOracle(page, "ecer", [...ECER_TITLES]);
}

test.describe("Ready badges — konsistensi selector pasca Tandai/Batalkan", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByRole("heading", { name: /Ready Badges/i })).toBeVisible();
  });

  test("state awal konsisten dengan helper untuk kedua surface", async ({ page }) => {
    await assertConsistent(page);
  });

  test("Tandai Terkirim pada prep aktif memindahkan hitungan Aktif→Terkirim", async ({ page }) => {
    // Snapshot sebelum klik untuk membuktikan angka benar-benar berpindah
    // (bukan kebetulan sama karena keduanya 0).
    const beforeActive = Number(
      await page.getByTestId("badge-active-request-r-A").textContent(),
    );
    const beforeSent = Number(
      await page.getByTestId("badge-sent-request-r-A").textContent(),
    );
    expect(beforeActive).toBeGreaterThan(0);

    await page.getByTestId("mark-sent-rp1").click();

    await expect(page.getByTestId("badge-active-request-r-A")).toHaveText(
      String(beforeActive - 1),
    );
    await expect(page.getByTestId("badge-sent-request-r-A")).toHaveText(
      String(beforeSent + 1),
    );
    // Ecer tidak ikut berubah.
    await assertConsistent(page);

    // Tombol Tandai pada rp1 kini disabled; Batalkan aktif.
    await expect(page.getByTestId("mark-sent-rp1")).toBeDisabled();
    await expect(page.getByTestId("cancel-sent-rp1")).toBeEnabled();
  });

  test("Batalkan Terkirim pada prep terkirim memindahkan hitungan Terkirim→Aktif", async ({ page }) => {
    // rp3 di seed sudah sold_at≠null → Batalkan aktif.
    const beforeActive = Number(
      await page.getByTestId("badge-active-request-r-A").textContent(),
    );
    const beforeSent = Number(
      await page.getByTestId("badge-sent-request-r-A").textContent(),
    );
    expect(beforeSent).toBeGreaterThan(0);

    await page.getByTestId("cancel-sent-rp3").click();

    await expect(page.getByTestId("badge-active-request-r-A")).toHaveText(
      String(beforeActive + 1),
    );
    await expect(page.getByTestId("badge-sent-request-r-A")).toHaveText(
      String(beforeSent - 1),
    );
    await assertConsistent(page);

    await expect(page.getByTestId("cancel-sent-rp3")).toBeDisabled();
    await expect(page.getByTestId("mark-sent-rp3")).toBeEnabled();
  });

  test("aksi berturut-turut pada dua surface tetap konsisten", async ({ page }) => {
    // Sequence: Tandai request → Tandai ecer → Batalkan request → Batalkan ecer.
    // Setelah tiap langkah, kedua surface WAJIB match oracle.
    await page.getByTestId("mark-sent-rp2").click();
    await assertConsistent(page);

    await page.getByTestId("mark-sent-ep1").click();
    await assertConsistent(page);

    await page.getByTestId("cancel-sent-rp3").click();
    await assertConsistent(page);

    await page.getByTestId("cancel-sent-ep3").click();
    await assertConsistent(page);
  });

  test("title tanpa prep punya badge 0/0 dan tetap konsisten", async ({ page }) => {
    await expect(page.getByTestId("badge-active-request-r-C")).toHaveText("0");
    await expect(page.getByTestId("badge-sent-request-r-C")).toHaveText("0");

    // Toggle di title lain tidak boleh mempengaruhi r-C.
    await page.getByTestId("mark-sent-rp1").click();
    await expect(page.getByTestId("badge-active-request-r-C")).toHaveText("0");
    await expect(page.getByTestId("badge-sent-request-r-C")).toHaveText("0");
  });
});