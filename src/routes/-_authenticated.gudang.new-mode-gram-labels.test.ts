import { describe, it, expect, beforeEach } from "vitest";
import { computeBeliDerived } from "@/lib/beli-derived";
import { beliResetKey } from "@/lib/beli-reset-key";
import { BOTOL_PER_KARTON, rupiah, fmtBase } from "@/lib/stock-format";

/**
 * UI-level test untuk form "Catat Pembelian → Barang baru" di
 * `src/routes/_authenticated.gudang.tsx`. Kita render ulang label bawah
 * (Isi/kemasan, Jumlah kemasan, Harga per…, Ringkasan) ke STRING persis
 * seperti JSX (baris 1882-2050) dan memverifikasi bahwa setelah pengguna
 * memilih Jenis kemasan = "gram (curah)", seluruh label yang tadinya
 * "botol/pcs" berpindah ke "gram" / "g".
 */

type PackageType = "gram" | "pcs" | "botol" | "sachet";

function createNewModeScreen() {
  const state = {
    mode: "new" as const,
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
    itemId: "",
    packageType: state.newPackageType,
  });

  function commit() {
    const key = beliResetKey({
      mode: state.mode,
      itemId: "",
      packageType: state.newPackageType,
    });
    if (key !== lastKey) {
      lastKey = key;
      state.packageQty = "1";
      state.pricePerPackage = "";
      state.pricePerBase = "";
      state.inputKarton = false;
      state.priceMode = state.newPackageType === "pcs" ? "base" : "package";
    }
  }

  function derive() {
    return computeBeliDerived({
      mode: state.mode,
      selectedItem: null,
      newPackageType: state.newPackageType,
      newPackageSize: state.newPackageSize,
      packageQty: state.packageQty,
      pricePerPackage: state.pricePerPackage,
      priceMode: state.priceMode,
      pricePerBase: state.pricePerBase,
      inputKarton: state.inputKarton,
    });
  }

  // Render potongan label form (baris 1886-1981 di gudang.tsx).
  function renderForm(): string {
    const d = derive();
    const lines: string[] = [];
    // Isi / kemasan (baris 1896-1913)
    if (d.effPackageType !== "pcs") {
      lines.push(`Isi / kemasan (${d.effBaseUnit})`);
    }
    // Info stok (baris 1915-1917)
    lines.push(
      `Stok disimpan dalam ${d.effBaseUnit}. Saat dijual per ${d.effBaseUnit}, akan dikurangi otomatis.`,
    );
    // Jumlah kemasan/karton (baris 1935-1937)
    lines.push(`Jumlah ${d.kartonActive ? "karton" : "kemasan"}`);
    // Harga per kemasan / base (baris 1940-1952)
    if (state.priceMode === "package") {
      lines.push(`Harga beli / ${d.kartonActive ? "karton" : d.effPackageType} (Rp)`);
    } else {
      lines.push(`Harga beli / ${d.effBaseUnit} (Rp)`);
    }
    // Toggle karton hanya muncul untuk botol (baris 1955)
    if (d.effPackageType === "botol") lines.push("Input dalam karton");
    // Toggle priceMode (baris 1972-1981)
    if (d.effPackageType !== "pcs") {
      lines.push(`[toggle] Harga per ${d.effPackageType}`);
      lines.push(`[toggle] Harga per ${d.effBaseUnit}`);
    }
    return lines.join("\n");
  }

  // Render panel Ringkasan (baris 2003-2050 di gudang.tsx).
  function renderSummary(): string {
    const d = derive();
    const lines: string[] = [];
    lines.push(
      `Ringkasan | Barang baru · ${d.effPackageType}${
        d.effPackageType !== "pcs" ? ` ${d.effectivePkgSize} ${d.effBaseUnit}` : ""
      }`,
    );
    lines.push(
      `Jumlah kemasan | ${d.pkgQ.toLocaleString("id-ID")} ${d.effPackageType}${
        d.kartonActive
          ? ` (${(d.pkgQ / BOTOL_PER_KARTON).toLocaleString("id-ID")} karton)`
          : ""
      }`,
    );
    lines.push(`Tambahan stok | ${fmtBase(d.baseAdded, d.effBaseUnit)}`);
    lines.push(`Harga per ${d.effPackageType} | ${rupiah(d.price)}`);
    if (d.effPackageType !== "pcs" && d.baseAdded > 0) {
      lines.push(`Harga per ${d.effBaseUnit} | ${rupiah(d.totalCost / d.baseAdded)}`);
    }
    return lines.join("\n");
  }

  return {
    state,
    renderForm,
    renderSummary,
    setPackageType(pt: PackageType) {
      state.newPackageType = pt;
      commit();
    },
    setPackageSize(v: string) {
      state.newPackageSize = v;
    },
    setPricePerPackage(v: string) {
      state.pricePerPackage = v;
    },
    setPackageQty(v: string) {
      state.packageQty = v;
    },
  };
}

