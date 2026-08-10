import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E — pagination / load-more di halaman percakapan chat tetap
 * menampilkan identitas `PIN xxxx-xxxx` dan **tidak pernah** memunculkan
 * nomor telepon mentah di transkrip.
 *
 * Catatan implementasi saat ini: `useConversationMessages` memuat pesan
 * dengan `.limit(500)` sekaligus (belum ada tombol "Muat lebih lama").
 * Test ini tetap valid karena:
 *   - Bila di masa depan ditambahkan "load more" / infinite scroll,
 *     runtime bagian scroll-to-top akan memicu fetch tambahan; assersi
 *     `PHONE_LIKE` tetap mengunci identitas peer.
 *   - Kalau tetap satu-shot, static guard menutup celah: query pesan
 *     tidak boleh menarik kolom `phone`, dan file rute chat tidak boleh
 *     mem-fallback nama peer ke `phone`.
 *
 * Susunan:
 *   1. Static source guard (selalu jalan):
 *      - `src/lib/chat.ts`: query `messages` tidak pernah `.select` kolom
 *        `phone` (kolomnya memang tidak ada di tabel, tapi ini jaga
 *        supaya join/rpc masa depan tidak menyeret phone ke client).
 *      - `src/lib/chat.ts`: fungsi list & transcript memakai batas eksplisit
 *        (`.limit(...)`) dan `order('created_at', ...)` — kalau ada
 *        regresi ke fetch tanpa batas, pagination guard tetap punya
 *        pijakan.
 *      - `chat.$conversationId`: tidak ada fallback `|| p.phone` untuk
 *        nama peer pada cabang render pesan.
 *   2. Runtime UI (butuh storageState + minimal 1 DM; self-skip bila
 *      tidak ada): buka DM pertama, lakukan beberapa "wave" scroll
 *      (ke atas untuk memicu load-more bila ada, lalu ke bawah), dan
 *      pada setiap wave verifikasi transkrip bebas nomor telp mentah.
 *      Reload → ulangi satu kali untuk memastikan cache/hydrate tidak
 *      me-leak phone.
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
test.describe("chat pagination — source guard: query pesan tidak menarik phone & batas eksplisit", () => {
  test("src/lib/chat.ts: query dari tabel `messages` tidak pernah menyertakan kolom phone", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/chat.ts"), "utf8");
    // Semua panggilan `from("messages")` diikuti `.select("...")` — kita
    // pastikan tak ada string select yang menyebut `phone`.
    const selects = [
      ...src.matchAll(/from\(\s*["']messages["']\s*\)[\s\S]{0,400}?\.select\(\s*(["'`])([\s\S]*?)\1/g),
    ];
    expect(selects.length).toBeGreaterThan(0);
    for (const m of selects) {
      expect(m[2], `select messages memuat 'phone' — bocor identitas`).not.toMatch(/\bphone\b/i);
    }
  });

  test("src/lib/chat.ts: `useConversationMessages` memakai batas eksplisit + order created_at", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/chat.ts"), "utf8");
    const fn = src.match(/export function useConversationMessages[\s\S]*?\n\}\n/);
    expect(fn, "fungsi useConversationMessages harus ada").toBeTruthy();
    const body = fn![0];
    expect(body).toMatch(/\.order\(\s*["']created_at["']/);
    expect(body).toMatch(/\.limit\(\s*\d+\s*\)/);
  });

  test("chat.$conversationId: tidak ada fallback nama peer ke `phone` di seluruh render pesan", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated.chat.$conversationId.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/\|\|\s*p\.phone\b/);
    expect(src).not.toMatch(/\|\|\s*peer\.phone\b/);
    // Sanity: PIN fallback tetap dipakai (min. 3 titik render).
    const pinHits = src.match(
      /invite_code\s*\?\s*`PIN \$\{formatInviteCode\(p\.invite_code\)\}`/g,
    );
    expect(pinHits?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

// ── 2) Runtime UI (auth-gated) ────────────────────────────────────────
test.describe("chat pagination — runtime: scroll transkrip tidak pernah memunculkan phone", () => {
  test.skip(!hasAuthState(), "Storage state auth belum tersedia — skip.");

  test("DM pertama: scroll ke atas & bawah beberapa kali → transkrip tetap bebas nomor telp mentah", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    const firstConv = page.locator('a[href^="/chat/"]').first();
    test.skip(
      (await firstConv.count()) === 0,
      "Akun test belum punya DM — skip runtime pagination.",
    );
    await firstConv.click();
    await page.waitForURL(/\/chat\/[0-9a-f-]{36}/);

    // Kandidat scroller: main / [data-transcript] / elemen dengan overflow-y-auto.
    // Kita pilih yang scrollHeight paling besar > clientHeight.
    const pickScroller = async (): Promise<() => Promise<void>> => {
      const handle = await page.evaluateHandle(() => {
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>(
            "main, [data-transcript], [data-chat-transcript], div",
          ),
        );
        let best: HTMLElement | null = null;
        let bestGap = 0;
        for (const n of nodes) {
          const gap = n.scrollHeight - n.clientHeight;
          const style = getComputedStyle(n);
          if (!/auto|scroll/.test(style.overflowY)) continue;
          if (gap > bestGap) { best = n; bestGap = gap; }
        }
        return best;
      });
      return async () => {
        await page.evaluate((el) => {
          if (!el) return;
          (el as HTMLElement).scrollTop = 0;
        }, handle);
      };
    };

    const scrollToTop = await pickScroller();

    // Kumpulkan snapshot transkrip di beberapa wave: awal → scroll up
    // (memicu load-more bila ada) → tunggu → scroll up lagi → scroll bawah.
    const captures: string[] = [];
    const main = page.locator("main, body").first();

    captures.push(await main.innerText());
    for (let i = 0; i < 3; i++) {
      await scrollToTop();
      await page.waitForTimeout(500); // beri kesempatan load-more (kalau ada) fetch.
      captures.push(await main.innerText());
    }
    // Scroll ke bawah lagi untuk mensimulasikan kembali ke pesan terbaru.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    captures.push(await main.innerText());

    for (const [i, txt] of captures.entries()) {
      expect(txt, `wave #${i}: transkrip tidak boleh memuat nomor telp mentah`)
        .not.toMatch(PHONE_LIKE);
      if (/PIN\s+/i.test(txt)) {
        expect(txt, `wave #${i}: label PIN harus format PIN xxxx-xxxx`).toMatch(PIN_FMT);
      }
    }

    // Reload sekali: memaksa hydrate ulang; ulangi pass singkat untuk
    // menutup skenario cache lama menampilkan phone.
    await page.reload({ waitUntil: "networkidle" });
    const scrollToTop2 = await pickScroller();
    await scrollToTop2();
    await page.waitForTimeout(400);
    const afterReload = await main.innerText();
    expect(afterReload, "setelah reload: transkrip tetap bebas nomor telp mentah")
      .not.toMatch(PHONE_LIKE);
    if (/PIN\s+/i.test(afterReload)) {
      expect(afterReload).toMatch(PIN_FMT);
    }
  });
});