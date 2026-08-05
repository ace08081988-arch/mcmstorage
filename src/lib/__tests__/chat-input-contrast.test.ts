/**
 * Uji kontras WCAG untuk seluruh komponen input chat.
 *
 * Nilai warna dibaca langsung dari `src/styles.css`, lalu rasio kontrasnya
 * dihitung untuk tiap tema (light, dark, Noir & Gold, Midnight Indigo, dan
 * high-contrast). Kalau ada token yang diubah sampai teks/placeholder/border
 * "menyatu" dengan latar, uji ini gagal.
 */
import { describe, expect, it } from "vitest";
import { contrastRatio } from "../color-contrast";
import { readStylesCss, themeTokenMaps, type ThemeName } from "./_theme-tokens";

const css = readStylesCss();
const themes = themeTokenMaps(css);
const THEME_NAMES = Object.keys(themes) as ThemeName[];

/** Ambil nilai deklarasi pertama dari sebuah @utility. */
function utilityDecl(utility: string, prop: string, nth = 0): string {
  const re = new RegExp(`@utility\\s+${utility}\\s*\\{`);
  const start = css.search(re);
  expect(start, `@utility ${utility} tidak ditemukan`).toBeGreaterThan(-1);
  let depth = 0;
  let end = start;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  const body = css.slice(start, end);
  const matches = [...body.matchAll(new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+);`, "g"))];
  expect(matches.length, `properti ${prop} tidak ada di @utility ${utility}`).toBeGreaterThan(nth);
  return matches[nth]![1]!.trim();
}

type Case = {
  label: string;
  fg: string;
  bg: string;
  min: number;
};

const TEXT_AA = 4.5; // teks normal
const UI_AA = 3; // border/ikon (WCAG 1.4.11 non-text)

const cases: Case[] = [
  // Composer utama
  { label: "teks composer", fg: utilityDecl("chat-input-contrast", "color"), bg: "var(--card)", min: TEXT_AA },
  { label: "placeholder composer", fg: utilityDecl("chat-input-contrast", "color", 3), bg: "var(--card)", min: TEXT_AA },
  { label: "caret composer", fg: utilityDecl("chat-input-contrast", "caret-color"), bg: "var(--card)", min: UI_AA },
  { label: "border field composer", fg: utilityDecl("chat-input-contrast", "border-color"), bg: "var(--card)", min: UI_AA },
  { label: "seleksi composer", fg: "var(--primary-foreground)", bg: "var(--primary)", min: TEXT_AA },

  // Field umum di dialog chat (chat-field-scope)
  { label: "teks field chat", fg: utilityDecl("chat-field-scope", "color"), bg: "var(--card)", min: TEXT_AA },
  { label: "caret field chat", fg: utilityDecl("chat-field-scope", "caret-color"), bg: "var(--card)", min: UI_AA },
  { label: "border field chat", fg: utilityDecl("chat-field-scope", "border-color"), bg: "var(--card)", min: UI_AA },

  // Read-only / pratinjau
  { label: "input read-only", fg: utilityDecl("chat-readonly-input", "color"), bg: "var(--card)", min: TEXT_AA },
  { label: "pratinjau di panel muted", fg: utilityDecl("chat-preview-text", "color").replace("var(--preview-ink, var(--foreground))", "var(--foreground)"), bg: "var(--muted)", min: TEXT_AA },
  { label: "pratinjau di panel kartu", fg: utilityDecl("chat-preview-text", "color").replace("var(--preview-ink, var(--foreground))", "var(--foreground)"), bg: "var(--card)", min: TEXT_AA },
  { label: "label pratinjau", fg: "var(--foreground)", bg: "var(--muted)", min: TEXT_AA },

  // Kotak cari daftar chat (token --wa-*)
  { label: "teks kotak cari chat", fg: "var(--wa-text)", bg: "var(--wa-surface)", min: TEXT_AA },
  { label: "placeholder kotak cari chat", fg: "var(--wa-text-muted)", bg: "var(--wa-surface)", min: TEXT_AA },
  { label: "border kotak cari chat", fg: "var(--wa-field-border)", bg: "var(--wa-surface)", min: UI_AA },

  // Ring fokus (WCAG 1.4.11 non-text contrast ≥3:1)
  { label: "ring fokus di atas kartu", fg: "var(--ring)", bg: "var(--card)", min: UI_AA },
  { label: "ring fokus di atas latar", fg: "var(--ring)", bg: "var(--background)", min: UI_AA },
  { label: "ring fokus di atas permukaan chat", fg: "var(--ring)", bg: "var(--wa-surface)", min: UI_AA },

  // Item aktif dropdown/autocomplete di composer chat
  { label: "teks item dropdown tersorot", fg: "var(--primary-foreground)", bg: "var(--primary)", min: TEXT_AA },
  { label: "latar item tersorot vs popover", fg: "var(--primary)", bg: "var(--popover)", min: UI_AA },
  { label: "latar item tersorot vs kartu", fg: "var(--primary)", bg: "var(--card)", min: UI_AA },
];

describe("kontras komponen input chat", () => {
  for (const theme of THEME_NAMES) {
    describe(`tema ${theme}`, () => {
      for (const c of cases) {
        it(`${c.label} ≥ ${c.min}:1`, () => {
          const ratio = contrastRatio(c.fg, c.bg, themes[theme]);
          expect(
            Number(ratio.toFixed(2)),
            `${c.label} di tema ${theme} hanya ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(c.min);
        });
      }
    });
  }

  it("state disabled tetap terbaca (≥3:1)", () => {
    const disabledText = utilityDecl("chat-input-contrast", "color", 4);
    const disabledPlaceholder = utilityDecl("chat-input-contrast", "color", 5);
    for (const theme of THEME_NAMES) {
      expect(contrastRatio(disabledText, "var(--card)", themes[theme])).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(disabledPlaceholder, "var(--card)", themes[theme])).toBeGreaterThanOrEqual(3);
    }
  });
});

