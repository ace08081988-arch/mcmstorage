import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import {
  assertChatBrandingClean,
  containsRawIndoPhone,
  expectPinBrandingClean,
  extractPinTokens,
  PIN_MCM_FORMAT,
} from "./_helpers/chat-pin-assertions";

/**
 * E2E — konsistensi format `PIN xxxx-xxxx` LINTAS PERMUKAAN UI selama
 * reload dan transisi jaringan.
 *
 * Permukaan yang diuji per DM:
 *   1. **Daftar percakapan** (`/chat`) — baris `<a href="/chat/:id">`
 *      (judul peer + snippet + aria-label).
 *   2. **Header DM** (`/chat/:id`) — locator `header` / `[role="banner"]`
 *      pada halaman percakapan.
 *   3. **Panel detail transkrip** (`main` / `body`) — snapshot innerText
 *      seluruh body panel percakapan.
 *
 * Tahapan per DM:
 *   (a) Baseline online: buka `/chat`, ambil identitas peer dari baris
 *       daftar, lalu buka DM, ambil identitas dari header, dan verifikasi
 *       identitas header memuat token PIN yang sama dengan yang tampil di
 *       daftar (bila daftar menampilkan token PIN).
 *   (b) Reload DM — identitas header + transkrip tetap sama, tetap bersih.
 *   (c) Transisi OFFLINE → ONLINE via CDP `Network.emulateNetworkConditions`
 *       — reload offline tidak boleh membocorkan nomor telp mentah (poll
 *       innerText selama fase skeleton), setelah online kembali identitas
 *       tetap konsisten dengan baseline.
 *   (d) Throttling Slow 3G lalu balik ke normal — identitas peer stabil,
 *       token PIN tetap `PIN xxxx-xxxx`.
 *   (e) Kembali ke `/chat`, verifikasi baris DM masih PIN-branded dan
 *       token peer di daftar identik dengan snapshot awal.
 *
 * Suite ini melengkapi suite existing (offline-reconnect, throttled-reload,
 * list-preview) dengan menegakkan **konsistensi identitas peer LINTAS
 * permukaan** — bukan hanya per-surface.
 */

const STORAGE = "tests/visual/.auth/user.json";
const DM_COUNT = 2;

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

async function sweepInnerText(
  page: import("@playwright/test").Page,
): Promise<string> {
  return page.evaluate(() =>
    document.body ? document.body.innerText.replace(/\u00a0/g, " ") : "",
  );
}

/**
 * Selama `durationMs`, poll `innerText` dan gagalkan bila nomor telp
 * Indonesia mentah muncul (bahkan sekejap). Digunakan pada fase
 * offline / throttled saat networkidle tidak akan tercapai.
 */
async function assertNoRawPhoneDuring(
  page: import("@playwright/test").Page,
  label: string,
  durationMs = 2500,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    const text = await sweepInnerText(page);
    if (containsRawIndoPhone(text)) {
      throw new Error(
        `[${label}] Nomor telepon Indonesia mentah bocor pada fase transisi jaringan.`,
      );
    }
    await page.waitForTimeout(120);
  }
}

/** Ambil token PIN pertama yang match `PIN_MCM_FORMAT`, atau "" bila tidak ada. */
function firstPinToken(text: string): string {
  const tokens = extractPinTokens(text).filter((t) => PIN_MCM_FORMAT.test(t));
  return tokens[0] ?? "";
}

