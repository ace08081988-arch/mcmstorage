/**
 * Utilitas kontras warna (WCAG 2.1) untuk token tema.
 *
 * Mendukung subset CSS yang dipakai design system ini:
 *   - `oklch(L C H)` dan `oklch(L C H / alpha%)`
 *   - `color-mix(in oklab, <warna> <p>%, <warna>)`
 *   - `var(--token)` (di-resolve lewat peta token yang diberikan)
 *   - `#rrggbb`
 *
 * Dipakai oleh pengujian otomatis kontras input chat sehingga tidak ada
 * kombinasi teks/latar yang "menyatu" di tema mana pun.
 */

export type Rgb = { r: number; g: number; b: number; a: number };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function oklabToLinearSrgb(L: number, a: number, b: number) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

function linearToSrgb(c: number) {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
  return clamp01(v);
}

function srgbToLinear(c: number) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

type Oklab = { L: number; a: number; b: number; alpha: number };

function oklchToOklab(L: number, C: number, H: number, alpha: number): Oklab {
  const h = (H * Math.PI) / 180;
  return { L, a: C * Math.cos(h), b: C * Math.sin(h), alpha };
}

function oklabToRgb({ L, a, b, alpha }: Oklab): Rgb {
  const lin = oklabToLinearSrgb(L, a, b);
  return { r: linearToSrgb(lin.r), g: linearToSrgb(lin.g), b: linearToSrgb(lin.b), a: alpha };
}

function rgbToOklab({ r, g, b, a }: Rgb): Oklab {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    alpha: a,
  };
}

function splitTopLevel(input: string, separator: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of input) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === separator && depth === 0) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function parseAlpha(raw: string | undefined): number {
  if (!raw) return 1;
  const t = raw.trim();
  if (t.endsWith("%")) return clamp01(parseFloat(t) / 100);
  return clamp01(parseFloat(t));
}

/** Resolve sebuah nilai warna CSS menjadi RGB 0..1 (alpha ikut dibawa). */
export function parseColor(value: string, tokens: Record<string, string> = {}, seen = 0): Rgb {
  const input = value.trim();
  if (seen > 20) throw new Error(`Rekursi token terlalu dalam: ${value}`);

  const varMatch = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/.exec(input);
  if (varMatch) {
    const token = tokens[varMatch[1]!];
    if (token) return parseColor(token, tokens, seen + 1);
    if (varMatch[2]) return parseColor(varMatch[2], tokens, seen + 1);
    throw new Error(`Token tidak dikenal: ${varMatch[1]}`);
  }

  if (input.startsWith("#")) {
    const hex = input.slice(1);
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    return {
      r: parseInt(full.slice(0, 2), 16) / 255,
      g: parseInt(full.slice(2, 4), 16) / 255,
      b: parseInt(full.slice(4, 6), 16) / 255,
      a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    };
  }

  const oklchMatch = /^oklch\(([\s\S]+)\)$/.exec(input);
  if (oklchMatch) {
    const [comps, alphaRaw] = splitTopLevel(oklchMatch[1]!, "/");
    const parts = comps!.trim().split(/\s+/);
    const L = parts[0]!.endsWith("%") ? parseFloat(parts[0]!) / 100 : parseFloat(parts[0]!);
    const C = parseFloat(parts[1] ?? "0");
    const H = parseFloat(parts[2] ?? "0");
    return oklabToRgb(oklchToOklab(L, C, H, parseAlpha(alphaRaw)));
  }

  const mixMatch = /^color-mix\(([\s\S]+)\)$/.exec(input);
  if (mixMatch) {
    const args = splitTopLevel(mixMatch[1]!, ",");
    const space = args[0]!.replace(/^in\s+/, "").trim();
    if (space !== "oklab" && space !== "srgb") {
      throw new Error(`Ruang warna color-mix belum didukung: ${space}`);
    }
    const parse = (arg: string) => {
      const pct = /\s(\d+(?:\.\d+)?)%$/.exec(arg);
      const color = pct ? arg.slice(0, pct.index).trim() : arg.trim();
      return { color, weight: pct ? parseFloat(pct[1]!) / 100 : null };
    };
    const first = parse(args[1]!);
    const second = parse(args[2]!);
    let w1 = first.weight;
    let w2 = second.weight;
    if (w1 == null && w2 == null) { w1 = 0.5; w2 = 0.5; }
    else if (w1 == null) w1 = 1 - w2!;
    else if (w2 == null) w2 = 1 - w1;
    const total = w1! + w2!;
    w1 = w1! / total;
    w2 = w2! / total;

    const c1 = parseColor(first.color, tokens, seen + 1);
    const c2 = parseColor(second.color, tokens, seen + 1);
    if (space === "srgb") {
      return {
        r: c1.r * w1 + c2.r * w2,
        g: c1.g * w1 + c2.g * w2,
        b: c1.b * w1 + c2.b * w2,
        a: c1.a * w1 + c2.a * w2,
      };
    }
    const o1 = rgbToOklab(c1);
    const o2 = rgbToOklab(c2);
    return oklabToRgb({
      L: o1.L * w1 + o2.L * w2,
      a: o1.a * w1 + o2.a * w2,
      b: o1.b * w1 + o2.b * w2,
      alpha: o1.alpha * w1 + o2.alpha * w2,
    });
  }

  if (input === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (input === "white") return { r: 1, g: 1, b: 1, a: 1 };
  if (input === "black") return { r: 0, g: 0, b: 0, a: 1 };

  throw new Error(`Format warna belum didukung: ${value}`);
}

/** Komposisikan warna semi-transparan di atas warna latar solid. */
export function flatten(fg: Rgb, bg: Rgb): Rgb {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** Rasio kontras WCAG 2.1 (1..21). Foreground semi-transparan otomatis di-flatten. */
export function contrastRatio(
  foreground: string,
  background: string,
  tokens: Record<string, string> = {},
): number {
  const bg = flatten(parseColor(background, tokens), { r: 1, g: 1, b: 1, a: 1 });
  const fgRaw = parseColor(foreground, tokens);
  const fg = fgRaw.a < 1 ? flatten(fgRaw, bg) : fgRaw;
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
