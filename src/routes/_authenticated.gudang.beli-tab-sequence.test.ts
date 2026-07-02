import { describe, it, expect, beforeEach } from "vitest";
import { computeBeliDerived } from "@/lib/beli-derived";
import { computeBeliWarnings } from "@/lib/beli-warnings";
import { beliResetKey } from "@/lib/beli-reset-key";

// Simulasi state BeliTab (`_authenticated.gudang.tsx`) yang menjalankan
// pipeline useMemo/useEffect yang sama seperti komponen aslinya, memakai
// fungsi produksi (`computeBeliDerived`, `computeBeliWarnings`,
// `beliResetKey`). Tujuan test ini: mengunci perilaku ringkasan real-time
// saat pengguna mengganti itemId / packageType secara berurutan agar tidak
// ada state karton/priceMode/harga yang bocor dari pilihan sebelumnya.

type PackageType = "gram" | "pcs" | "botol" | "sachet";

type WItem = {
  id: string;
  name: string;
  package_type: PackageType;
  package_size: number;
  base_unit: "g" | "pcs";
  stock_base: number;
  avg_cost_per_base: number;
};

const ITEMS: WItem[] = [
  {
    id: "botol-500",
    name: "Sirup Botol 500ml",
    package_type: "botol",
    package_size: 500,
    base_unit: "g",
    stock_base: 10_000,
    avg_cost_per_base: 20,
  },
  {
    id: "gram-1000",
    name: "Gula Curah",
    package_type: "gram",
    package_size: 1000,
    base_unit: "g",
    stock_base: 5_000,
    avg_cost_per_base: 15,
  },
  {
    id: "pcs-1",
    name: "Sikat 1 pcs",
    package_type: "pcs",
    package_size: 1,
    base_unit: "pcs",
    stock_base: 20,
    avg_cost_per_base: 3_000,
  },
];

/**
 * Harness yang mereplikasi state internal BeliTab. Setiap setter mensimulasi
 * satu render cycle: memperbarui state → recompute selectedItem / resetKey →
 * menjalankan reset effect bila resetKey berubah → recompute derived +
 * warnings. Nilai final yang dibaca test SELALU snapshot terakhir (analog
 * ke ringkasan real-time yang dilihat user setelah interaksi tersebut).
 */
