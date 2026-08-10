// README scenario: README.md#apk-scenario-copy-chat-apk-aria-label
import { test, expect } from "@playwright/test";
import { installApkStub, makeRelease } from "./_apk-availability-stub";

/**
 * E2E: verifikasi `aria-label` <CopyChatApkLinksButton variant="shortcut">
 * di setiap state (per spesifikasi komponen):
 *
 *   1. Idle · belum tersedia
 *      → "APK Ace Chat belum tersedia — ketuk untuk cek ulang"
 *   2. Disabled · checking (isFetching setelah tap refresh/main)
 *      → "Memeriksa ketersediaan APK Ace Chat, tombol dinonaktifkan sementara"
 *      + attribute `disabled`
 *   3. Idle · tersedia (siap salin)
 *      → "Salin semua link APK Chat"
 *   4. Disabled · busy (proses menyalin, fetchDetail dalam onClick)
 *      → "Memproses: menyalin semua link APK Ace Chat, tombol dinonaktifkan sementara"
 *      + attribute `disabled`
 *   5. Aktif · tersalin
 *      → "Tersalin: semua link APK Ace Chat sudah disalin ke clipboard"
 *
 * Semua state diverifikasi lewat harness publik no-auth
 * /lovable/visual/apk-availability-shortcuts dengan stub server-fn
 * berbasis gate yang dapat ditahan/dilepas dari sisi test.
 */

const URL = "/lovable/visual/apk-availability-shortcuts";

test.describe("CopyChatApkLinksButton · aria-label per state", () => {
  test("idle → checking(disabled) → tersedia → busy(disabled) → tersalin", async ({
    page,
    context,
  }) => {
    // Beri izin clipboard supaya `navigator.clipboard.writeText` pada
    // state "busy → tersalin" berhasil di sisi Chromium.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    // Semua respons server-fn di-stub via helper bersama. Pola
    // "hold → release" = jangan enqueue dulu → handler menahan
    // waiter, lalu enqueue saat test siap melanjutkan.
    const stub = await installApkStub(page);
    stub.primeInitial();
    stub.assertPrimed();
    await page.goto(URL);

    const wrapper = page.getByTestId("apk-shortcut-copy-chat-links");
    // Tombol utama = tombol dalam wrapper yang bertipe `flex flex-col`
    // (bukan tombol ikon refresh). Kita target lewat aria-label yang
    // per-state selalu unik.
    const mainByAria = (name: RegExp) =>
      wrapper.getByRole("button", { name });

    // ============ (1) Idle · belum tersedia ============
    // Sinkronisasi awal: tunggu event served untuk kedua fetch mount
    // (chat + storage) — assertion UI berikutnya tidak bergantung
    // interval polling / timing render.
    await stub.waitForServed("chat", 1);
    await stub.waitForServed("storage", 1);
    await expect(
      mainByAria(
        /^APK Ace Chat belum tersedia — ketuk untuk cek ulang$/,
      ),
    ).toBeVisible();
    // Idle-unavailable: tombol utama TIDAK disabled (agar bisa ditap
    // untuk memicu refetch); hanya busy/checking yang men-disable.
    await expect(
      mainByAria(
        /^APK Ace Chat belum tersedia — ketuk untuk cek ulang$/,
      ),
    ).toBeEnabled();

    // ============ (2) Disabled · checking ============
    // Tahan respons chat, lalu tap tombol utama → memicu
    // `availability.refetch()` (karena !isAvailable). Selama refetch
    // berjalan, isFetching = true → aria-label harus berubah ke
    // state "Memeriksa…".
    // (tidak enqueue chat → handler menahan waiter → state Memeriksa…)
    // Wrapper leak-guard: aksi tap tombol Chat tidak boleh menyentuh
    // varian storage sama sekali. Event-based; snapshot requested
    // ["storage"] & fail cepat kalau ada request storage bocor.
    await stub.trackedAction(
      async () => {
        await mainByAria(
          /^APK Ace Chat belum tersedia — ketuk untuk cek ulang$/,
        ).click();
      },
      { variant: "storage" },
    );

    // Tunggu event "waiter tertahan" dari handler — bukti deterministik
    // bahwa refetch chat sudah sampai di handler dan sedang digantung.
    await stub.waitForHold("chat");

    const checkingLabel =
      /^Memeriksa ketersediaan APK Ace Chat, tombol dinonaktifkan sementara$/;
    await expect(mainByAria(checkingLabel)).toBeVisible();
    await expect(mainByAria(checkingLabel)).toBeDisabled();
    // Guard: label idle/aktif tidak bocor ke state checking.
    await expect(
      mainByAria(/^Salin semua link APK Chat$/),
    ).toHaveCount(0);
    await expect(
      mainByAria(
        /^APK Ace Chat belum tersedia — ketuk untuk cek ulang$/,
      ),
    ).toHaveCount(0);

    // ============ (3) Idle · tersedia ============
    // Rilis waiter chat dengan rilis tersedia.
    stub.enqueue("chat", [makeRelease("chat")]);
    await stub.waitForServed("chat", 2);
    const idleAvailableLabel = /^Salin semua link APK Chat$/;
    await expect(mainByAria(idleAvailableLabel)).toBeVisible();
    await expect(mainByAria(idleAvailableLabel)).toBeEnabled();

    // ============ (4) Disabled · busy (menyalin) ============
    // Tahan respons chat lagi, tap tombol utama → onClick akan
    // memanggil fetchDetail sebelum menulis clipboard; selama request
    // digantung, busy=true → aria-label harus berubah ke state
    // "Memproses…" dan tombol disabled.
    // (tidak enqueue chat → onClick fetchDetail menggantung → busy=true)
    await stub.trackedAction(
      async () => {
        await mainByAria(idleAvailableLabel).click();
      },
      { variant: "storage" },
    );

    // Bukti deterministik: request fetchDetail sudah tiba di handler
    // dan digantung. Aman untuk mengukur label "Memproses…".
    await stub.waitForHold("chat");

    const busyLabel =
      /^Memproses: menyalin semua link APK Ace Chat, tombol dinonaktifkan sementara$/;
    await expect(mainByAria(busyLabel)).toBeVisible();
    await expect(mainByAria(busyLabel)).toBeDisabled();
    // Guard: bukan lagi label "Memeriksa…" (query sudah cache-hit,
    // bukan isFetching).
    await expect(mainByAria(checkingLabel)).toHaveCount(0);

    // ============ (5) Aktif · tersalin ============
    stub.enqueue("chat", [makeRelease("chat")]);
    const copiedLabel =
      /^Tersalin: semua link APK Ace Chat sudah disalin ke clipboard$/;
    // `copied` di-reset setelah 2 detik — assertion default (5s) cukup
    // untuk menangkap window ini; batasi timeout eksplisit supaya
    // regresi (label tidak pernah muncul) gagal cepat.
    await expect(mainByAria(copiedLabel)).toBeVisible({ timeout: 3000 });
    // Clipboard benar-benar berisi header + baris versi.
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain("Ace Chat APK — daftar unduhan");
    expect(clip).toContain("https://example.test/Ace-Chat-1.0.0.apk");

    // === Post-active quiescent guard ===
    // Setelah state "tersalin", TIDAK boleh ada request tambahan ke
    // handler untuk varian chat/storage (query cache-hit, tidak ada
    // polling / refetch background yang lolos).
    await stub.assertQuiescent("chat", { windowMs: 1000 });
    await stub.assertQuiescent("storage", { windowMs: 500 });
    // Terminal: guard event-based untuk kedua varian.
    await stub.terminalGuard();
  });
});