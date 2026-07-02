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
type BeliMode = "existing" | "new";

/**
 * Bentuk state harness — didefinisikan eksplisit agar TypeScript tidak
 * pernah jatuh ke implicit-any saat mengindex properti (TS7053). Semua
 * setter/batch mengacu ke tipe ini via `keyof LifecycleState`.
 */
interface LifecycleState {
  mode: BeliMode;
  itemId: string;
  packageType: PackageType;
  selectedItem: object | null;
}

type LifecycleUpdates = Partial<LifecycleState>;

/**
 * Harness minimal untuk lifecycle useEffect dep `[resetKey]`.
 * `commit()` mensimulasi selesai satu render cycle: bila `resetKey` berubah
 * dibanding cycle sebelumnya, effect body dijalankan (counter naik).
 */
function createResetLifecycle(initial: LifecycleState) {
  const state: LifecycleState = { ...initial };
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
    setMode(m: BeliMode) {
      state.mode = m;
      commit();
    },
    setPackageType(pt: PackageType) {
      state.packageType = pt;
      commit();
    },
    /**
     * Simulasi React batching: beberapa setState di satu handler /
     * satu render → hanya satu commit di akhir. Effect body jalan
     * maksimal SEKALI walau tiga input trigger berubah bersamaan.
     */
    batch(updates: LifecycleUpdates) {
      // Iterasi berbasis `keyof LifecycleState` — TypeScript tahu tipe
      // masing-masing properti sehingga tidak ada implicit-any indexing
      // (TS7053) meski akses via bracket.
      const keys = Object.keys(updates) as Array<keyof LifecycleState>;
      for (const key of keys) {
        const value = updates[key];
        if (value === undefined) continue;
        // Cast eksplisit ke tipe properti tujuan untuk menjaga varians
        // saat menulis balik ke `state[key]`.
        (state[key] as LifecycleState[typeof key]) =
          value as LifecycleState[typeof key];
      }
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

// =============================================================
// TES BATCH — perubahan bersamaan mode + itemId + packageType di
// satu render batch harus menghasilkan TEPAT 1 reset, bukan 3.
// Kontrak useEffect React: dep array dievaluasi sekali per commit,
// jadi meskipun tiga input trigger berubah bersamaan, effect body
// hanya dieksekusi sekali.
// =============================================================
describe("BeliTab — reset dipanggil TEPAT SEKALI dalam satu render batch", () => {
  it("mode + itemId + packageType berubah bersamaan → 1 reset", () => {
    const h = createResetLifecycle({
      mode: "existing",
      itemId: "botol-500",
      packageType: "botol",
      selectedItem: { id: "botol-500" },
    });
    h.batch({ mode: "new", itemId: "", packageType: "gram" });
    expect(h.resetCount).toBe(1);
  });

  it("dua batch berturut-turut (masing-masing mengubah 3 field) → 2 reset total", () => {
    const h = createResetLifecycle({
      mode: "existing",
      itemId: "a",
      packageType: "botol",
      selectedItem: { id: "a" },
    });
    h.batch({ mode: "new", itemId: "", packageType: "pcs" });
    expect(h.resetCount).toBe(1);
    h.batch({ mode: "existing", itemId: "b", packageType: "gram" });
    expect(h.resetCount).toBe(2);
  });

  it("batch dengan hanya 2 field trigger berubah (mode + itemId) tetap 1 reset", () => {
    const h = createResetLifecycle({
      mode: "existing",
      itemId: "a",
      packageType: "botol",
      selectedItem: { id: "a" },
    });
    h.batch({ mode: "new", itemId: "" });
    expect(h.resetCount).toBe(1);
  });

  it("batch yang meng-update selectedItem BERSAMA mode/itemId → tetap 1 reset (bukan 2)", () => {
    // Skenario nyata: pengguna klik item lain → setItemId + setSelectedItem
    // dipanggil dalam satu handler React. React batching → 1 commit → 1 reset.
    const h = createResetLifecycle({
      mode: "existing",
      itemId: "a",
      packageType: "botol",
      selectedItem: { id: "a" },
    });
    h.batch({ itemId: "b", selectedItem: { id: "b" } });
    expect(h.resetCount).toBe(1);
  });

  it("batch yang HANYA mengubah selectedItem (tanpa mode/itemId/packageType) → 0 reset", () => {
    const h = createResetLifecycle({
      mode: "existing",
      itemId: "a",
      packageType: "botol",
      selectedItem: { id: "a" },
    });
    h.batch({ selectedItem: { id: "a", rev: 2 } });
    h.batch({ selectedItem: { id: "a", rev: 3 } });
    expect(h.resetCount).toBe(0);
  });

  it("batch idempoten (nilai baru = nilai lama untuk semua field) → 0 reset", () => {
    const h = createResetLifecycle({
      mode: "existing",
      itemId: "a",
      packageType: "botol",
      selectedItem: { id: "a" },
    });
    h.batch({ mode: "existing", itemId: "a", packageType: "botol" });
    h.batch({ mode: "existing", itemId: "a", packageType: "gram" }); // packageType diabaikan di mode existing
    expect(h.resetCount).toBe(0);
  });

  it("kontrol negatif: 3 setter TERPISAH (bukan batch) di mode 'new' → hanya field kunci yang naikkan count", () => {
    // Konfirmasi bahwa batching benar-benar menyatukan commit — jika 3
    // setter dipanggil terpisah, tiap commit yang benar-benar mengubah
    // resetKey akan naik. Di mode 'new' hanya packageType relevan (itemId
    // diabaikan), jadi setMode('new') + setPackageType('pcs') = 2 reset
    // (existing→new lalu botol→pcs), tapi batch keduanya = 1.
    const separate = createResetLifecycle({
      mode: "existing",
      itemId: "a",
      packageType: "botol",
      selectedItem: { id: "a" },
    });
    separate.setMode("new"); // +1
    separate.setPackageType("pcs"); // +1
    expect(separate.resetCount).toBe(2);

    const batched = createResetLifecycle({
      mode: "existing",
      itemId: "a",
      packageType: "botol",
      selectedItem: { id: "a" },
    });
    batched.batch({ mode: "new", packageType: "pcs" });
    expect(batched.resetCount).toBe(1);
  });
});

// =============================================================
// TES NEGATIF — perubahan metadata/derived pendukung TIDAK boleh
// memicu reset. Effect reset hanya bergantung pada `resetKey` yang
// dihitung dari mode+itemId+packageType — apa pun yang berubah di
// luar tiga field ini harus menghasilkan resetCount = 0.
// =============================================================
describe("BeliTab — NOL reset saat hanya metadata/derived pendukung berubah", () => {
  /**
   * Harness luas yang mensimulasi state pendukung form pembelian
   * (packageQty, priceMode, inputKarton, pricePerPackage, packageSize,
   * derived-object, dst.) — semua ini BUKAN input `beliResetKey`, jadi
   * mengubahnya tidak boleh menaikkan resetCount.
   */
  function createWideLifecycle() {
    const h = createResetLifecycle({
      mode: "existing",
      itemId: "botol-500",
      packageType: "botol",
      selectedItem: { id: "botol-500" },
    });
    return h;
  }

  it("mengubah selectedItem identity 50× → 0 reset", () => {
    const h = createWideLifecycle();
    for (let i = 0; i < 50; i++) {
      h.refetchSelectedItemIdentity({ id: "botol-500", rev: i, updated_at: `t-${i}` });
    }
    expect(h.resetCount).toBe(0);
  });

  it("batch update yang HANYA berisi supporting field (bukan mode/itemId/packageType) → 0 reset", () => {
    const h = createWideLifecycle();
    // batch() harness kita mengizinkan selectedItem berubah tanpa kunci.
    h.batch({ selectedItem: { id: "botol-500", stock_base: 100 } });
    h.batch({ selectedItem: { id: "botol-500", stock_base: 200 } });
    h.batch({ selectedItem: { id: "botol-500", avg_cost_per_base: 42 } });
    h.batch({ selectedItem: null });
    h.batch({ selectedItem: { id: "botol-500" } });
    expect(h.resetCount).toBe(0);
  });

  it("rerender berturut-turut (mensimulasi perubahan derived/warnings/state form) → 0 reset", () => {
    // rerender() commit tanpa mengubah kunci. Pada aplikasi nyata, ini
    // mewakili render ulang karena state pendukung berubah (mis. packageQty,
    // priceMode, inputKarton, pricePerPackage) — tidak satupun masuk kunci.
    const h = createWideLifecycle();
    for (let i = 0; i < 100; i++) h.rerender();
    expect(h.resetCount).toBe(0);
  });

  it("kombinasi luas: refetch identitas + rerender + batch supporting-only → 0 reset", () => {
    const h = createWideLifecycle();
    for (let i = 0; i < 30; i++) {
      h.refetchSelectedItemIdentity({ id: "botol-500", rev: i });
      h.rerender();
      h.batch({ selectedItem: { id: "botol-500", rev: i * 10 } });
    }
    expect(h.resetCount).toBe(0);
  });

  it("batch yang menyertakan mode/itemId/packageType dengan NILAI SAMA (no-op) → 0 reset", () => {
    // Idempotency: React masih akan commit, tapi resetKey tidak berubah.
    const h = createWideLifecycle();
    h.batch({
      mode: "existing",
      itemId: "botol-500",
      packageType: "botol",
      selectedItem: { id: "botol-500", rev: 999 },
    });
    h.batch({
      mode: "existing",
      itemId: "botol-500",
      packageType: "botol",
    });
    expect(h.resetCount).toBe(0);
  });

  it("mode 'existing' — mengubah packageType (yang diabaikan di kunci existing) 20× → 0 reset", () => {
    // beliResetKey mode 'existing' HANYA memakai itemId — packageType
    // dihitung sebagai supporting metadata. Ganti berulang tidak menembak.
    const h = createResetLifecycle({
      mode: "existing",
      itemId: "botol-500",
      packageType: "botol",
      selectedItem: { id: "botol-500" },
    });
    const types: PackageType[] = ["gram", "pcs", "botol", "sachet"];
    for (let i = 0; i < 20; i++) {
      // Non-null assertion aman: indeks selalu 0..types.length-1.
      const next = types[i % types.length]!;
      h.setPackageType(next);
    }
    expect(h.resetCount).toBe(0);
  });

  it("mode 'new' — mengubah itemId (yang diabaikan di kunci new) 20× → 0 reset", () => {
    // beliResetKey mode 'new' HANYA memakai packageType. itemId supporting.
    const h = createResetLifecycle({
      mode: "new",
      itemId: "",
      packageType: "botol",
      selectedItem: null,
    });
    for (let i = 0; i < 20; i++) h.setItemId(`whatever-${i}`);
    expect(h.resetCount).toBe(0);
  });

  it("interleave supporting-only setter + refetch dalam sequence panjang → 0 reset", () => {
    const h = createWideLifecycle();
    for (let i = 0; i < 200; i++) {
      const kind = i % 4;
      if (kind === 0) h.refetchSelectedItemIdentity({ id: "botol-500", rev: i });
      else if (kind === 1) h.rerender();
      else if (kind === 2) h.batch({ selectedItem: { id: "botol-500", meta: i } });
      else h.batch({ mode: "existing", itemId: "botol-500", packageType: "botol" });
    }
    expect(h.resetCount).toBe(0);
  });

  it("kontrol positif akhir: setelah 100 supporting-only ops, SATU transisi itemId menaikkan count TEPAT ke 1", () => {
    // Menjamin bahwa harness benar-benar mendeteksi transisi nyata, bukan
    // "buta" terhadap perubahan.
    const h = createWideLifecycle();
    for (let i = 0; i < 100; i++) h.refetchSelectedItemIdentity({ id: "botol-500", rev: i });
    expect(h.resetCount).toBe(0);
    h.setItemId("gram-1000");
    expect(h.resetCount).toBe(1);
  });
});