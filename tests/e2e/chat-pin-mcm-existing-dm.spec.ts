import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E — DM yang **sudah ada** (bukan baru dibuat) tetap:
 *   - Menampilkan identitas peer sebagai `PIN xxxx-xxxx` (tidak pernah
 *     nomor telepon mentah) di list, header, dan transkrip.
 *   - Menyimpan histori sebelumnya sehingga bisa dibaca ulang setelah
 *     halaman di-refresh — bukan sekadar tampil dari state optimistik.
 *
 * 1. Static source guard (selalu jalan):
 *    - `chat.index` & `chat.$conversationId` tidak mem-fallback ke
 *      `p.phone` / `peer.phone` di jalur render list & transkrip.
 *    - `useConversationMessages` mem-fetch berdasarkan `conversationId`
 *      via `useQuery` (stabil setelah refresh, bukan hanya realtime
 *      insert yang cuma bertahan selama sesi).
 *
 * 2. Runtime UI (butuh storageState + minimal 1 DM dengan minimal 1
 *    pesan; self-skip bila tidak ada):
 *    - Ambil daftar percakapan pertama di `/chat`, catat judul & href.
 *    - Buka DM tersebut; snapshot semua bubble pesan (teks unik +
 *      urutan) & header identitas.
 *    - Reload halaman percakapan yang sama; snapshot ulang.
 *    - Assert: himpunan pesan sebelum-reload ⊆ himpunan pesan setelah-
 *      reload (histori tidak hilang) dan header identitas identik.
 *    - Assert: tidak ada string nomor telp Indonesia mentah di header
 *      / list / transkrip pada kedua fase, dan setiap label PIN
 *      memakai format `PIN xxxx-xxxx`.
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

