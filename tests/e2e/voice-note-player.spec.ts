import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E — Voice note rekam → preview → kirim → tampil di transkrip.
 *
 * 1. Static source guards (selalu jalan, no-auth):
 *    - `VoiceRecorderButton.tsx`: memakai MediaRecorder (getUserMedia
 *      audio), menampilkan preview `<audio ... controls>` sebelum kirim,
 *      dan meng-upload file ke storage lalu insert ke tabel `messages`.
 *    - `MessageAttachment.tsx`: untuk MIME `audio/*` merutekan ke
 *      `VoiceNotePlayer` — TIDAK memakai raw `<audio controls>` lagi
 *      supaya UI konsisten.
 *    - `VoiceNotePlayer.tsx`: mengekspos tombol play/pause dengan
 *      aria-label yang jelas, input range progress, label durasi, dan
 *      menandai elemen `<audio data-voice-note>` agar bisa auto-pause
 *      pemain lain saat satu diputar.
 *
 * 2. Runtime harness `/lovable/visual/voice-note-player` (no-auth):
 *    - 40 pemain identik di kontainer scrollable untuk mensimulasikan
 *      daftar chat virtualized.
 *    - Klik play pada baris pertama → aria-label berubah ke "Jeda",
 *      progress bar bergerak, label durasi terlihat.
 *    - Scroll ke baris jauh, klik play → pemain baris pertama otomatis
 *      pause (bukti selector `[data-voice-note]` bekerja).
 */

// ── 1) Source guards ──────────────────────────────────────────────────
test.describe("voice note — source guard", () => {
  test("VoiceRecorderButton: MediaRecorder + preview <audio> + kirim ke messages", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/chat/VoiceRecorderButton.tsx"),
      "utf8",
    );
    expect(src).toMatch(/getUserMedia\(\s*\{\s*audio:\s*true/);
    expect(src).toMatch(/new\s+MediaRecorder/);
    // Preview player sebelum kirim.
    expect(src).toMatch(/<audio[^>]*controls/);
    // Insert baris ke tabel messages setelah upload sukses.
    expect(src).toMatch(/from\(\s*["']messages["']\s*\)/);
  });

  test("MessageAttachment: audio/* merutekan ke VoiceNotePlayer", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/chat/MessageAttachment.tsx"),
      "utf8",
    );
    expect(src).toMatch(/import\s*\{\s*VoiceNotePlayer\s*\}/);
    // Cabang audio memakai komponen player, bukan raw <audio controls>.
    const audioBranch = src.slice(src.indexOf('mime.startsWith("audio/")'));
    expect(audioBranch).toMatch(/<VoiceNotePlayer\b/);
  });

  test("VoiceNotePlayer: play/pause + range progress + label durasi", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/chat/VoiceNotePlayer.tsx"),
      "utf8",
    );
    expect(src).toMatch(/aria-label=\{playing\s*\?\s*"Jeda voice note"\s*:\s*"Putar voice note"\}/);
    expect(src).toMatch(/type=\"range\"/);
    expect(src).toMatch(/data-voice-note/);
    // Format m:ss ada.
    expect(src).toMatch(/toString\(\)\.padStart\(2,\s*"0"\)/);
  });
});

// ── 2) Runtime harness ────────────────────────────────────────────────
test.describe("voice note — runtime pemutar & interaksi scroll", () => {
  test("play/pause baris pertama, progress bergerak, auto-pause saat baris lain diputar", async ({ page }) => {
    await page.goto("/lovable/visual/voice-note-player");
    // Tunggu sampel WAV siap.
    const first = page.locator('[data-vn-index="0"]');
    await first.waitFor({ state: "visible" });
    const playBtn0 = first.getByRole("button", { name: "Putar voice note" });
    await expect(playBtn0).toBeVisible();

    // Klik play — tombol berubah menjadi "Jeda".
    await playBtn0.click();
    const pauseBtn0 = first.getByRole("button", { name: "Jeda voice note" });
    await expect(pauseBtn0).toBeVisible({ timeout: 3_000 });

    // Range progress bergerak dari 0 setelah beberapa saat playback.
    const range0 = first.locator('input[type="range"]');
    await expect
      .poll(async () => Number(await range0.inputValue()), { timeout: 3_000 })
      .toBeGreaterThan(0);

    // Scroll kontainer ke baris jauh (mensimulasikan virtualized list),
    // lalu putar baris tsb — baris pertama harus auto-pause.
    const target = page.locator('[data-vn-index="30"]');
    await target.scrollIntoViewIfNeeded();
    const playBtn30 = target.getByRole("button", { name: "Putar voice note" });
    await playBtn30.click();
    await expect(target.getByRole("button", { name: "Jeda voice note" })).toBeVisible({
      timeout: 3_000,
    });

    // Baris pertama kembali ke label "Putar" karena auto-pause.
    await expect(first.getByRole("button", { name: "Putar voice note" })).toBeVisible({
      timeout: 3_000,
    });
  });
});