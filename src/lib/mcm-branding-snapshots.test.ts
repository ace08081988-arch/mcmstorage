import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guardrail snapshot: memastikan branding "MCM" tidak bergeser kembali
 * ke "WhatsApp"/"WA" pada permukaan chat utama.
 *
 * Cara kerja: ekstrak seluruh string literal user-facing (di dalam JSX text,
 * atribut placeholder/title/aria-label, dan template string) yang menyebut
 * salah satu token branding, lalu bekukan sebagai snapshot. Bila ada label
 * yang berubah/ditambah/dihapus, snapshot akan gagal dan wajib direview.
 *
 * Identifier teknis (URL `whatsapp://`, `wa.me`, package `com.whatsapp.*`,
 * nama variabel/impor, komentar) sengaja diabaikan.
 */

const FILES = {
  "daftar percakapan": "src/routes/_authenticated.chat.index.tsx",
  "dialog undang": "src/routes/_authenticated.undang.tsx",
  "kartu kontak": "src/components/chat/ProfileQrDialog.tsx",
  "detail chat": "src/routes/_authenticated.chat.$conversationId.tsx",
  "forward (selection toolbar)": "src/components/chat/SelectionToolbar.tsx",
} as const;

const BRAND_RE = /\b(MCM|WhatsApp|WA)\b/;

// Baris yang jelas non-UI dan harus diabaikan meski mengandung token.
const TECH_HINT_RE =
  /whatsapp:\/\/|wa\.me|com\.whatsapp|^\s*(\/\/|\*|\/\*)|import\s|from\s+["']|require\(/i;

function extractBrandLabels(source: string): string[] {
  const out = new Set<string>();
  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!BRAND_RE.test(line)) continue;
    if (TECH_HINT_RE.test(line)) continue;
    out.add(line);
  }
  return [...out].sort();
}

describe("MCM branding — snapshot label chat kunci", () => {
  for (const [label, relPath] of Object.entries(FILES)) {
    it(`${label} → ${relPath}`, () => {
      const src = readFileSync(resolve(process.cwd(), relPath), "utf8");
      const labels = extractBrandLabels(src);

      // Hard assertion: tidak boleh ada label user-facing yang menyebut
      // "WhatsApp" atau kata utuh "WA" lagi.
      const leaked = labels.filter((s) => /\b(WhatsApp|WA)\b/.test(s));
      expect(leaked, `Label WA/WhatsApp bocor di ${relPath}`).toEqual([]);

      // Freeze daftar label MCM sebagai snapshot supaya pergeseran wording
      // ketahuan lebih awal.
      expect(labels).toMatchSnapshot();
    });
  }
});