// ── 1) Static source guards ───────────────────────────────────────────
test.describe("existing DM — source guard: identitas PIN & fetch stabil lintas refresh", () => {
  test("chat.index & chat.$conversationId: tidak ada fallback `phone` untuk nama peer", () => {
    for (const rel of [
      "src/routes/_authenticated.chat.index.tsx",
      "src/routes/_authenticated.chat.$conversationId.tsx",
    ]) {
      const src = readFileSync(resolve(process.cwd(), rel), "utf8");
      expect(src, `${rel} tidak boleh mem-fallback ke p.phone`).not.toMatch(/\|\|\s*p\.phone\b/);
      expect(src, `${rel} tidak boleh mem-fallback ke peer.phone`).not.toMatch(/\|\|\s*peer\.phone\b/);
    }
  });

  test("useConversationMessages: fetch histori via useQuery ber-key conversationId (stabil lintas refresh)", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/chat.ts"), "utf8");
    // Fungsi harus memakai useQuery dengan queryKey yang menyertakan
    // conversationId — kalau regresi ke state lokal saja, histori
    // hilang saat refresh dan test ini merah lebih awal daripada UX.
    expect(src).toMatch(/useQuery\(\s*\{[\s\S]{0,400}?queryKey:\s*\[[\s\S]{0,120}?conversationId/);
    expect(src).toMatch(/from\(\s*["']messages["']\s*\)/);
  });
});

// ── 2) Runtime UI (auth-gated) ────────────────────────────────────────
test.describe("existing DM — runtime: PIN MCM & histori bertahan setelah refresh", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("buka DM pertama → snapshot pesan & header → reload → histori tetap terbaca & masih PIN", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    // Guard: list chat sudah bebas nomor telp mentah sebelum kita
    // masuk ke DM.
    const listTxt = await page.locator("main").innerText();
    expect(listTxt, "list chat tidak boleh memuat nomor telp mentah")
      .not.toMatch(PHONE_LIKE);

    const firstConv = page.locator('a[href^="/chat/"]').first();
    test.skip(
      (await firstConv.count()) === 0,
      "Akun test belum punya DM — skip runtime existing DM.",
    );
    const firstHref = await firstConv.getAttribute("href");
    expect(firstHref).toMatch(/^\/chat\/[0-9a-f-]{36}$/);

    await firstConv.click();
    await page.waitForURL(new RegExp(`${firstHref}$`));
    await page.waitForLoadState("networkidle");

    const readHeader = async () =>
      (await page.locator("header, [role='banner']").first().innerText().catch(() => "")) || "";
    const readTranscript = async () =>
      await page.locator("main, body").first().innerText();

    // Ambil daftar teks bubble pesan yang stabil (bukan indikator
    // "typing…"/loader). Kita pakai heuristik: node dengan lebih dari 3
    // karakter dan bukan tombol input, di dalam main.
    const readMessageTexts = async (): Promise<string[]> => {
      return await page.evaluate(() => {
        const main = document.querySelector("main") ?? document.body;
        const nodes = Array.from(
          main.querySelectorAll<HTMLElement>(
            "[data-message-id], [data-msg-id], [data-message], li, article, div",
          ),
        );
        const seen = new Set<string>();
        const out: string[] = [];
        for (const n of nodes) {
          if ((n as HTMLElement).matches?.("input, textarea, button")) continue;
          const t = (n.innerText || "").trim();
          if (t.length < 3 || t.length > 400) continue;
          if (/tulis pesan|kirim|memuat|loading/i.test(t)) continue;
          if (seen.has(t)) continue;
          seen.add(t);
          out.push(t);
          if (out.length >= 30) break;
        }
        return out;
      });
    };

    const headerBefore = await readHeader();
    const transcriptBefore = await readTranscript();
    const msgsBefore = await readMessageTexts();

    // Pra-syarat: minimal ada satu pesan histori untuk diuji "tetap
    // terbaca setelah refresh". Kalau DM kosong, skip — tak ada histori.
    test.skip(
      msgsBefore.length === 0,
      "DM pertama tidak punya pesan histori — skip.",
    );

    // Guard identitas fase pra-reload.
    expect(headerBefore, "header pra-reload tanpa phone").not.toMatch(PHONE_LIKE);
    expect(transcriptBefore, "transkrip pra-reload tanpa phone").not.toMatch(PHONE_LIKE);
    if (/PIN\s+/i.test(headerBefore)) expect(headerBefore).toMatch(PIN_FMT);
    if (/PIN\s+/i.test(transcriptBefore)) expect(transcriptBefore).toMatch(PIN_FMT);

    // Refresh: paksa hydrate ulang dari server, bukan dari state
    // optimistik / cache in-memory.
    await page.reload({ waitUntil: "networkidle" });
    await expect(page).toHaveURL(new RegExp(`${firstHref}$`));
    // Beri waktu useQuery menyelesaikan fetch pertamanya.
    await page.waitForTimeout(600);

    const headerAfter = await readHeader();
    const transcriptAfter = await readTranscript();
    const msgsAfter = await readMessageTexts();

    // Guard identitas fase pasca-reload.
    expect(headerAfter, "header pasca-reload tanpa phone").not.toMatch(PHONE_LIKE);
    expect(transcriptAfter, "transkrip pasca-reload tanpa phone").not.toMatch(PHONE_LIKE);
    if (/PIN\s+/i.test(headerAfter)) expect(headerAfter).toMatch(PIN_FMT);
    if (/PIN\s+/i.test(transcriptAfter)) expect(transcriptAfter).toMatch(PIN_FMT);

    // Histori tidak hilang: setiap pesan pra-reload masih tampil.
    // Kita cek lewat inklusi substring di transcriptAfter (tahan
    // banting terhadap perubahan pembungkus DOM).
    const missing = msgsBefore.filter((t) => !transcriptAfter.includes(t));
    expect(
      missing,
      `pesan histori hilang setelah refresh: ${missing.slice(0, 3).join(" | ")}`,
    ).toHaveLength(0);

    // Konsistensi identitas peer: nama peer di header sebelum & sesudah
    // reload harus sama (kalau salah satu regresi ke phone, ini juga
    // merah). Kita compare baris pertama non-kosong dari header.
    const firstLine = (s: string) => s.split(/\n+/).map((x) => x.trim()).find((x) => x.length > 0) || "";
    expect(firstLine(headerAfter)).toBe(firstLine(headerBefore));
  });
});