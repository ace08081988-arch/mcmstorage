import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanupSendPrepLinkDrafts } from "./cleanup-send-prep-link-drafts";
import { scopedKey } from "./user-scoped-storage";

/**
 * Fake localStorage yang cukup untuk unit test:
 * - iterasi via `length` + `key(i)` (dipakai cleanup util)
 * - throw pada `removeItem` untuk simulasi quota / private mode
 */
function makeLS(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  const throwOn = new Set<string>();
  const api = {
    get length() {
      return map.size;
    },
    key(i: number) {
      return Array.from(map.keys())[i] ?? null;
    },
    getItem(k: string) {
      return map.has(k) ? (map.get(k) as string) : null;
    },
    setItem(k: string, v: string) {
      map.set(k, v);
    },
    removeItem(k: string) {
      if (throwOn.has(k)) throw new Error("blocked");
      map.delete(k);
    },
    clear() {
      map.clear();
    },
    _map: map,
    _throwOn: throwOn,
  };
  return api;
}

const PREFIX = "mcm:sendPrepLink:workerName:";

beforeEach(() => {
  // @ts-expect-error jsdom-less shim
  globalThis.window = { localStorage: makeLS() };
});
afterEach(() => {
  // @ts-expect-error cleanup
  delete globalThis.window;
  vi.restoreAllMocks();
});

function ls() {
  return (globalThis as unknown as { window: { localStorage: ReturnType<typeof makeLS> } })
    .window.localStorage;
}

describe("cleanupSendPrepLinkDrafts", () => {
  it("menghapus semua key dengan prefix draft, termasuk varian scoped per-user", () => {
    const s = ls();
    // draft legacy (tanpa scope user)
    s.setItem(`${PREFIX}title-1`, "Andi");
    s.setItem(`${PREFIX}title-2`, "Budi");
    // draft scoped per-user (format produksi baru)
    s.setItem(scopedKey("mcm:sendPrepLink:workerName", "user-a", "title-1"), "Andi");
    s.setItem(scopedKey("mcm:sendPrepLink:workerName", "user-b", "title-2"), "Budi");
    s.setItem(scopedKey("mcm:sendPrepLink:workerName", null, "title-3"), "Anon");

    const removed = cleanupSendPrepLinkDrafts();

    expect(removed).toBe(5);
    for (const k of Array.from(s._map.keys())) {
      expect(k.startsWith(PREFIX)).toBe(false);
    }
  });

  it("tidak menyentuh key yang tidak diawali prefix (auth token, cache lain, dsb.)", () => {
    const s = ls();
    const untouched: Record<string, string> = {
      "sb-project-auth-token": '{"user":{"id":"u1"}}',
      "mcm:gudang:cache": "1",
      "mcm:sendPrepLink:other:title-1": "keep", // prefix mirip tapi bukan workerName
      "mcm:sendPrepLinkWorkerName:title-1": "keep", // tanpa `:` pemisah → bukan target
      random: "x",
    };
    for (const [k, v] of Object.entries(untouched)) s.setItem(k, v);
    s.setItem(`${PREFIX}title-1`, "delete-me");
    s.setItem(scopedKey("mcm:sendPrepLink:workerName", "u1", "title-2"), "delete-me");

    const removed = cleanupSendPrepLinkDrafts();

    expect(removed).toBe(2);
    for (const [k, v] of Object.entries(untouched)) {
      expect(s.getItem(k)).toBe(v);
    }
    expect(s.getItem(`${PREFIX}title-1`)).toBeNull();
  });

  it("no-op tanpa error saat window tidak tersedia (SSR)", () => {
    // @ts-expect-error strip window
    delete globalThis.window;
    expect(() => cleanupSendPrepLinkDrafts()).not.toThrow();
    expect(cleanupSendPrepLinkDrafts()).toBe(0);
  });

  it("robust: bila removeItem gagal pada satu key, key lain tetap terhapus", () => {
    const s = ls();
    s.setItem(`${PREFIX}title-1`, "a");
    s.setItem(`${PREFIX}title-2`, "b");
    s.setItem(`${PREFIX}title-3`, "c");
    s._throwOn.add(`${PREFIX}title-2`);

    const removed = cleanupSendPrepLinkDrafts();

    expect(removed).toBe(2);
    expect(s.getItem(`${PREFIX}title-1`)).toBeNull();
    expect(s.getItem(`${PREFIX}title-3`)).toBeNull();
    expect(s.getItem(`${PREFIX}title-2`)).toBe("b"); // gagal dihapus, tetap ada
  });

  it("kembali 0 saat tidak ada draft yang cocok", () => {
    const s = ls();
    s.setItem("mcm:other", "x");
    expect(cleanupSendPrepLinkDrafts()).toBe(0);
    expect(s.getItem("mcm:other")).toBe("x");
  });
});

/**
 * Tear-down dialog: saat `SendPrepLinkDialog` di-unmount / ditutup, ia
 * menghapus PERSIS satu scoped key `mcm:sendPrepLink:workerName:u:<uid>:<titleId>`
 * milik title aktif — bukan seluruh prefix. Test ini memverifikasi kontrak
 * itu di level util `scopedKey` + `removeItem`, tanpa perlu mount komponen.
 */
describe("tear-down dialog: hapus scoped key aktif saja", () => {
  it("hanya menghapus draft title aktif untuk user aktif; user/title lain tidak tersentuh", () => {
    const s = ls();
    const base = "mcm:sendPrepLink:workerName";
    const activeUser = "user-a";
    const activeTitle = "title-1";

    const activeKey = scopedKey(base, activeUser, activeTitle);
    const otherTitle = scopedKey(base, activeUser, "title-2");
    const otherUser = scopedKey(base, "user-b", activeTitle);
    const anon = scopedKey(base, null, activeTitle);
    const legacy = `${PREFIX}${activeTitle}`; // pre-scope legacy

    s.setItem(activeKey, "Andi");
    s.setItem(otherTitle, "Budi");
    s.setItem(otherUser, "Cici");
    s.setItem(anon, "Anon");
    s.setItem(legacy, "Legacy");

    // simulasi tear-down: dialog membangun key persis seperti di produksi
    // dan memanggil removeItem sekali.
    const teardownKey = scopedKey(base, activeUser, activeTitle);
    s.removeItem(teardownKey);

    expect(teardownKey).toBe(activeKey);
    expect(s.getItem(activeKey)).toBeNull();
    expect(s.getItem(otherTitle)).toBe("Budi");
    expect(s.getItem(otherUser)).toBe("Cici");
    expect(s.getItem(anon)).toBe("Anon");
    expect(s.getItem(legacy)).toBe("Legacy");
  });

  it("scopedKey konsisten: input sama → output sama (kunci tear-down bisa direkonstruksi)", () => {
    const base = "mcm:sendPrepLink:workerName";
    expect(scopedKey(base, "u1", "t1")).toBe(scopedKey(base, "u1", "t1"));
    expect(scopedKey(base, "u1", "t1")).not.toBe(scopedKey(base, "u2", "t1"));
    expect(scopedKey(base, "u1", "t1")).not.toBe(scopedKey(base, "u1", "t2"));
    expect(scopedKey(base, null, "t1")).toBe(scopedKey(base, "", "t1")); // anon
  });
});