test.describe("konsistensi PIN xxxx-xxxx lintas permukaan (daftar/header/panel) selama reload & transisi jaringan", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("identitas peer stabil di daftar, header DM, dan panel detail lintas reload + offline/online + throttled", async ({
    page,
    context,
  }) => {
    const isChromium =
      context.browser()?.browserType().name() === "chromium";
    // CDP dipakai untuk offline & throttle — non-Chromium tetap jalan
    // untuk fase (a), (b), dan (e) saja.
    const cdp = isChromium ? await context.newCDPSession(page) : null;
    if (cdp) await cdp.send("Network.enable");

    // ── (0) Baseline daftar percakapan
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");
    const rows = page.locator('a[href^="/chat/"]');
    const rowCount = await rows.count();
    test.skip(rowCount === 0, "Belum ada DM untuk diuji — skip.");

    // Snapshot daftar baseline (judul + aria-label per baris).
    async function snapshotList(): Promise<Array<{ href: string; text: string }>> {
      const out: Array<{ href: string; text: string }> = [];
      const total = await rows.count();
      for (let i = 0; i < total; i += 1) {
        const href = (await rows.nth(i).getAttribute("href")) ?? "";
        const txt = (await rows.nth(i).innerText().catch(() => "")) || "";
        const aria =
          (await rows.nth(i).getAttribute("aria-label").catch(() => "")) || "";
        out.push({ href, text: `${txt}\n${aria}` });
      }
      return out;
    }

    const listBaseline = await snapshotList();
    for (const [i, row] of listBaseline.entries()) {
      expectPinBrandingClean(row.text, `daftar baseline row#${i}`);
    }

    // Pilih beberapa DM yang punya href berformat UUID.
    const dmCandidates = listBaseline
      .filter((r) => /^\/chat\/[0-9a-f-]{36}$/.test(r.href))
      .slice(0, DM_COUNT);
    test.skip(dmCandidates.length === 0, "Tidak ada DM UUID valid — skip.");

    for (const { href, text: listRowText } of dmCandidates) {
      const listPinToken = firstPinToken(listRowText);

      // ── (a) Buka DM online — header & transkrip bersih.
      await page.goto(href);
      await page.waitForLoadState("networkidle");
      const baseline = await assertChatBrandingClean(
        page,
        `${href} baseline online`,
      );
      expect(
        baseline.header.length,
        `identitas peer terisi di header untuk ${href}`,
      ).toBeGreaterThan(0);

      const headerPinToken = firstPinToken(baseline.header);
      const bodyPinToken = firstPinToken(baseline.body);

      // Konsistensi lintas permukaan: bila daftar menampilkan token PIN
      // dan header juga, token peer wajib IDENTIK. (Bila salah satu
      // hanya menampilkan alias / display name, cek dilewati agar tidak
      // false-positive terhadap kontak yang dinamai.)
      if (listPinToken && headerPinToken) {
        expect(
          headerPinToken,
          `token PIN di daftar dan header DM wajib sama untuk ${href}`,
        ).toBe(listPinToken);
      }
      // Panel detail (body) yang memuat token PIN peer juga wajib
      // konsisten dengan header.
      if (headerPinToken && bodyPinToken) {
        expect(
          bodyPinToken,
          `token PIN di header dan panel detail wajib sama untuk ${href}`,
        ).toBe(headerPinToken);
      }

      // ── (b) Reload biasa — identitas persist.
      await page.reload();
      await page.waitForLoadState("networkidle");
      const afterReload = await assertChatBrandingClean(
        page,
        `${href} post-reload`,
      );
      expect(
        afterReload.header,
        `identitas header persist setelah reload untuk ${href}`,
      ).toBe(baseline.header);

      // ── (c) OFFLINE → ONLINE via CDP (Chromium only).
      if (cdp) {
        await cdp.send("Network.emulateNetworkConditions", {
          offline: true,
          latency: 0,
          downloadThroughput: 0,
          uploadThroughput: 0,
        });
        await page.reload({ waitUntil: "commit" }).catch(() => {
          /* offline reload may throw */
        });
        await assertNoRawPhoneDuring(page, `${href} OFFLINE reload`);

        await cdp.send("Network.emulateNetworkConditions", {
          offline: false,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        });
        await page.reload();
        await page.waitForLoadState("networkidle");
        const reconnect = await assertChatBrandingClean(
          page,
          `${href} reconnect`,
        );
        expect(
          reconnect.header,
          `identitas header stabil online→offline→online untuk ${href}`,
        ).toBe(baseline.header);

        // ── (d) Throttled Slow 3G lalu normal — konsistensi masih terjaga.
        await cdp.send("Network.emulateNetworkConditions", {
          offline: false,
          latency: 400,
          downloadThroughput: (500 * 1024) / 8,
          uploadThroughput: (500 * 1024) / 8,
        });
        const throttleReload = page.reload().catch(() => {
          /* throttled reload may exceed default nav; poll below */
        });
        await assertNoRawPhoneDuring(page, `${href} SLOW-3G reload`, 3000);
        await throttleReload;

        await cdp.send("Network.emulateNetworkConditions", {
          offline: false,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        });
        await page.waitForLoadState("networkidle");
        const afterThrottle = await assertChatBrandingClean(
          page,
          `${href} post-throttle`,
        );
        expect(
          afterThrottle.header,
          `identitas header stabil pasca-throttle untuk ${href}`,
        ).toBe(baseline.header);
      }
    }

    // ── (e) Kembali ke daftar — konsistensi dengan baseline daftar.
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");
    const listAfter = await snapshotList();
    for (const [i, row] of listAfter.entries()) {
      expectPinBrandingClean(row.text, `daftar akhir row#${i}`);
    }

    // Setiap DM yang diuji: token PIN di daftar akhir wajib sama dengan baseline.
    for (const { href } of dmCandidates) {
      const before = listBaseline.find((r) => r.href === href);
      const after = listAfter.find((r) => r.href === href);
      if (!before || !after) continue;
      const beforePin = firstPinToken(before.text);
      const afterPin = firstPinToken(after.text);
      if (beforePin && afterPin) {
        expect(
          afterPin,
          `token PIN baris ${href} di daftar konsisten sebelum & sesudah navigasi + transisi jaringan`,
        ).toBe(beforePin);
      }
    }
  });
});