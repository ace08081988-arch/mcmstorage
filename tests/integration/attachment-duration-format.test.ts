import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { formatDurationMMSS } from "@/lib/format-duration";
import {
  computeVoiceNoteLabel,
  normalizeDurationSec,
} from "@/components/chat/VoiceNotePlayer";

/**
 * Kontrak refactor:
 *
 *   SEMUA komponen attachment yang menampilkan durasi (voice note, timer
 *   recorder, dan turunannya) WAJIB memakai `formatDurationMMSS` dari
 *   `@/lib/format-duration`. Tidak boleh ada formatter mm:ss ad-hoc di
 *   `src/components/chat/`, agar label 0:03 vs 00:03 vs 0:3 tidak pernah
 *   bercabang.
 *
 *   `src/lib/calls.ts` sengaja memakai format lain ("j / m / dtk") untuk
 *   riwayat panggilan — bukan komponen attachment.
 */

const CHAT_DIR = join(process.cwd(), "src", "components", "chat");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

// Pola formatter mm:ss ad-hoc yang wajib DIHAPUS di komponen attachment.
// - `padStart(2, "0")` pada literal template yang juga memuat `:`
// - `Math.floor(x / 60)` dikombinasikan dengan `% 60`
const ADHOC_PATTERNS: Array<{ re: RegExp; why: string }> = [
  {
    re: /`\$\{[^`]*padStart\(\s*2[^`]*\}:\$\{[^`]*padStart\(\s*2[^`]*\}`/s,
    why: "template literal mm:ss ad-hoc — pakai formatDurationMMSS",
  },
  {
    re: /Math\.floor\([^)]*\/\s*60[^)]*\)[\s\S]{0,120}%\s*60/,
    why: "aritmetika menit/detik ad-hoc — pakai formatDurationMMSS",
  },
];

describe("attachment duration format — util tersentralisasi", () => {
  it("tidak ada formatter mm:ss ad-hoc di src/components/chat/**", () => {
    const files = walk(CHAT_DIR);
    expect(files.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const { re, why } of ADHOC_PATTERNS) {
        if (re.test(src)) violations.push(`${file}: ${why}`);
      }
    }
    expect(violations, `Pola mm:ss ad-hoc terdeteksi:\n${violations.join("\n")}`).toEqual([]);
  });

  it("komponen attachment yang menampilkan durasi mengimpor formatDurationMMSS", () => {
    // Daftar komponen yang secara kontrak menampilkan durasi media.
    // Setiap tambahan baru harus ditambahkan di sini agar audit ini
    // gagal jika lupa memakai util bersama.
    const REQUIRED = [
      "VoiceNotePlayer.tsx",
      "VoiceRecorderButton.tsx",
    ];
    for (const name of REQUIRED) {
      const src = readFileSync(join(CHAT_DIR, name), "utf8");
      expect(
        src.includes('from "@/lib/format-duration"'),
        `${name} wajib mengimpor formatDurationMMSS dari @/lib/format-duration`,
      ).toBe(true);
      expect(
        /formatDurationMMSS\s*\(/.test(src),
        `${name} wajib memanggil formatDurationMMSS`,
      ).toBe(true);
    }
  });

  it("VoiceRecorderButton tidak lagi memakai alias `fmt` (langsung ke util)", () => {
    const src = readFileSync(join(CHAT_DIR, "VoiceRecorderButton.tsx"), "utf8");
    expect(/\bconst\s+fmt\s*=/.test(src)).toBe(false);
    expect(/\{fmt\(/.test(src)).toBe(false);
  });

  // Behavioral: label VoiceNotePlayer utk desimal `durationSec` HARUS
  // identik dengan `formatDurationMMSS(normalizeDurationSec(raw))`. Ini
  // membuktikan util yang sama dipakai — bukan formatter berbeda yang
  // kebetulan menghasilkan output serupa.
  describe("computeVoiceNoteLabel memakai formatDurationMMSS + normalizeDurationSec", () => {
    const RAWS = [0.01, 0.4, 0.5, 0.99, 1, 1.4, 1.5, 2.7, 3.5, 59.4, 59.6, 125.3];
    for (const raw of RAWS) {
      it(`durationSec=${raw} → label = formatDurationMMSS(normalize)`, () => {
        const initial = normalizeDurationSec(raw) ?? 0;
        const label = computeVoiceNoteLabel({
          playing: false,
          current: 0,
          ready: false,
          duration: 0,
          initial,
        });
        const expected = formatDurationMMSS(initial);
        expect(label).toBe(expected);
        // Bonus: label wajib format mm:ss dua digit di kedua sisi.
        expect(label).toMatch(/^\d{2}:\d{2}$/);
      });
    }

    it("input tanpa durasi → '—:—' (bukan '00:00') — kontrak util bersama", () => {
      const label = computeVoiceNoteLabel({
        playing: false,
        current: 0,
        ready: false,
        duration: 0,
        initial: 0,
      });
      expect(label).toBe("—:—");
    });
  });
});