import { describe, it, expect } from "vitest";
import {
  pickWinnerStep,
  formatPressAuditTrace,
  type PressAuditTrace,
  type PressAuditTraceStep,
} from "./press-audit";

/** Bangun step palsu — tanpa DOM, hanya struktur data. */
function s(
  step: number,
  name: string,
  outcome: "pass" | "block",
  reason: string,
  extra: Partial<PressAuditTraceStep> = {},
): PressAuditTraceStep {
  return { step, name, outcome, reason, ...extra };
}

/** Bangun trace palsu. */
function t(
  rule: string,
  code: string,
  allowed: boolean,
  steps: PressAuditTraceStep[],
): PressAuditTrace {
  return { rule, code, allowed, steps };
}

// Objek Element palsu — pickWinnerStep hanya membaca ada/tidaknya `hostEl`,
// jadi kita bisa memakai objek biasa lewat cast tanpa jsdom.
const fakeEl = (tag: string): Element =>
  ({ tagName: tag.toUpperCase() } as unknown as Element);

describe("pickWinnerStep", () => {
  it("mengembalikan null untuk trace kosong", () => {
    expect(pickWinnerStep(t("r", "C", true, []))).toBeNull();
  });

  it("kasus ALLOW: memilih langkah pass terakhir yang punya hostEl", () => {
    const scope = s(2, "scope.allow", "pass", "ok", {
      hostTag: "section",
      hostEl: fakeEl("section"),
    });
    const attrAllow = s(7, "attr:-allow", "pass", "match", {
      hostTag: "div",
      hostEl: fakeEl("div"),
      tokens: ["PA004"],
    });
    const trace = t("destructive-menuitem", "PA004", true, [
      s(1, "scope.deny", "pass", "no match"),
      scope,
      s(3, "attr:audit", "pass", "no off"),
      s(4, "global.allowRules", "pass", "empty"),
      s(5, "global.denyRules", "pass", "empty"),
      s(6, "attr:-skip/-deny", "pass", "empty"),
      attrAllow,
    ]);
    const winner = pickWinnerStep(trace);
    expect(winner).toBe(attrAllow);
    expect(winner?.hostTag).toBe("div");
    expect(winner?.outcome).toBe("pass");
  });

  it("kasus ALLOW tanpa hostEl di step manapun ⇒ null", () => {
    const trace = t("r", "PA001", true, [
      s(1, "scope.deny", "pass", "no match"),
      s(4, "global.allowRules", "pass", "empty"),
    ]);
    expect(pickWinnerStep(trace)).toBeNull();
  });

  it("kasus DENY: memilih langkah BLOCK meskipun ada pass sebelumnya dengan hostEl", () => {
    const passWithHost = s(2, "scope.allow", "pass", "ok", {
      hostTag: "section",
      hostEl: fakeEl("section"),
    });
    const denyStep = s(6, "attr:-skip/-deny", "block", "union deny", {
      hostTag: "article",
      hostEl: fakeEl("article"),
      tokens: ["PA004"],
    });
    const trace = t("destructive-menuitem", "PA004", false, [
      s(1, "scope.deny", "pass", "no match"),
      passWithHost,
      s(3, "attr:audit", "pass", "no off"),
      s(4, "global.allowRules", "pass", "empty"),
      s(5, "global.denyRules", "pass", "empty"),
      denyStep,
    ]);
    const winner = pickWinnerStep(trace);
    expect(winner).toBe(denyStep);
    expect(winner?.outcome).toBe("block");
    expect(winner?.hostTag).toBe("article");
  });

  it("kasus DENY: langkah block pertama menang walau ada block lain kemudian", () => {
    const firstBlock = s(3, 'attr:audit="off"', "block", "off wins", {
      hostTag: "div",
      hostEl: fakeEl("div"),
    });
    const laterBlock = s(6, "attr:-skip/-deny", "block", "never reached", {
      hostTag: "span",
      hostEl: fakeEl("span"),
    });
    const trace = t("r", "PA003", false, [
      s(1, "scope.deny", "pass", "no match"),
      firstBlock,
      laterBlock,
    ]);
    expect(pickWinnerStep(trace)).toBe(firstBlock);
  });
});

describe("formatPressAuditTrace", () => {
  it("menampilkan ikon ✓/✗ konsisten dengan outcome", () => {
    const trace = t("r", "PA004", false, [
      s(1, "scope.deny", "pass", "aman"),
      s(6, "attr:-skip/-deny", "block", "diblok"),
    ]);
    const lines = formatPressAuditTrace(trace);
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith("✓")).toBe(true);
    expect(lines[1].startsWith("✗")).toBe(true);
  });

  it("menyertakan @hostTag dan tokens ketika ada", () => {
    const trace = t("destructive-menuitem", "PA004", true, [
      s(7, "attr:-allow", "pass", "match", {
        hostTag: "div",
        tokens: ["PA004", "PA003"],
      }),
    ]);
    const [line] = formatPressAuditTrace(trace);
    expect(line).toContain("@div");
    expect(line).toContain("tokens=[PA004,PA003]");
    expect(line).toContain("(7)");
    expect(line).toContain("attr:-allow");
  });

  it("menghilangkan segmen @host/tokens saat tidak tersedia", () => {
    const trace = t("r", "PA001", true, [
      s(1, "scope.deny", "pass", "kosong"),
    ]);
    const [line] = formatPressAuditTrace(trace);
    expect(line).not.toContain("@");
    expect(line).not.toContain("tokens=");
  });

  it("verdict akhir konsisten allow vs deny dengan pickWinnerStep", () => {
    const allowTrace = t("r", "PA004", true, [
      s(7, "attr:-allow", "pass", "ok", {
        hostTag: "div",
        hostEl: fakeEl("div"),
      }),
    ]);
    const denyTrace = t("r", "PA004", false, [
      s(1, "scope.deny", "pass", "ok"),
      s(6, "attr:-skip/-deny", "block", "deny wins", {
        hostTag: "section",
        hostEl: fakeEl("section"),
      }),
    ]);
    expect(allowTrace.allowed).toBe(true);
    expect(pickWinnerStep(allowTrace)?.outcome).toBe("pass");
    expect(denyTrace.allowed).toBe(false);
    expect(pickWinnerStep(denyTrace)?.outcome).toBe("block");
    // format tetap merefleksikan outcome per baris
    expect(formatPressAuditTrace(allowTrace).every((l) => l.startsWith("✓"))).toBe(true);
    expect(formatPressAuditTrace(denyTrace).some((l) => l.startsWith("✗"))).toBe(true);
  });
});