function createBeliTabHarness() {
  // Simpan items di dalam harness supaya kita bisa mensimulasi refetch —
  // mengganti identitas object item tanpa mengubah kontennya (analog ke
  // hasil re-query supabase yang mengembalikan row baru dengan nilai sama).
  let items: WItem[] = ITEMS.map((it) => ({ ...it }));
  const state = {
    mode: "existing" as "existing" | "new",
    itemId: "botol-500",
    // "barang baru" form
    newPackageType: "botol" as PackageType,
    newPackageSize: "500",
    // pembelian
    packageQty: "1",
    pricePerPackage: "10000",
    priceMode: "package" as "package" | "base",
    pricePerBase: "",
    inputKarton: false,
  };

  let lastResetKey = beliResetKey({
    mode: state.mode,
    itemId: state.itemId,
    packageType: state.newPackageType,
  });

  function selectedItem(): WItem | null {
    return state.mode === "existing"
      ? items.find((i) => i.id === state.itemId) ?? null
      : null;
  }

  /** Mirror efek reset di BeliTab (lihat `_authenticated.gudang.tsx`). */
  function runResetEffect() {
    const key = beliResetKey({
      mode: state.mode,
      itemId: state.itemId,
      packageType: state.newPackageType,
    });
    if (key === lastResetKey) return;
    lastResetKey = key;
    state.packageQty = "1";
    state.pricePerPackage = "";
    state.pricePerBase = "";
    state.inputKarton = false;
    if (state.mode === "existing") {
      const it = selectedItem();
      state.priceMode = it && it.package_type === "pcs" ? "base" : "package";
    } else {
      state.priceMode = state.newPackageType === "pcs" ? "base" : "package";
    }
  }

  /** Mirror efek karton/priceMode-guard di BeliTab. */
  function runKartonGuardEffect() {
    const it = selectedItem();
    if (!it) return;
    if (it.package_type !== "botol" && state.inputKarton) state.inputKarton = false;
    if (it.package_type === "pcs" && state.priceMode !== "base") state.priceMode = "base";
  }

  function commitRender() {
    runResetEffect();
    runKartonGuardEffect();
  }

  return {
    state,
    selectedItem,
    /** Snapshot resetKey saat ini — dipakai test guard resetKey. */
    resetKey() {
      return beliResetKey({
        mode: state.mode,
        itemId: state.itemId,
        packageType: state.newPackageType,
      });
    },
    /**
     * Simulasi refetch daftar items dari server: setiap object diganti
     * dengan clone (identitas baru) tapi konten sama. resetKey TIDAK
     * berubah karena mode/itemId/packageType tetap.
     */
    refetchItems() {
      items = items.map((it) => ({ ...it }));
      commitRender();
    },
    setItemId(id: string) {
      state.itemId = id;
      commitRender();
    },
    setMode(m: "existing" | "new") {
      state.mode = m;
      commitRender();
    },
    setNewPackageType(pt: PackageType) {
      state.newPackageType = pt;
      commitRender();
    },
    setInputKarton(v: boolean) {
      state.inputKarton = v;
      commitRender();
    },
    setPricePerPackage(v: string) {
      state.pricePerPackage = v;
      commitRender();
    },
    setPackageQty(v: string) {
      state.packageQty = v;
      commitRender();
    },
    /** Snapshot ringkasan real-time — persis yang direndam BeliTab di JSX. */
    snapshot() {
      const it = selectedItem();
      const derived = computeBeliDerived({
        mode: state.mode,
        selectedItem: it,
        newPackageType: state.newPackageType,
        newPackageSize: state.newPackageSize,
        packageQty: state.packageQty,
        pricePerPackage: state.pricePerPackage,
        priceMode: state.priceMode,
        pricePerBase: state.pricePerBase,
        inputKarton: state.inputKarton,
      });
      const warnings = computeBeliWarnings({
        mode: state.mode,
        selectedItem: it,
        derived,
        priceMode: state.priceMode,
        inputKarton: state.inputKarton,
      }).filter((w) => w.level !== "error");
      return { derived, warnings };
    },
  };
}

