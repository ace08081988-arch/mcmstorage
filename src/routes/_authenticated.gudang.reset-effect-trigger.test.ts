import { describe, it, expect } from "vitest";
import { beliResetKey } from "@/lib/beli-reset-key";

// Regression: effect reset di BeliTab (`_authenticated.gudang.tsx`) sekarang
// hanya bergantung pada `resetKey` (mode/itemId/packageType) — bukan pada
// identitas objek `selectedItem`. Test ini mensimulasi lifecycle useEffect
// dengan dep `[resetKey]` dan memastikan:
//   1. Reset JALAN saat mode / itemId / packageType berubah.
//   2. Reset TIDAK jalan saat `selectedItem` hanya berganti identitas objek
//      (mis. refetch dari server memberikan referensi baru untuk item yang
//      sama), karena resetKey tetap sama.

type PackageType = "gram" | "pcs" | "botol" | "sachet";

/**
 * Harness minimal untuk lifecycle useEffect dep `[resetKey]`.
 * `commit()` mensimulasi selesai satu render cycle: bila `resetKey` berubah
 * dibanding cycle sebelumnya, effect body dijalankan (counter naik).
 */
function createResetLifecycle(initial: {
  mode: "existing" | "new";
  itemId: string;
  packageType: PackageType;
  selectedItem: object | null;
}) {
  const state = { ...initial };
  let lastResetKey = beliResetKey({
    mode: state.mode,
    itemId: state.itemId,
    packageType: state.packageType,
  });
  let resetCount = 0;
  // Mount effect: pada React strict lifecycle, effect jalan sekali di mount.
  // Kita tidak menghitung mount agar test fokus ke transisi.
  function commit() {
    const key = beliResetKey({
      mode: state.mode,
      itemId: state.itemId,
      packageType: state.packageType,
    });
    if (key !== lastResetKey) {
      lastResetKey = key;
      resetCount += 1;
    }
  }
  return {
    get resetCount() {
      return resetCount;
    },
    setItemId(id: string) {
      state.itemId = id;
      commit();
    },
    setMode(m: "existing" | "new") {
      state.mode = m;
      commit();
    },
    setPackageType(pt: PackageType) {
      state.packageType = pt;
      commit();
    },
    /** Simulasi refetch: `selectedItem` dapat referensi objek baru tapi
     *  mode/itemId/packageType TIDAK berubah. */
    refetchSelectedItemIdentity(newRef: object) {
      state.selectedItem = newRef;
      commit();
    },
    /** Simulasi render biasa tanpa perubahan input trigger. */
    rerender() {
      commit();
    },
  };
}

describe("BeliTab — effect reset trigger", () => {
  it("tidak jalan pada render ulang tanpa perubahan mode/itemId/packageType", () => {
    const h = createResetLifecycle({
      mode: "existing",
      itemId: "botol-500",
      packageType: "botol",
      selectedItem: { id: "botol-500" },
    });
    h.rerender();
    h.rerender();
    h.rerender();
    expect(h.resetCount).toBe(0);
  });

  it("TIDAK jalan saat selectedItem hanya berganti identitas objek (refetch)", () => {
    const h = createResetLifecycle({
      mode: "existing",
      itemId: "botol-500",
      packageType: "botol",
      selectedItem: { id: "botol-500" },
    });
    // Simulasi beberapa refetch berturut-turut — tiap kali referensi baru,
    // tapi itemId/mode/packageType SAMA. Reset TIDAK boleh jalan.
    h.refetchSelectedItemIdentity({ id: "botol-500" });
    h.refetchSelectedItemIdentity({ id: "botol-500" });
    h.refetchSelectedItemIdentity({ id: "botol-500" });
    expect(h.resetCount).toBe(0);
  });

  it("jalan sekali saat itemId berubah", () => {
    const h = createResetLifecycle({
      mode: "existing",
      itemId: "botol-500",
      packageType: "botol",
      selectedItem: { id: "botol-500" },
    });
    h.setItemId("gram-1000");
    expect(h.resetCount).toBe(1);
    // Refetch identitas setelah transisi juga tidak boleh menambah.
    h.refetchSelectedItemIdentity({ id: "gram-1000" });
    expect(h.resetCount).toBe(1);
  });

  it("jalan saat mode berubah", () => {
    const h = createResetLifecycle({
      mode: "existing",
      itemId: "botol-500",
      packageType: "botol",
      selectedItem: { id: "botol-500" },
    });
    h.setMode("new");
    expect(h.resetCount).toBe(1);
  });

  it("jalan saat packageType berubah (relevan untuk mode 'new')", () => {
    const h = createResetLifecycle({
      mode: "new",
      itemId: "",
      packageType: "botol",
      selectedItem: null,
    });
    h.setPackageType("pcs");
    expect(h.resetCount).toBe(1);
    h.setPackageType("gram");
    expect(h.resetCount).toBe(2);
  });

  it("dalam mode 'existing', mengganti packageType saja TIDAK memicu reset (kunci ikut itemId)", () => {
    // beliResetKey('existing', ...) hanya melihat itemId — packageType diabaikan.
    const h = createResetLifecycle({
      mode: "existing",
      itemId: "botol-500",
      packageType: "botol",
      selectedItem: { id: "botol-500" },
    });
    h.setPackageType("gram");
    h.setPackageType("pcs");
    expect(h.resetCount).toBe(0);
  });

  it("rangkaian transisi yang diselingi refetch identitas hanya menghitung transisi nyata", () => {
    const h = createResetLifecycle({
      mode: "existing",
      itemId: "botol-500",
      packageType: "botol",
      selectedItem: { id: "botol-500" },
    });
    h.refetchSelectedItemIdentity({ id: "botol-500" }); // 0
    h.setItemId("gram-1000"); // 1
    h.refetchSelectedItemIdentity({ id: "gram-1000" }); // 1
    h.refetchSelectedItemIdentity({ id: "gram-1000" }); // 1
    h.setItemId("pcs-1"); // 2
    h.rerender(); // 2
    h.setMode("new"); // 3
    h.setPackageType("gram"); // 4
    h.refetchSelectedItemIdentity({ id: "any" }); // 4 (mode 'new', selectedItem tak dipakai kunci)
    expect(h.resetCount).toBe(4);
  });
});

