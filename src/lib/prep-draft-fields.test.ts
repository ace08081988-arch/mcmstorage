import { describe, it, expect, beforeEach } from "vitest";

// Lingkungan test bisa node murni; sediakan sessionStorage in-memory.
if (typeof (globalThis as { sessionStorage?: Storage }).sessionStorage === "undefined") {
  const map = new Map<string, string>();
  (globalThis as { sessionStorage?: Storage }).sessionStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size; },
  } as Storage;
}

import {
  loadDraftFields,
  saveDraftFields,
  clearDraftFields,
  draftFieldsKey,
} from "./prep-draft-fields";

describe("prep-draft-fields", () => {
  beforeEach(() => sessionStorage.clear());

  it("round-trips catatan, lokasi, gps, dan jumlah", () => {
    saveDraftFields("k1", {
      note: "cek",
      locUrl: "https://maps.google.com/?q=1,2",
      gps: { lat: 1, lng: 2, accuracy: 5 },
      quantities: { "0": "1.5" },
    });
    expect(loadDraftFields("k1")).toEqual({
      note: "cek",
      locUrl: "https://maps.google.com/?q=1,2",
      gps: { lat: 1, lng: 2, accuracy: 5 },
      quantities: { "0": "1.5" },
    });
  });

  it("draft kosong menghapus entri", () => {
    saveDraftFields("k1", { note: "x" });
    saveDraftFields("k1", { note: "", locUrl: "", gps: null, quantities: { "0": "" } });
    expect(sessionStorage.getItem(draftFieldsKey("k1"))).toBeNull();
  });

  it("terisolasi per kunci dan bisa dibersihkan", () => {
    saveDraftFields("a", { note: "a" });
    saveDraftFields("b", { note: "b" });
    clearDraftFields("a");
    expect(loadDraftFields("a")).toEqual({});
    expect(loadDraftFields("b").note).toBe("b");
  });

  it("mengabaikan payload rusak", () => {
    sessionStorage.setItem(draftFieldsKey("k1"), "{bukan json");
    expect(loadDraftFields("k1")).toEqual({});
    sessionStorage.setItem(draftFieldsKey("k2"), JSON.stringify({ note: 5, gps: { lat: "x" } }));
    expect(loadDraftFields("k2")).toEqual({});
  });
});