describe("BeliTab — ringkasan real-time saat mengganti itemId / packageType", () => {
  let h: ReturnType<typeof createBeliTabHarness>;

  beforeEach(() => {
    h = createBeliTabHarness();
  });

  it("snapshot awal mengikuti item pertama (botol 500g)", () => {
    const { derived } = h.snapshot();
    expect(derived.effPackageType).toBe("botol");
    expect(derived.effBaseUnit).toBe("g");
    expect(derived.effectivePkgSize).toBe(500);
    expect(derived.kartonActive).toBe(false);
    expect(derived.baseAdded).toBe(500);
  });

  it("mengganti itemId botol → gram me-reset qty/harga dan menyegarkan derived", () => {
    h.setPricePerPackage("50000");
    h.setInputKarton(true); // valid untuk botol
    let snap = h.snapshot();
    expect(snap.derived.kartonActive).toBe(true);
    expect(snap.derived.effPackageType).toBe("botol");

    // Pindah ke item gram — reset effect + karton-guard harus aktif.
    h.setItemId("gram-1000");
    snap = h.snapshot();
    expect(snap.derived.effPackageType).toBe("gram");
    expect(snap.derived.effBaseUnit).toBe("g");
    expect(snap.derived.effectivePkgSize).toBe(1000);
    // Karton HARUS mati (bukan item botol lagi).
    expect(snap.derived.kartonActive).toBe(false);
    // Harga di-reset — tidak boleh membawa 50000 dari item sebelumnya.
    expect(h.state.pricePerPackage).toBe("");
    expect(snap.derived.price).toBe(0);
    // priceMode gram default = "package".
    expect(h.state.priceMode).toBe("package");
  });

  it("mengganti itemId ke pcs memaksa priceMode='base' dan mereset harga", () => {
    h.setPricePerPackage("25000");
    h.setItemId("pcs-1");
    const snap = h.snapshot();
    expect(snap.derived.effPackageType).toBe("pcs");
    expect(snap.derived.effectivePkgSize).toBe(1);
    // Karton-guard + reset default priceMode → "base".
    expect(h.state.priceMode).toBe("base");
    expect(h.state.inputKarton).toBe(false);
  });

  it("rangkaian botol→gram→pcs→botol tidak membawa stale karton/priceMode/harga", () => {
    // 1) botol dengan karton aktif & harga per-karton
    h.setInputKarton(true);
    h.setPricePerPackage("100000"); // 100rb per karton = 1000 per botol
    h.setPackageQty("2");
    let s = h.snapshot();
    expect(s.derived.kartonActive).toBe(true);
    expect(s.derived.pkgQ).toBe(200); // 2 karton × 100 botol
    expect(s.derived.price).toBe(1000);

    // 2) → gram
    h.setItemId("gram-1000");
    s = h.snapshot();
    expect(h.state.inputKarton).toBe(false);
    expect(h.state.pricePerPackage).toBe("");
    expect(h.state.packageQty).toBe("1");
    expect(s.derived.effPackageType).toBe("gram");
    expect(s.derived.kartonActive).toBe(false);
    expect(s.derived.baseAdded).toBe(1000);

    // 3) → pcs
    h.setItemId("pcs-1");
    s = h.snapshot();
    expect(h.state.priceMode).toBe("base");
    expect(s.derived.effPackageType).toBe("pcs");
    expect(s.derived.effectivePkgSize).toBe(1);

    // 4) balik ke botol — priceMode harus kembali ke "package"
    //    dan tidak boleh terjebak di "base" milik item pcs sebelumnya.
    h.setItemId("botol-500");
    s = h.snapshot();
    expect(h.state.priceMode).toBe("package");
    expect(s.derived.effPackageType).toBe("botol");
    expect(s.derived.effectivePkgSize).toBe(500);
    expect(s.derived.kartonActive).toBe(false);
  });

  it("mode 'new': mengganti packageType me-reset harga & priceMode konsisten", () => {
    h.setMode("new");
    h.setNewPackageType("botol");
    h.setPricePerPackage("30000");
    let s = h.snapshot();
    expect(s.derived.effPackageType).toBe("botol");
    expect(h.state.priceMode).toBe("package");

    // Ganti ke pcs — reset key berubah, priceMode default → "base".
    h.setNewPackageType("pcs");
    s = h.snapshot();
    expect(h.state.pricePerPackage).toBe("");
    expect(h.state.priceMode).toBe("base");
    expect(s.derived.effPackageType).toBe("pcs");
    expect(s.derived.effectivePkgSize).toBe(1);

    // Ganti ke gram — priceMode default → "package".
    h.setNewPackageType("gram");
    s = h.snapshot();
    expect(h.state.priceMode).toBe("package");
    expect(s.derived.effPackageType).toBe("gram");
    expect(s.derived.effBaseUnit).toBe("g");
  });

  it("warnings ikut menyegar saat item diganti (tidak stale ke item sebelumnya)", () => {
    // Set harga per-kemasan yang JAUH di atas avg untuk botol (avg 20 * 500 = 10000).
    h.setPricePerPackage("999999");
    const w1 = h.snapshot().warnings;
    // Ada minimal satu warning yang terkait dengan item botol saat harga janggal.
    const w1Text = w1.map((w) => w.message ?? "").join("|");

    // Pindah ke item pcs — harga di-reset ke "" → warnings HARUS recompute
    // berdasarkan item baru, bukan menyimpan warning lama.
    h.setItemId("pcs-1");
    const w2 = h.snapshot().warnings;
    const w2Text = w2.map((w) => w.message ?? "").join("|");
    expect(w2Text).not.toBe(w1Text);
    // Setelah reset, harga = 0 → tidak boleh ada warning "harga jauh di atas avg".
    expect(w2Text.toLowerCase()).not.toMatch(/di atas rata|di atas avg|terlalu tinggi/);
  });
});