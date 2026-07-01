import { describe, it, expect, beforeAll } from "vitest";
import { ESLint } from "eslint";
import path from "path";

// Uji ESLint rule `no-restricted-syntax` di eslint.config.js untuk direktori
// src/components/chat: setiap pola ad-hoc mm:ss harus terdeteksi, dan
// allowlist AttachMenu.tsx tetap lolos.

let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({
    cwd: path.resolve(__dirname, "../.."),
    overrideConfigFile: path.resolve(__dirname, "../../eslint.config.js"),
    errorOnUnmatchedPattern: false,
  });
});

async function lint(filePath: string, code: string) {
  const results = await eslint.lintText(code, { filePath, warnIgnored: false });
  const msgs = results[0]?.messages ?? [];
  return msgs.filter((m) => m.ruleId === "no-restricted-syntax");
}

const CHAT_FILE = "src/components/chat/__probe__.tsx";
const ALLOWED_FILE = "src/components/chat/AttachMenu.tsx";
const OUTSIDE_FILE = "src/components/__probe__.tsx";

const MATH_FLOOR = `export const m = (s: number) => Math.floor(s / 60);\n`;
const MOD_60 = `export const r = (s: number) => s % 60;\n`;
const PAD_START = `export const p = (n: number) => String(n).padStart(2, "0");\n`;
const COMBINED = MATH_FLOOR + MOD_60 + PAD_START;
const CLEAN = `import { formatDurationMMSS } from "@/lib/format-duration";\nexport const label = (s: number) => formatDurationMMSS(s);\n`;

describe("ESLint chat duration rule", () => {
  it("mendeteksi Math.floor(x / 60) di src/components/chat", async () => {
    const errs = await lint(CHAT_FILE, MATH_FLOOR);
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs.map((e) => e.message).join("\n")).toMatch(/formatDurationMMSS/);
  });

  it("mendeteksi ekspresi `% 60` di src/components/chat", async () => {
    const errs = await lint(CHAT_FILE, MOD_60);
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs.some((e) => /Aritmetika detik/.test(e.message))).toBe(true);
  });

  it("mendeteksi padStart(2, \"0\") di src/components/chat", async () => {
    const errs = await lint(CHAT_FILE, PAD_START);
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs.some((e) => /padStart/.test(e.message))).toBe(true);
  });

  it("mendeteksi ketiga pola bersamaan dalam satu file chat", async () => {
    const errs = await lint(CHAT_FILE, COMBINED);
    expect(errs.length).toBeGreaterThanOrEqual(3);
  });

  it("tidak menandai file yang menggunakan formatDurationMMSS", async () => {
    const errs = await lint(CHAT_FILE, CLEAN);
    expect(errs).toEqual([]);
  });

  it("membiarkan AttachMenu.tsx lolos (allowlist)", async () => {
    const errs = await lint(ALLOWED_FILE, COMBINED);
    expect(errs).toEqual([]);
  });

  it("tidak berlaku di luar src/components/chat", async () => {
    const errs = await lint(OUTSIDE_FILE, COMBINED);
    expect(errs).toEqual([]);
  });

  it("tidak berlaku di file test dalam src/components/chat", async () => {
    const errs = await lint("src/components/chat/foo.test.ts", COMBINED);
    expect(errs).toEqual([]);
  });
});
