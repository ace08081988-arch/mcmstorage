/**
 * Ekstraksi token tema dari `src/styles.css` untuk pengujian kontras.
 * Membaca file CSS asli sehingga uji selalu mengikuti nilai token terbaru.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSS_PATH = resolve(process.cwd(), "src/styles.css");

export function readStylesCss(): string {
  return readFileSync(CSS_PATH, "utf8");
}

/** Ambil isi semua blok CSS yang selector-nya cocok dengan `matcher`. */
export function tokensForSelector(css: string, matcher: (selector: string) => boolean) {
  const tokens: Record<string, string> = {};
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const selector = m[1]!.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (!selector || !matcher(selector)) continue;
    for (const decl of m[2]!.split(";")) {
      const idx = decl.indexOf(":");
      if (idx < 0) continue;
      const prop = decl.slice(0, idx).trim();
      if (!prop.startsWith("--")) continue;
      tokens[prop] = decl.slice(idx + 1).replace(/!important/g, "").trim();
    }
  }
  return tokens;
}

export type ThemeName = "light" | "dark" | "noir" | "indigo" | "light-hc" | "dark-hc";

/** Peta token per tema (light, dark, Noir & Gold, Midnight Indigo, high contrast). */
export function themeTokenMaps(css = readStylesCss()): Record<ThemeName, Record<string, string>> {
  const light = tokensForSelector(css, (s) => s === ":root");
  const dark = tokensForSelector(css, (s) => s === ".dark");
  const noir = tokensForSelector(
    css,
    (s) => s.includes('data-midnight="1"') && s.includes(':not([data-theme-variant="indigo"])'),
  );
  const indigo = tokensForSelector(
    css,
    (s) => s.includes('data-midnight="1"') && s.includes('[data-theme-variant="indigo"]') && !s.includes(":not("),
  );
  const hcLight = tokensForSelector(css, (s) => s === 'html[data-high-contrast="on"]');
  const hcDark = tokensForSelector(css, (s) => s === 'html[data-high-contrast="on"].dark');

  return {
    light,
    dark: { ...light, ...dark },
    noir: { ...light, ...dark, ...noir },
    indigo: { ...light, ...dark, ...indigo },
    "light-hc": { ...light, ...hcLight },
    "dark-hc": { ...light, ...dark, ...hcDark },
  };
}
