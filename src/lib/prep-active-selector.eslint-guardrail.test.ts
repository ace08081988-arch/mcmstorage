import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Meta-guardrail: pastikan `eslint.config.js` masih memasang rule
 * `no-restricted-syntax` yang menolak literal filter/count lama untuk
 * badge aktif. Kalau seseorang menghapus blok config-nya, test ini
 * langsung gagal dengan pesan yang jelas — tidak perlu menunggu ESLint
 * baru run di CI untuk sadar rule-nya lenyap.
 */

const CFG = readFileSync(resolve(process.cwd(), "eslint.config.js"), "utf8");

describe("ESLint config — guardrail selector paket aktif", () => {
  it("mencakup src/components, src/routes, dan src/lib", () => {
    expect(CFG).toMatch(/"src\/components\/\*\*\/\*\.\{ts,tsx\}"/);
    expect(CFG).toMatch(/"src\/routes\/\*\*\/\*\.\{ts,tsx\}"/);
    expect(CFG).toMatch(/"src\/lib\/\*\*\/\*\.\{ts,tsx\}"/);
  });

  it("mengecualikan selector, guard describe, dan tipe generated", () => {
    expect(CFG).toContain('"src/lib/prep-active-selector.ts"');
    expect(CFG).toContain('"src/lib/prep-readonly-guard.ts"');
    expect(CFG).toContain('"src/routeTree.gen.ts"');
    expect(CFG).toContain('"src/integrations/supabase/types.ts"');
  });

  it("melarang `!x.sold_at` / `!!x.sold_at` sebagai predikat", () => {
    expect(CFG).toMatch(
      /UnaryExpression\[operator='!'\]\s*>\s*MemberExpression\[property\.name='sold_at'\]/,
    );
  });

  it("melarang perbandingan langsung ke null pada sold_at", () => {
    expect(CFG).toMatch(/BinaryExpression\[operator=\/\^\(===\|!==\|==\|!=\)\$\/\]/);
    expect(CFG).toMatch(/left\.property\.name='sold_at'/);
  });

  it("melarang `.is(\"sold_at\", null)` ad-hoc di query builder", () => {
    expect(CFG).toMatch(/callee\.property\.name='is'/);
    expect(CFG).toMatch(/arguments\.0\.value='sold_at'/);
  });
});