/* ---------------------------------------------------------------------------
 * State HOVER pada dropdown autocomplete / mention di composer chat.
 * Selain rasio kontras, kita verifikasi juga bahwa aturan CSS-nya memang
 * memakai token --primary / --primary-foreground (bukan --accent yang tipis).
 * ------------------------------------------------------------------------ */

/** Ambil blok aturan item dropdown dalam lingkup chat. */
function chatOptionScopeBlock(): string {
  const anchor = css.indexOf('[data-slot="dropdown-menu-item"]');
  expect(anchor, "aturan item dropdown chat tidak ditemukan").toBeGreaterThan(-1);
  return css.slice(anchor, anchor + 1400);
}

const hoverCases: Case[] = [
  { label: "teks item saat hover", fg: "var(--primary-foreground)", bg: "var(--primary)", min: TEXT_AA },
  { label: "ikon/badge item saat hover", fg: "var(--primary-foreground)", bg: "var(--primary)", min: UI_AA },
  { label: "latar hover vs popover", fg: "var(--primary)", bg: "var(--popover)", min: UI_AA },
  { label: "latar hover vs kartu", fg: "var(--primary)", bg: "var(--card)", min: UI_AA },
  { label: "latar hover vs permukaan chat", fg: "var(--primary)", bg: "var(--wa-surface)", min: UI_AA },
  { label: "outline fokus item hover", fg: "var(--ring)", bg: "var(--primary)", min: UI_AA },
];

describe("kontras state hover dropdown autocomplete/mention chat", () => {
  for (const theme of THEME_NAMES) {
    describe(`tema ${theme}`, () => {
      for (const c of hoverCases) {
        it(`${c.label} ≥ ${c.min}:1`, () => {
          const ratio = contrastRatio(c.fg, c.bg, themes[theme]);
          expect(
            Number(ratio.toFixed(2)),
            `${c.label} di tema ${theme} hanya ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(c.min);
        });
      }
    });
  }

  it("utility chat-option-highlight menangani :hover", () => {
    const bg = utilityDecl("chat-option-highlight", "background-color");
    const fg = utilityDecl("chat-option-highlight", "color");
    expect(bg).toBe("var(--primary)");
    expect(fg).toBe("var(--primary-foreground)");
    const re = /@utility\s+chat-option-highlight\s*\{[\s\S]*?\n\}/;
    const body = css.match(re)?.[0] ?? "";
    expect(body).toMatch(/:hover/);
    expect(body).toMatch(/focus-visible/);
  });

  it("item dropdown dalam lingkup chat memakai token primary saat hover", () => {
    const block = chatOptionScopeBlock();
    expect(block).toMatch(/&:hover/);
    expect(block).toMatch(/background-color:\s*var\(--primary\)/);
    expect(block).toMatch(/color:\s*var\(--primary-foreground\)/);
    // teks sekunder/ikon tidak boleh tetap redup saat hover
    expect(block).toMatch(/opacity:\s*1/);
    expect(block).not.toMatch(/var\(--accent\)/);
  });
});