describe("Gudang → Barang baru: label form & ringkasan mengikuti Jenis kemasan = gram", () => {
  let s: ReturnType<typeof createNewModeScreen>;

  beforeEach(() => {
    s = createNewModeScreen();
  });

  it("Awal (botol): form dan ringkasan menampilkan label botol", () => {
    const form = s.renderForm();
    const sum = s.renderSummary();
    // defaultBaseUnit("botol") === "pcs" → label satuan isi ikut "pcs".
    expect(form).toContain("Isi / kemasan (pcs)");
    expect(form).toContain("Jumlah kemasan");
    expect(form).toContain("Harga beli / botol (Rp)");
    expect(form).toContain("[toggle] Harga per botol");
    expect(form).toContain("[toggle] Harga per pcs");
    expect(sum).toContain("Barang baru · botol 500 pcs");
    expect(sum).toMatch(/Harga per botol \|/);
  });

  it("Setelah pilih 'gram (curah)': semua label bawah berubah ke gram/g", () => {
    s.setPackageType("gram");
    // Setelah reset, isi ulang ukuran + harga.
    s.setPackageSize("1000");
    s.setPricePerPackage("5000");
    s.setPackageQty("2");

    const form = s.renderForm();
    const sum = s.renderSummary();

    // Form: satuan isi & info stok
    expect(form).toContain("Isi / kemasan (g)");
    expect(form).toContain("Stok disimpan dalam g.");
    // Form: label harga & toggle mengikuti "gram" / "g"
    expect(form).toContain("Harga beli / gram (Rp)");
    expect(form).toContain("[toggle] Harga per gram");
    expect(form).toContain("[toggle] Harga per g");

    // Tidak boleh lagi menampilkan label botol/pcs di baris manapun
    // (kecuali sebagai substring dari kata lain — kita cek per baris).
    for (const line of form.split("\n")) {
      expect(line).not.toMatch(/\bHarga beli \/ botol\b/);
      expect(line).not.toMatch(/\bHarga beli \/ pcs\b/);
      expect(line).not.toMatch(/\[toggle\] Harga per botol\b/);
      expect(line).not.toMatch(/\[toggle\] Harga per pcs\b/);
    }
    // Toggle karton HANYA untuk botol → tidak boleh muncul untuk gram.
    expect(form).not.toContain("Input dalam karton");

    // Ringkasan: header, jumlah, harga per kemasan & per base semua gram/g
    expect(sum).toContain("Ringkasan | Barang baru · gram 1000 g");
    expect(sum).toContain("Jumlah kemasan | 2 gram");
    expect(sum).toMatch(/Harga per gram \| Rp\s?5\.000/);
    expect(sum).toMatch(/Harga per g \|/);
    expect(sum).not.toMatch(/\bbotol\b/);
    expect(sum).not.toMatch(/\bpcs\b/);
  });

  it("botol → gram → pcs → gram: label tidak membawa sisa dari pilihan sebelumnya", () => {
    // Set state di botol dulu (dengan karton aktif via toggle default OFF).
    s.setPricePerPackage("100000");
    expect(s.renderSummary()).toMatch(/\bbotol\b/);

    // → gram
    s.setPackageType("gram");
    s.setPackageSize("1000");
    let form = s.renderForm();
    let sum = s.renderSummary();
    expect(form).toContain("Isi / kemasan (g)");
    expect(form).toContain("Harga beli / gram (Rp)");
    expect(sum).toContain("Barang baru · gram 1000 g");
    expect(sum).not.toMatch(/\bbotol\b/);

    // → pcs
    s.setPackageType("pcs");
    form = s.renderForm();
    sum = s.renderSummary();
    expect(form).not.toContain("Isi / kemasan"); // pcs tidak punya isi
    expect(form).toContain("Stok disimpan dalam pcs.");
    expect(sum).toContain("Barang baru · pcs");

    // → gram lagi
    s.setPackageType("gram");
    s.setPackageSize("500");
    form = s.renderForm();
    sum = s.renderSummary();
    expect(form).toContain("Isi / kemasan (g)");
    expect(form).toContain("Harga beli / gram (Rp)");
    expect(sum).toContain("Barang baru · gram 500 g");
    expect(sum).not.toMatch(/\bbotol\b/);
    expect(sum).not.toMatch(/\bpcs\b/);
  });
});