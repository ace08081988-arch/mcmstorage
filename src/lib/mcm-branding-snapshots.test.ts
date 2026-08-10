import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guardrail snapshot: memastikan nama brand lama ("MCM") tidak muncul lagi
 * pada permukaan chat utama setelah rebrand ke Ace Storage / Ace Chat.
 *
 * Penting: "WhatsApp"/"WA" BUKAN nama brand kita — itu nama kanal pihak
 * ketiga dan harus tetap apa adanya. Label seperti "Kirim via WhatsApp"
 * sengaja dibiarkan; yang dilarang hanya sisa kata "MCM".
 *
 * Identifier teknis (URL `whatsapp://`, `wa.me`, package `com.whatsapp.*`,
 * kolom `pin_chat_mcm`, nama variabel/impor, komentar) sengaja diabaikan.
 */

const FILES = {
  "daftar percakapan": "src/routes/_authenticated.chat.index.tsx",
  "dialog undang": "src/routes/_authenticated.undang.tsx",
  "kartu kontak": "src/components/chat/ProfileQrDialog.tsx",
  "detail chat": "src/routes/_authenticated.chat.$conversationId.tsx",
  "forward (selection toolbar)": "src/components/chat/SelectionToolbar.tsx",
} as const;

const BRAND_RE = /\b(Ace|MCM|Mcm|WhatsApp|WA)\b/;

// Baris yang jelas non-UI dan harus diabaikan meski mengandung token.
const TECH_HINT_RE =
  /whatsapp:\/\/|wa\.me|com\.whatsapp|pin_chat_mcm|mcmstorage|mcm[.:-]|^\s*(\/\/|\*|\/\*)|\*\/|import\s|from\s+["']|require\(/i;

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

describe("Ace branding — snapshot label chat kunci", () => {
  for (const [label, relPath] of Object.entries(FILES)) {
    it(`${label} → ${relPath}`, () => {
      const src = readFileSync(resolve(process.cwd(), relPath), "utf8");
      const labels = extractBrandLabels(src);

      // Hard assertion: tidak boleh ada label user-facing yang masih
      // menyebut nama brand lama "MCM".
      const leaked = labels.filter((s) => /\bMCM\b|\bMcm\b/.test(s));
      expect(leaked, `Nama brand lama "MCM" bocor di ${relPath}`).toEqual([]);

      // Freeze daftar label Ace sebagai snapshot supaya pergeseran wording
      // ketahuan lebih awal.
      expect(labels).toMatchSnapshot();
    });
  }
});