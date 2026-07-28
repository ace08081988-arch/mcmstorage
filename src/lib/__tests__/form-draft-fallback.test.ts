// @vitest-environment happy-dom
/**
 * Verifikasi perilaku draft saat localStorage ditolak / kuota penuh.
 * Kontraknya: input TIDAK boleh hilang — jatuh ke memori halaman, dan
 * status yang dilaporkan harus jujur ("memory") supaya UI bisa memperingatkan.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFormDraft, writeFormDraft, clearFormDraft } from "@/lib/form-draft";

const KEY_BASE = "mcm:test:draft";
const realLs = window.localStorage;

function denyStorage(mode: "throw-set" | "throw-all") {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: () => {
        if (mode === "throw-all") throw new Error("SecurityError");
        return null;
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        if (mode === "throw-all") throw new Error("SecurityError");
      },
    },
  });
}

function restoreStorage() {
  Object.defineProperty(window, "localStorage", { configurable: true, value: realLs });
}

describe("form draft fallback", () => {
  beforeEach(() => {
    clearFormDraft(KEY_BASE, "u1");
  });
  afterEach(() => {
    restoreStorage();
    clearFormDraft(KEY_BASE, "u1");
  });

  it("menyimpan ke localStorage saat tersedia", () => {
    expect(writeFormDraft(KEY_BASE, "u1", { name: "Gula" })).toBe("ok");
    expect(readFormDraft<{ name: string }>(KEY_BASE, "u1")).toEqual({ name: "Gula" });
  });

  it("jatuh ke memori (status 'memory') saat setItem ditolak, input tetap kembali", () => {
    denyStorage("throw-set");
    expect(writeFormDraft(KEY_BASE, "u1", { name: "Beras" })).toBe("memory");
    expect(readFormDraft<{ name: string }>(KEY_BASE, "u1")).toEqual({ name: "Beras" });
  });

  it("tetap membaca memori walau getItem melempar error", () => {
    denyStorage("throw-all");
    writeFormDraft(KEY_BASE, "u1", { name: "Minyak" });
    expect(readFormDraft<{ name: string }>(KEY_BASE, "u1")).toEqual({ name: "Minyak" });
  });

  it("clear menghapus cadangan memori juga", () => {
    denyStorage("throw-set");
    writeFormDraft(KEY_BASE, "u1", { name: "Kopi" });
    clearFormDraft(KEY_BASE, "u1");
    expect(readFormDraft(KEY_BASE, "u1")).toBeNull();
  });

  it("draft antar user tidak tercampur di mode memori", () => {
    denyStorage("throw-set");
    writeFormDraft(KEY_BASE, "u1", { name: "A" });
    writeFormDraft(KEY_BASE, "u2", { name: "B" });
    expect(readFormDraft<{ name: string }>(KEY_BASE, "u1")).toEqual({ name: "A" });
    expect(readFormDraft<{ name: string }>(KEY_BASE, "u2")).toEqual({ name: "B" });
    clearFormDraft(KEY_BASE, "u2");
  });
});