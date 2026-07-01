import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import {
  containsRawIndoPhone,
  expectPinBrandingClean,
  extractPinTokens,
  PIN_MCM_FORMAT,
} from "./_helpers/chat-pin-assertions";

/**
 * E2E — token `PIN xxxx-xxxx` peer di dropdown autocomplete / panel
 * saran pencarian di `/chat` WAJIB identik selama pengguna mengetik
 * karakter demi karakter (typeahead), memperpanjang, memperpendek,
 * dan mengganti case pada kotak "Cari…".
 *
 * Kontrak: untuk hit yang muncul di beberapa fase keystroke, token
 * PIN-nya sama persis. Tidak ada nomor telp Indonesia mentah bocor
 * pada fase manapun (termasuk state loading & "tidak ada hasil").
 */

const STORAGE = "tests/visual/.auth/user.json";

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

function firstPin(text: string): string {
  const t = extractPinTokens(text).filter((x) => PIN_MCM_FORMAT.test(x));
  return t[0] ?? "";
}

type Suggest = { key: string; pin: string };

async function readSuggestions(
  page: import("@playwright/test").Page,
  label: string,
): Promise<Suggest[]> {
  const items = page.locator('div.rounded-lg.border ul li button');
  const n = await items.count();
  const out: Suggest[] = [];
  for (let i = 0; i < n; i += 1) {
    const txt = (await items.nth(i).innerText().catch(() => "")) || "";
    expectPinBrandingClean(txt, `${label} sugestion#${i}`);
    const pin = firstPin(txt);
    const lines = txt.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const key = `${lines[0] ?? ""}|${lines[1] ?? ""}`;
    if (pin) out.push({ key, pin });
  }
  return out;
}

async function typeIncrementally(
  page: import("@playwright/test").Page,
  input: import("@playwright/test").Locator,
  query: string,
): Promise<Suggest[]> {
  // Pengetikan tiap karakter: bersihkan dulu supaya value = "", lalu
  // append 1 char, tunggu debounce & assert per snapshot.
  await input.fill("");
  await page.waitForTimeout(300);
  const accumulated = new Map<string, string>();
  let sofar = "";
  for (const ch of query) {
    sofar += ch;
    await input.press(ch === " " ? "Space" : ch);
    await page.waitForTimeout(500); // debounce hook ~300–400ms
    const body = (await page.locator("body").innerText().catch(() => "")) || "";
    expect(
      containsRawIndoPhone(body),
      `panel autocomplete bebas nomor telp mentah pada query="${sofar}"`,
    ).toBe(false);
    const snap = await readSuggestions(page, `typeahead "${sofar}"`);
    for (const s of snap) {
      const prev = accumulated.get(s.key);
      if (prev) {
        expect(
          prev,
          `PIN untuk saran "${s.key}" identik antar keystroke (${sofar})`,
        ).toBe(s.pin);
      } else {
        accumulated.set(s.key, s.pin);
      }
    }
  }
  return Array.from(accumulated, ([key, pin]) => ({ key, pin }));
}

test.describe("konsistensi PIN xxxx-xxxx di dropdown autocomplete /chat", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("token PIN identik pada tiap keystroke, refine, dan case-switch", async ({
    page,
  }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    const searchInput = page.locator('input[placeholder="Cari…"]').first();
    await expect(searchInput, "kotak Cari… harus tampil").toBeVisible();

    // Ambil needle 3–4 huruf dari salah satu baris daftar.
    const rows = page.locator('a[href^="/chat/"]');
    const rowCount = await rows.count();
    test.skip(rowCount === 0, "Belum ada DM di akun test — skip.");
    let seed = "";
    for (let i = 0; i < rowCount; i += 1) {
      const text = (await rows.nth(i).innerText().catch(() => "")) || "";
      const w =
        text
          .split(/\s+/)
          .map((s) => s.trim())
          .find(
            (s) =>
              /^[A-Za-z][A-Za-z0-9]{2,}$/.test(s) &&
              !/^PIN$/i.test(s) &&
              !/^(Arsip|Aktif|Baru|Anda|Kontak|Chat|Semua|Grup|Favorit)$/i.test(s),
          ) ?? "";
      if (w) { seed = w.slice(0, Math.min(4, w.length)); break; }
    }
    if (!seed) seed = "ab";

    // ── (1) Typeahead: ketik karakter demi karakter.
    const cumulative = await typeIncrementally(page, searchInput, seed);
    test.skip(
      cumulative.length === 0,
      "Tidak ada sugestion dengan PIN token selama typeahead — skip.",
    );

    // ── (2) Refine: perpendek 1 karakter, PIN saran tetap yang sama.
    const shorter = seed.slice(0, Math.max(1, seed.length - 1));
    await searchInput.fill(shorter);
    await page.waitForTimeout(500);
    const shorterSnap = await readSuggestions(page, `refine perpendek "${shorter}"`);
    const cumMap = new Map(cumulative.map((s) => [s.key, s.pin]));
    for (const s of shorterSnap) {
      const prev = cumMap.get(s.key);
      if (prev) expect(prev, `PIN saran "${s.key}" identik pasca-perpendek`).toBe(s.pin);
      else cumMap.set(s.key, s.pin);
    }

    // ── (3) Case switch (UPPER lalu lower) — PIN tetap identik.
    for (const variant of [seed.toUpperCase(), seed.toLowerCase()]) {
      await searchInput.fill(variant);
      await page.waitForTimeout(500);
      const body = (await page.locator("body").innerText().catch(() => "")) || "";
      expect(
        containsRawIndoPhone(body),
        `panel autocomplete bebas nomor telp mentah untuk case="${variant}"`,
      ).toBe(false);
      const snap = await readSuggestions(page, `case "${variant}"`);
      for (const s of snap) {
        const prev = cumMap.get(s.key);
        if (prev) expect(prev, `PIN saran "${s.key}" identik pasca case-switch`).toBe(s.pin);
        else cumMap.set(s.key, s.pin);
      }
    }

    // ── (4) Query pasti tidak match → panel empty tetap bersih PIN & phone.
    await searchInput.fill("zzqxwvNOHIT");
    await page.waitForTimeout(500);
    const emptyBody = (await page.locator("body").innerText().catch(() => "")) || "";
    expect(
      containsRawIndoPhone(emptyBody),
      "panel autocomplete empty bebas nomor telp mentah",
    ).toBe(false);
    expectPinBrandingClean(emptyBody, "body saat autocomplete empty");
  });
});