// =============================================================
// TES TAMBAHAN — assertion jumlah eksak (exact-count) untuk reset.
// Tujuan: mengunci kontrak "tepat sekali per perubahan efektif" dan
// "nol kali untuk perubahan identitas selectedItem".
// =============================================================
describe("BeliTab — reset dipanggil TEPAT SEKALI per perubahan efektif", () => {
  it("setItemId ke nilai yang SAMA (idempoten) tidak menaikkan count", () => {
    const h = createResetLifecycle({
      mode: "existing",
      itemId: "botol-500",
      packageType: "botol",
      selectedItem: { id: "botol-500" },
    });
    h.setItemId("botol-500");
    h.setItemId("botol-500");
    h.setItemId("botol-500");
    expect(h.resetCount).toBe(0);
  });

  it("setiap perubahan itemId berturut-turut menaikkan count TEPAT satu", () => {
    const h = createResetLifecycle({
      mode: "existing",
      itemId: "a",
      packageType: "botol",
      selectedItem: { id: "a" },
    });
    const ids = ["b", "c", "d", "e", "f"];
    ids.forEach((id, i) => {
      h.setItemId(id);
      expect(h.resetCount).toBe(i + 1);
    });
    expect(h.resetCount).toBe(ids.length);
  });

  it("burst 20 refetch identitas antar dua transisi nyata tetap = 2 reset", () => {
    const h = createResetLifecycle({
      mode: "existing",
      itemId: "a",
      packageType: "botol",
      selectedItem: { id: "a" },
    });
    for (let i = 0; i < 20; i++) h.refetchSelectedItemIdentity({ id: "a", rev: i });
    expect(h.resetCount).toBe(0);
    h.setItemId("b"); // +1
    for (let i = 0; i < 20; i++) h.refetchSelectedItemIdentity({ id: "b", rev: i });
    expect(h.resetCount).toBe(1);
    h.setItemId("c"); // +1
    for (let i = 0; i < 20; i++) h.refetchSelectedItemIdentity({ id: "c", rev: i });
    expect(h.resetCount).toBe(2);
  });

  it("toggle mode existing↔new bolak-balik menaikkan count setiap kali (tepat 1 per toggle)", () => {
    const h = createResetLifecycle({
      mode: "existing",
      itemId: "a",
      packageType: "botol",
      selectedItem: { id: "a" },
    });
    h.setMode("new");
    expect(h.resetCount).toBe(1);
    h.setMode("existing");
    expect(h.resetCount).toBe(2);
    h.setMode("new");
    expect(h.resetCount).toBe(3);
    // Refetch di antara toggle tidak menambah.
    h.refetchSelectedItemIdentity({ id: "a" });
    h.refetchSelectedItemIdentity({ id: "a" });
    expect(h.resetCount).toBe(3);
  });

  it("mode 'new' — packageType siklus botol→pcs→gram→botol menghasilkan tepat 3 reset", () => {
    const h = createResetLifecycle({
      mode: "new",
      itemId: "",
      packageType: "botol",
      selectedItem: null,
    });
    h.setPackageType("pcs"); // 1
    h.setPackageType("gram"); // 2
    h.setPackageType("botol"); // 3
    expect(h.resetCount).toBe(3);
    // Set ke nilai yang sama = idempoten.
    h.setPackageType("botol");
    h.setPackageType("botol");
    expect(h.resetCount).toBe(3);
  });

  it("mode 'existing' — 100 refetch identitas berturut-turut menghasilkan 0 reset", () => {
    const h = createResetLifecycle({
      mode: "existing",
      itemId: "botol-500",
      packageType: "botol",
      selectedItem: { id: "botol-500" },
    });
    for (let i = 0; i < 100; i++) {
      h.refetchSelectedItemIdentity({ id: "botol-500", rev: i, name: `n-${i}` });
    }
    expect(h.resetCount).toBe(0);
  });

  it("kombinasi: N transisi itemId + M refetch acak → count = N", () => {
    const h = createResetLifecycle({
      mode: "existing",
      itemId: "start",
      packageType: "botol",
      selectedItem: { id: "start" },
    });
    const transitions = ["a", "b", "c", "d", "e", "f", "g"];
    let expected = 0;
    let currentId = "start";
    for (const id of transitions) {
      // 3 refetch identitas sebelum transisi berikutnya.
      for (let i = 0; i < 3; i++) h.refetchSelectedItemIdentity({ id: currentId, rev: i });
      h.setItemId(id);
      currentId = id;
      expected += 1;
      expect(h.resetCount).toBe(expected);
    }
    // Refetch tambahan di akhir tidak boleh menambah.
    for (let i = 0; i < 10; i++) h.refetchSelectedItemIdentity({ id: "g", rev: i });
    expect(h.resetCount).toBe(transitions.length);
  });
});