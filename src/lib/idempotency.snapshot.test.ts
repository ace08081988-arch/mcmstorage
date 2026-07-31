import { describe, it, expect, beforeEach } from "vitest";

// Shim minimal `window.localStorage` (Map-backed) untuk lingkungan Node.
// Idempotency store hanya butuh getItem/setItem/removeItem.
if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  (globalThis as unknown as { window: unknown }).window = {
    localStorage,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  };
}
import {
  buildSendKey,
  getOrCreateSendSnapshot,
  getSendSnapshot,
  clearSendSnapshot,
  payloadFingerprint,
} from "./idempotency";

beforeEach(() => {
  window.localStorage.clear();
});

describe("send snapshot — output idempotency for repeated WA sends", () => {
  it("pengiriman kedua mengembalikan snapshot yang persis sama walau input upstream berubah", async () => {
    const key = buildSendKey({ channel: "wa", ids: ["b", "a", "c"] });

    // Kali pertama: bangun dari state awal.
    const firstText = "urutan: a, b, c";
    const first = await getOrCreateSendSnapshot(key, async () => ({
      fingerprint: payloadFingerprint({ text: firstText }),
      orderedIds: ["a", "b", "c"],
      text: firstText,
      locationUrl: "https://maps/first",
      slotFileNames: ["a-1.jpg", "b-1.jpg", "c-1.jpg"],
      slotPaths: ["p/a", "p/b", "p/c"],
      expectedCount: 3,
    }));

    // Kali kedua: state berubah (urutan / foto tambahan / teks berbeda) —
    // pemanggil build baru TIDAK boleh dieksekusi dan hasil harus identik
    // dengan kali pertama.
    let buildCalled = 0;
    const second = await getOrCreateSendSnapshot(key, async () => {
      buildCalled++;
      return {
        fingerprint: "berbeda",
        orderedIds: ["c", "a", "b", "d"],
        text: "urutan berubah",
        locationUrl: "https://maps/second",
        slotFileNames: ["c-1.jpg", "a-1.jpg", "b-1.jpg", "d-1.jpg"],
        slotPaths: ["p/c", "p/a", "p/b", "p/d"],
        expectedCount: 4,
      };
    });

    expect(buildCalled).toBe(0);
    expect(second.orderedIds).toEqual(first.orderedIds);
    expect(second.text).toBe(first.text);
    expect(second.slotPaths).toEqual(first.slotPaths);
    expect(second.slotFileNames).toEqual(first.slotFileNames);
    expect(second.locationUrl).toBe(first.locationUrl);
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it("banyak pengiriman berturut-turut tetap deterministik (5×)", async () => {
    const key = buildSendKey({ channel: "wa", ids: ["x", "y"] });
    const first = await getOrCreateSendSnapshot(key, async () => ({
      fingerprint: "fp1",
      orderedIds: ["x", "y"],
      text: "T",
      locationUrl: null,
      slotFileNames: ["x-1.jpg", "y-1.jpg"],
      slotPaths: ["p/x", "p/y"],
      expectedCount: 2,
    }));
    for (let i = 0; i < 5; i++) {
      const s = await getOrCreateSendSnapshot(key, async () => {
        throw new Error("must not rebuild");
      });
      expect(s.orderedIds).toEqual(first.orderedIds);
      expect(s.slotPaths).toEqual(first.slotPaths);
      expect(s.text).toBe(first.text);
      expect(s.fingerprint).toBe(first.fingerprint);
    }
  });

  it("clearSendSnapshot menghapus record dan memungkinkan build baru", async () => {
    const key = buildSendKey({ channel: "wa", ids: ["z"] });
    await getOrCreateSendSnapshot(key, async () => ({
      fingerprint: "fp1",
      orderedIds: ["z"],
      text: "one",
      locationUrl: null,
      slotFileNames: ["z-1.jpg"],
      slotPaths: ["p/z"],
      expectedCount: 1,
    }));
    clearSendSnapshot(key);
    expect(getSendSnapshot(key)).toBeNull();
    const rebuilt = await getOrCreateSendSnapshot(key, async () => ({
      fingerprint: "fp2",
      orderedIds: ["z"],
      text: "two",
      locationUrl: null,
      slotFileNames: ["z-1.jpg"],
      slotPaths: ["p/z"],
      expectedCount: 1,
    }));
    expect(rebuilt.text).toBe("two");
    expect(rebuilt.fingerprint).toBe("fp2");
  });
});