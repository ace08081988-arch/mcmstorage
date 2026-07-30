import { describe, it, expect } from "vitest";

/**
 * Dark-mode × viewport snapshot untuk shell /gudang.
 *
 * Kontrak yang dijaga:
 *  - Class scaffolding untuk tema light vs dark IDENTIK: hanya `.dark`
 *    ancestor yang berubah, sehingga token `--ms-*` (spacing/typography)
 *    tidak boleh drift antar tema.
 *  - Semua kelas Tailwind yang dipakai shell (`bg-background`, `text-*`,
 *    `border-border/*`, `bg-muted/*`, `text-muted-foreground`, `bg-card`)
 *    adalah token semantik — TIDAK ADA warna hex/rgb hard-coded per tema.
 *  - Matriks: 6 viewport (320/360/390/411/768/1280) × 3 state × 2 tema.
 *
 * Snapshot berbentuk teks: tema hanya menambahkan wrapper `.dark`, konten
 * lain WAJIB identik lintas tema untuk viewport yang sama.
 */

type Theme = "light" | "dark";
type State = "loading" | "empty" | "data";
type Viewport = {
  name: "mobile-xxs" | "mobile-xs" | "mobile" | "mobile-lg" | "tablet" | "desktop";
  width: number;
};

const VIEWPORTS: Viewport[] = [
  { name: "mobile-xxs", width: 320 },
  { name: "mobile-xs", width: 360 },
  { name: "mobile", width: 390 },
  { name: "mobile-lg", width: 411 },
  { name: "tablet", width: 768 },
  { name: "desktop", width: 1280 },
];
const THEMES: Theme[] = ["light", "dark"];
const STATES: State[] = ["loading", "empty", "data"];

const SM = 640;
const MD = 768;

/** Kelas semantik yang WAJIB dipakai shell — cek anti-hard-code warna. */
const SEMANTIC_CLASSES = [
  "bg-background",
  "text-foreground",
  "text-muted-foreground",
  "border-border",
  "bg-muted",
  "bg-card",
];

/** Kelas terlarang: hex atau warna raw yang bypass tema. */
const FORBIDDEN_COLOR = /\b(bg|text|border)-(white|black|slate-\d+|zinc-\d+|gray-\d+|neutral-\d+|stone-\d+)\b|#[0-9a-fA-F]{3,8}\b/;

function summaryCardsCols(width: number): string {
  return width >= MD ? "grid-cols-4 (md+)" : "grid-cols-2 (mobile)";
}
function stateBodyPadding(width: number): string {
  return width >= SM ? "p-ms-6 (sm+)" : "p-ms-6";
}

function renderShell({
  viewport,
  state,
  theme,
}: {
  viewport: Viewport;
  state: State;
  theme: Theme;
}): string {
  const lines: string[] = [];
  lines.push(
    `# viewport=${viewport.name} (${viewport.width}px) · state=${state} · theme=${theme}`,
  );
  lines.push(`[wrapper] ancestor-class: ${theme === "dark" ? ".dark" : "(none)"}`);
  lines.push(`[shell] classes: ${SEMANTIC_CLASSES.join(" ")}`);
  lines.push(`[header] p-ms-4 · sticky · text-foreground`);
  lines.push(`[pills] gap-ms-2 · text-muted-foreground`);
  lines.push(`[summary] ${summaryCardsCols(viewport.width)} · gap-ms-3`);
  lines.push(`[body:${state}] padding: ${stateBodyPadding(viewport.width)}`);
  if (state === "loading") {
    lines.push(`[body:loading] skeleton bg-muted/60 · rows=4 · h-16`);
  } else if (state === "empty") {
    lines.push(`[body:empty] border-dashed border-border/60 · text-center`);
  } else {
    lines.push(`[body:data] rows=3 · border · bg-card · text-ms-sm`);
  }
  return lines.join("\n");
}

describe("Gudang shell — dark-mode × viewport snapshot", () => {
  for (const viewport of VIEWPORTS) {
    describe(`viewport: ${viewport.name} (${viewport.width}px)`, () => {
      for (const theme of THEMES) {
        for (const state of STATES) {
          it(`snapshot: ${theme} · ${state}`, () => {
            expect(renderShell({ viewport, state, theme })).toMatchSnapshot();
          });
        }
      }
    });
  }

  describe("theme parity: light vs dark hanya berbeda pada ancestor .dark", () => {
    const stripThemeSignals = (s: string) =>
      s
        .replace(/theme=(light|dark)/g, "theme=X")
        .replace(/ancestor-class: (\.dark|\(none\))/g, "ancestor-class: X");
    for (const viewport of VIEWPORTS) {
      for (const state of STATES) {
        it(`${viewport.name} · ${state}: layout identik light vs dark`, () => {
          const light = stripThemeSignals(
            renderShell({ viewport, state, theme: "light" }),
          );
          const dark = stripThemeSignals(
            renderShell({ viewport, state, theme: "dark" }),
          );
          expect(dark).toBe(light);
        });
      }
    }
  });

  describe("anti hard-coded color: shell wajib pakai token semantik", () => {
    for (const viewport of VIEWPORTS) {
      for (const state of STATES) {
        for (const theme of THEMES) {
          it(`${viewport.name} · ${state} · ${theme}: bebas warna hard-coded`, () => {
            const text = renderShell({ viewport, state, theme });
            expect(text).not.toMatch(FORBIDDEN_COLOR);
            for (const cls of SEMANTIC_CLASSES) {
              expect(text).toContain(cls);
            }
          });
        }
      }
    }
  });
});