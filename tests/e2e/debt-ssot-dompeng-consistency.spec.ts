import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

/**
 * E2E — angka hutang/piutang "Dompeng" WAJIB tampil sama di layar
 * pengguna, baik di halaman chat maupun di Hutang & Piutang.
 *
 * Dua lapis:
 *   A. Harness publik `/lovable/visual/debt-ssot-consistency` — selalu
 *      jalan (tanpa login). Menguji bahwa ketiga permukaan (chip daftar
 *      chat, chip header percakapan, kartu Hutang & Piutang) merender
 *      nominal identik dari satu SSOT.
 *   B. Halaman asli `/chat` + `/hutang-piutang` — hanya jalan bila
 *      storageState berisi sesi Supabase (auto-skip di lingkungan tanpa
 *      kredensial). Membandingkan nominal Dompeng yang benar-benar
 *      terbaca di layar pada kedua halaman.
 */

const STORAGE = "tests/visual/.auth/user.json";
const PARTY = process.env.E2E_DEBT_PARTY ?? "Dompeng";
const EXPECTED = Number(process.env.E2E_DEBT_AMOUNT ?? 55_000_000);

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

/** Ambil semua nominal rupiah (dalam angka) dari sepotong teks layar. */
function rupiahValues(text: string): number[] {
  const out: number[] = [];
  const re = /Rp\s*([\d.,]+)\s*(M|Jt|rb)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const base = Number(m[1].replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(base)) continue;
    const unit = (m[2] ?? "").toLowerCase();
    const mult = unit === "m" ? 1e9 : unit === "jt" ? 1e6 : unit === "rb" ? 1e3 : 1;
    out.push(Math.round(base * mult));
  }
  return out;
}

async function surfaceAmount(page: Page, testId: string): Promise<number> {
  const text = await page.getByTestId(testId).innerText();
  const values = rupiahValues(text);
  expect(values.length, `tidak ada nominal di ${testId}: ${text}`).toBeGreaterThan(0);
  return Math.max(...values);
}

test.describe("SSOT hutang Dompeng — harness", () => {
  test("chip chat, header chat, dan kartu Hutang & Piutang menampilkan angka sama", async ({
    page,
  }) => {
    await page.goto(
      `/lovable/visual/debt-ssot-consistency?nama=${encodeURIComponent(PARTY)}&piutang=${EXPECTED}`,
    );
    await page.getByTestId("surface-chat-list").waitFor();

    const list = await surfaceAmount(page, "surface-chat-list");
    const header = await surfaceAmount(page, "surface-chat-header");
    const hutangPage = await surfaceAmount(page, "surface-hutang-page");
    const partyCard = await surfaceAmount(
      page,
      `surface-party-card-${PARTY.trim().toLowerCase().replace(/\s+/g, " ")}`,
    );

    expect(list).toBe(EXPECTED);
    expect(header).toBe(list);
    expect(hutangPage).toBe(list);
    // Kartu per-kontak wajib membaca SSOT yang sama, bukan hanya `debts`.
    expect(partyCard).toBe(list);
  });

  test("perubahan SSOT ikut terlihat serentak di semua permukaan", async ({ page }) => {
    const other = 21_000_000;
    await page.goto(
      `/lovable/visual/debt-ssot-consistency?nama=${encodeURIComponent(PARTY)}&piutang=${other}`,
    );
    await page.getByTestId("surface-chat-list").waitFor();
    const values = await Promise.all([
      surfaceAmount(page, "surface-chat-list"),
      surfaceAmount(page, "surface-chat-header"),
      surfaceAmount(page, "surface-hutang-page"),
      surfaceAmount(
        page,
        `surface-party-card-${PARTY.trim().toLowerCase().replace(/\s+/g, " ")}`,
      ),
    ]);
    expect(new Set(values).size, `nilai berbeda: ${values.join(" / ")}`).toBe(1);
    expect(values[0]).toBe(other);
  });
});

test.describe("SSOT hutang Dompeng — halaman asli", () => {
  test.skip(!hasAuthState(), "Butuh sesi login (tests/visual/.auth/user.json).");

  test("angka di /chat sama dengan di /hutang-piutang", async ({ page }) => {
    // 1) Halaman chat — cari baris/kartu percakapan bernama PARTY.
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");
    const row = page
      .locator("a, li, [role='listitem']")
      .filter({ hasText: new RegExp(PARTY, "i") })
      .first();
    const chatVisible = await row.isVisible().catch(() => false);
    test.skip(!chatVisible, `Kontak "${PARTY}" tidak ada di daftar chat akun ini.`);
    const chatValues = rupiahValues(await row.innerText());
    expect(chatValues.length, "chip saldo tidak tampil di daftar chat").toBeGreaterThan(0);
    const chatAmount = Math.max(...chatValues);

    // 2) Halaman Hutang & Piutang — kartu kontak dengan nama sama.
    await page.goto("/hutang-piutang");
    await page.waitForLoadState("networkidle");
    const card = page
      .locator("div, li")
      .filter({ hasText: new RegExp(PARTY, "i") })
      .filter({ hasText: /Rp/ })
      .last();
    const cardVisible = await card.isVisible().catch(() => false);
    test.skip(!cardVisible, `Kontak "${PARTY}" tidak ada di Hutang & Piutang.`);
    const pageValues = rupiahValues(await card.innerText());
    expect(pageValues.length).toBeGreaterThan(0);

    // Angka chat harus muncul pada kartu Hutang & Piutang (bukan hanya
    // sebagian sumber, mis. catatan manual saja).
    expect(
      pageValues,
      `chat=${chatAmount} vs hutang-piutang=${pageValues.join("/")}`,
    ).toContain(chatAmount);

    // 3) Kartu per-kontak (grup) di halaman Hutang & Piutang.
    const partyCard = page
      .getByTestId(`party-card-${PARTY.trim().toLowerCase().replace(/\s+/g, " ")}`)
      .first();
    const partyCardVisible = await partyCard.isVisible().catch(() => false);
    test.skip(!partyCardVisible, `Kartu per-kontak "${PARTY}" tidak tampil.`);
    const cardSisaText = await partyCard.getByTestId("party-card-sisa").first().innerText();
    const cardSisa = Math.max(...rupiahValues(cardSisaText));
    expect(
      cardSisa,
      `kartu per-kontak=${cardSisa} vs chat=${chatAmount}`,
    ).toBe(chatAmount);
  });
});