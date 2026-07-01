import { describe, it, expect, beforeAll } from "vitest";
import { ESLint } from "eslint";
import path from "path";
import { readFileSync } from "node:fs";

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
    expect(errs.some((e) => /%\s*60/.test(e.message) && /formatDurationMMSS/.test(e.message))).toBe(true);
  });

  it("mendeteksi padStart(2, \"0\") di src/components/chat", async () => {
    const errs = await lint(CHAT_FILE, PAD_START);
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs.some((e) => /padStart/.test(e.message))).toBe(true);
    expect(errs.some((e) => /codemod:mmss/.test(e.message))).toBe(true);
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

  it("allowlist dibaca dari eslint.mmss-allowlist.json (config-driven)", () => {
    const raw = JSON.parse(
      readFileSync(path.resolve(__dirname, "../../eslint.mmss-allowlist.json"), "utf8"),
    );
    expect(Array.isArray(raw.files)).toBe(true);
    // Setiap entri wajib menyertakan `reason` yang informatif (>= 20 char)
    // dan `path` di bawah scope rule.
    for (const entry of raw.files) {
      expect(entry.path.startsWith("src/components/chat/")).toBe(true);
      expect(typeof entry.reason).toBe("string");
      expect(entry.reason.trim().length).toBeGreaterThanOrEqual(20);
    }
    // AttachMenu.tsx tetap ada di allowlist konfigurasi.
    expect(raw.files.some((e: { path: string }) => e.path === "src/components/chat/AttachMenu.tsx")).toBe(true);
  });

  it("inline `eslint-disable-next-line` dengan justifikasi mmss-allow diizinkan", async () => {
    const code =
      `// eslint-disable-next-line no-restricted-syntax -- mmss-allow: elapsed upload, bukan durasi media\n` +
      `export const m = (s: number) => Math.floor(s / 60);\n`;
    const errs = await lint(CHAT_FILE, code);
    expect(errs).toEqual([]);
  });
});

describe("mmss allowlist loader", () => {
  it("menolak entry tanpa reason (schema check)", () => {
    const raw = JSON.parse(
      readFileSync(path.resolve(__dirname, "../../eslint.mmss-allowlist.json"), "utf8"),
    );
    for (const entry of raw.files) {
      // Kontrak: reason kosong / terlalu pendek akan gagal validasi di
      // eslint.config.js saat startup.
      expect(entry.reason && entry.reason.trim().length >= 20).toBe(true);
    }
  });
});
