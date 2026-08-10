import { describe, it, expect, beforeEach } from "vitest";
import { computeBeliDerived } from "@/lib/beli-derived";
import { computeBeliWarnings } from "@/lib/beli-warnings";
import { beliResetKey } from "@/lib/beli-reset-key";
import {
  BOTOL_PER_KARTON,
  rupiah,
  fmtBase,
  fmtItemQty,
} from "@/lib/stock-format";

/**
 * End-to-end (screen-level) test untuk urutan ganti itemId di form
 * Catat Pembelian (BeliTab). Kita tidak mem-boot browser — sebagai
 * gantinya kita jalankan pipeline produksi (`computeBeliDerived`,
 * `computeBeliWarnings`, reset effect via `beliResetKey`) dan
 * merender ulang panel "Ringkasan" ke STRING persis seperti JSX
 * `_authenticated.gudang.tsx` (baris 1940-1996). Setiap assertion
 * memeriksa teks yang muncul di layar user setelah interaksi tsb.
 */

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

function createScreen() {
  const state = {
    mode: "existing" as "existing" | "new",
    itemId: "botol-500",
    newPackageType: "botol" as PackageType,
    newPackageSize: "500",
    packageQty: "1",
    pricePerPackage: "10000",
    priceMode: "package" as "package" | "base",
    pricePerBase: "",
    inputKarton: false,
    paymentMethod: "kas" as "kas" | "hutang",
  };
  let lastKey = beliResetKey({
    mode: state.mode,
    itemId: state.itemId,
    packageType: state.newPackageType,
  });

  const selectedItem = (): WItem | null =>
    state.mode === "existing"
      ? ITEMS.find((i) => i.id === state.itemId) ?? null
      : null;

  function commit() {
    // Reset effect — persis logika di gudang.tsx.
    const key = beliResetKey({
      mode: state.mode,
      itemId: state.itemId,
      packageType: state.newPackageType,
    });
    if (key !== lastKey) {
      lastKey = key;
      state.packageQty = "1";
      state.pricePerPackage = "";
      state.pricePerBase = "";
      state.inputKarton = false;
      const it = selectedItem();
      state.priceMode =
        state.mode === "existing"
          ? it && it.package_type === "pcs"
            ? "base"
            : "package"
          : state.newPackageType === "pcs"
            ? "base"
            : "package";
    }
    // Karton-guard.
    const it = selectedItem();
    if (it) {
      if (it.package_type !== "botol" && state.inputKarton) state.inputKarton = false;
      if (it.package_type === "pcs" && state.priceMode !== "base") state.priceMode = "base";
    }
  }

  /**
   * Merender ulang panel "Ringkasan" ke string. Setiap baris cocok
   * dengan satu baris JSX di `_authenticated.gudang.tsx`.
   */
  function renderSummary(): string {
    const it = selectedItem();
    const d = computeBeliDerived({
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
    const {
      effPackageType,
      effBaseUnit: baseUnit,
      effectivePkgSize,
      kartonActive,
      pkgQ,
      price,
      baseAdded,
      totalCost,
    } = d;

    const lines: string[] = [];
    const header = it
      ? `${it.name} · ${effPackageType}${effPackageType !== "pcs" ? ` ${effectivePkgSize} ${baseUnit}` : ""}`
      : `Barang baru · ${effPackageType}${effPackageType !== "pcs" ? ` ${effectivePkgSize} ${baseUnit}` : ""}`;
    lines.push(`Ringkasan | ${header}`);
    lines.push(
      `Jumlah kemasan | ${pkgQ.toLocaleString("id-ID")} ${effPackageType}${
        kartonActive ? ` (${(pkgQ / BOTOL_PER_KARTON).toLocaleString("id-ID")} karton)` : ""
      }`,
    );
    lines.push(
      `Tambahan stok | ${it ? fmtItemQty(baseAdded, it) : fmtBase(baseAdded, baseUnit)}`,
    );
    lines.push(`Harga per ${effPackageType} | ${rupiah(price)}`);
    if (effPackageType !== "pcs" && baseAdded > 0) {
      lines.push(`Harga per ${baseUnit} | ${rupiah(totalCost / baseAdded)}`);
    }
    lines.push(
      `Total biaya | ${rupiah(totalCost)} (${state.paymentMethod === "hutang" ? "hutang" : "lunas"})`,
    );
    if (it && Number(it.avg_cost_per_base) > 0 && baseAdded > 0) {
      lines.push(`Rata-rata modal item | ${rupiah(it.avg_cost_per_base)}/${it.base_unit}`);
    }
    return lines.join("\n");
  }

  function renderWarnings(): string[] {
    const it = selectedItem();
    const d = computeBeliDerived({
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
    return computeBeliWarnings({
      mode: state.mode,
      selectedItem: it,
      derived: d,
      priceMode: state.priceMode,
      inputKarton: state.inputKarton,
    })
      .filter((w) => w.level !== "error")
      .map((w) => w.message);
  }

  return {
    state,
    renderSummary,
    renderWarnings,
    selectItem(id: string) {
      state.itemId = id;
      commit();
    },
    setInputKarton(v: boolean) {
      state.inputKarton = v;
      commit();
    },
    setPricePerPackage(v: string) {
      state.pricePerPackage = v;
      commit();
    },
    setPackageQty(v: string) {
      state.packageQty = v;
      commit();
    },
  };
}

describe("E2E (screen-level) — urutan botol→gram→pcs→botol di Catat Pembelian", () => {
  let s: ReturnType<typeof createScreen>;

  beforeEach(() => {
    s = createScreen();
  });

  it("botol (awal): Ringkasan menampilkan botol 500 g dan harga per botol", () => {
    const screen = s.renderSummary();
    expect(screen).toContain("Sirup Botol 500ml · botol 500 g");
    expect(screen).toContain("Jumlah kemasan | 1 botol");
    expect(screen).toContain("Tambahan stok |");
    expect(screen).toMatch(/Harga per botol \| Rp\s?10\.000/);
    // Non-pcs + baseAdded > 0 → baris "Harga per g" muncul.
    expect(screen).toMatch(/Harga per g \|/);
  });

  it("botol → gram: header, tambahan stok, dan harga di layar berpindah ke gram", () => {
    s.setInputKarton(true);
    s.setPricePerPackage("100000");
    // Sebelum ganti — Ringkasan menampilkan mode karton.
    expect(s.renderSummary()).toMatch(/Jumlah kemasan \| 100 botol \(1 karton\)/);

    s.selectItem("gram-1000");
    const screen = s.renderSummary();

    // Header mengikuti item baru — tidak boleh menyisakan "Sirup Botol".
    expect(screen).toContain("Gula Curah · gram 1000 g");
    expect(screen).not.toContain("Sirup Botol");
    // Reset effect: qty=1, harga="", karton mati.
    expect(screen).toContain("Jumlah kemasan | 1 gram");
    expect(screen).not.toMatch(/karton\)/);
    expect(screen).toMatch(/Harga per gram \| Rp\s?0/);
    // Total biaya = 0 setelah reset.
    expect(screen).toMatch(/Total biaya \| Rp\s?0\s+\(lunas\)/);
  });

  it("gram → pcs: header pcs tanpa 'ukuran', baris 'Harga per base' hilang", () => {
    s.selectItem("gram-1000");
    s.setPricePerPackage("5000");
    s.setPackageQty("3");
    // Ringkasan gram menampilkan baris "Harga per g".
    expect(s.renderSummary()).toMatch(/Harga per g \|/);

    s.selectItem("pcs-1");
    const screen = s.renderSummary();
    // Header pcs tidak menyertakan "N unit" karena pcs.
    expect(screen).toContain("Sikat 1 pcs · pcs");
    expect(screen).not.toMatch(/pcs \d/);
    // Reset effect berlaku.
    expect(screen).toContain("Jumlah kemasan | 1 pcs");
    // Untuk pcs, tidak ada baris "Harga per <base>" (pengecualian JSX).
    expect(screen).not.toMatch(/Harga per pcs \| .*\n.*Harga per/);
    // Header "Harga per pcs" tetap ada satu kali (baris harga per kemasan).
    expect(screen.match(/Harga per pcs \|/g)?.length).toBe(1);
  });

  it("pcs → botol: kembali ke summary botol tanpa membawa state pcs", () => {
    s.selectItem("pcs-1");
    s.setPricePerPackage("6000"); // di mode pcs, priceMode dipaksa base — nilai ini tidak terpakai
    // Kembali ke botol.
    s.selectItem("botol-500");
    const screen = s.renderSummary();
    expect(screen).toContain("Sirup Botol 500ml · botol 500 g");
    expect(screen).toContain("Jumlah kemasan | 1 botol");
    // Setelah reset, harga direset ke 0 — tidak boleh membawa 6000 dari pcs.
    expect(screen).toMatch(/Harga per botol \| Rp\s?0/);
    expect(screen).toMatch(/Total biaya \| Rp\s?0/);
  });

  it("rangkaian penuh botol→gram→pcs→botol: setiap layar konsisten dengan item terpilih", () => {
    const trace: string[] = [];

    // 1) botol dengan harga & karton
    s.setInputKarton(true);
    s.setPricePerPackage("100000");
    s.setPackageQty("2");
    trace.push(`[botol]\n${s.renderSummary()}`);
    expect(s.renderSummary()).toMatch(/Sirup Botol 500ml · botol 500 g/);
    expect(s.renderSummary()).toMatch(/Jumlah kemasan \| 200 botol \(2 karton\)/);

    // 2) → gram
    s.selectItem("gram-1000");
    trace.push(`[gram]\n${s.renderSummary()}`);
    expect(s.renderSummary()).toMatch(/Gula Curah · gram 1000 g/);
    expect(s.renderSummary()).not.toMatch(/karton/);
    expect(s.renderSummary()).not.toMatch(/Sirup Botol/);

    // 3) → pcs
    s.selectItem("pcs-1");
    trace.push(`[pcs]\n${s.renderSummary()}`);
    expect(s.renderSummary()).toMatch(/Sikat 1 pcs · pcs/);
    expect(s.renderSummary()).not.toMatch(/Gula Curah/);

    // 4) → botol lagi
    s.selectItem("botol-500");
    trace.push(`[botol#2]\n${s.renderSummary()}`);
    const finalScreen = s.renderSummary();
    expect(finalScreen).toMatch(/Sirup Botol 500ml · botol 500 g/);
    expect(finalScreen).toMatch(/Jumlah kemasan \| 1 botol/);
    // Konsistensi lintas kunjungan: layar botol kedua sekurangnya
    // memuat baris-baris kunci yang sama dengan kunjungan pertama
    // pada nilai default (bukan membawa 200/2 karton dari state lama).
    expect(finalScreen).not.toMatch(/\(2 karton\)/);
    expect(finalScreen).not.toMatch(/200 botol/);

    // Log jejak untuk debugging jika suatu saat gagal.
    if (process.env.SHOW_TRACE) console.log(trace.join("\n---\n"));
  });

  it("warnings di layar juga mengikuti item terbaru — bukan pesan item sebelumnya", () => {
    s.setPricePerPackage("999999"); // botol: janggal
    const w1 = s.renderWarnings().join("|");

    s.selectItem("pcs-1");
    const w2 = s.renderWarnings().join("|");

    // Setelah reset, harga=0 → tidak boleh ada pesan "modal per g/pcs di atas rata-rata".
    expect(w2.toLowerCase()).not.toMatch(/di atas rata|di atas avg/);
    expect(w2).not.toBe(w1);
  });
});
