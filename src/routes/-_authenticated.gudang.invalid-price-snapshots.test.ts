import { describe, it, expect, beforeEach } from "vitest";
import {
  computeBeliDerived,
  __resetBeliDerivedMemo,
  type BeliPackageType,
  type BeliBaseUnit,
} from "@/lib/beli-derived";
import { rupiah, fmtBase, fmtItemQty } from "@/lib/stock-format";

/**
 * Snapshot **input tidak valid / error perhitungan** pada form Catat Pembelian.
 *
 * Sumber kebenaran validasi ada di `submit()` di
 * `src/routes/_authenticated.gudang.tsx` (baris ~1806-1836). Aturan tersebut
 * di-mirror di helper `validateBeliSubmit` di test ini sehingga snapshot
 * mengunci pesan error, state tombol Simpan, dan ringkasan turunan bersama-
 * sama — perubahan pada salah satu wajib update snapshot & direview.
 *
 * Kontrak yang dikunci:
 *   1. Pesan error persis sama dengan `toast.error(...)` di form.
 *   2. Tombol Simpan `disabled` untuk semua state invalid — jangan pernah
 *      "aktif tapi diam-diam gagal" (silent no-op).
 *   3. Ringkasan turunan tetap deterministic meski input invalid — angka
 *      output boleh 0/negatif/NaN-safe, tapi tidak boleh `NaN`,
 *      `undefined`, atau `Infinity` di string yang di-render.
 *   4. Anti-artefak: setelah user mengganti input invalid A → invalid B,
 *      pesan error mencerminkan B, dan ringkasan tidak menyisakan angka
 *      dari A (memo bersih).
 */

type PackageType = BeliPackageType;

type WItem = {
  id: string;
  name: string;
  package_type: PackageType;
  package_size: number;
  base_unit: BeliBaseUnit;
  stock_base: number;
  avg_cost_per_base: number;
};

const baseUnitFor = (pt: PackageType): BeliBaseUnit => (pt === "gram" ? "g" : "pcs");

function makeItem(pt: PackageType, size: number): WItem {
  return {
    id: `existing-${pt}`,
    name: `Item ${pt.toUpperCase()}`,
    package_type: pt,
    package_size: size,
    base_unit: baseUnitFor(pt),
    stock_base: 5000,
    avg_cost_per_base: 12,
  };
}

type FormState = {
  mode: "new" | "existing";
  packageType: PackageType;
  packageSize: string;
  packageQty: string;
  pricePerPackage: string;
  priceMode: "package" | "base";
  pricePerBase: string;
  inputKarton: boolean;
  // Extra field untuk validasi mode `new` & supplier hutang:
  name: string;
  paymentMethod: "kas" | "hutang";
  supplierId: string; // "" = belum dipilih
};

/**
 * Mirror dari `submit()` di `_authenticated.gudang.tsx`. URUTAN aturan
 * penting — pertama yang match menjadi pesan error yang tampil.
 */
function validateBeliSubmit(
  state: FormState,
  derived: { pkgQ: number; price: number; effectivePkgSize: number },
): { ok: boolean; error: string | null; canSubmit: boolean } {
  const { pkgQ, price, effectivePkgSize } = derived;

  // 1. Jumlah & harga
  if (pkgQ <= 0 || price < 0) {
    return { ok: false, error: "Periksa jumlah & harga", canSubmit: false };
  }
  // 2. Supplier untuk pembelian hutang
  if (state.paymentMethod === "hutang" && !state.supplierId) {
    return {
      ok: false,
      error: "Pembelian hutang wajib memilih supplier",
      canSubmit: false,
    };
  }
  // 3. Mode `new`: nama & ukuran kemasan
  if (state.mode === "new") {
    if (!state.name.trim()) {
      return { ok: false, error: "Nama barang wajib", canSubmit: false };
    }
    if (state.packageType !== "pcs" && effectivePkgSize <= 0) {
      return { ok: false, error: "Ukuran kemasan harus > 0", canSubmit: false };
    }
  }
  // 4. Mode `existing`: item terpilih valid
  //    (Di test ini, "belum pilih" direpresentasikan mode==="existing" +
  //    packageSize kosong / 0 → makeItem dengan size=1 lolos; jadi kita
  //    tandai eksplisit via flag `noItem` di skenario yang butuh.)

  return { ok: true, error: null, canSubmit: true };
}

function renderScenario(state: FormState, extra: { noItem?: boolean } = {}): string {
  const selectedItem = extra.noItem
    ? null
    : state.mode === "existing"
      ? makeItem(state.packageType, Number(state.packageSize) || 1)
      : null;

  const d = computeBeliDerived({
    mode: state.mode,
    selectedItem,
    newPackageType: state.packageType,
    newPackageSize: state.packageSize,
    packageQty: state.packageQty,
    pricePerPackage: state.pricePerPackage,
    priceMode: state.priceMode,
    pricePerBase: state.pricePerBase,
    inputKarton: state.inputKarton,
  });

  // Tambahan aturan: mode existing tanpa item → "Pilih barang".
  let v = validateBeliSubmit(state, {
    pkgQ: d.pkgQ,
    price: d.price,
    effectivePkgSize: d.effectivePkgSize,
  });
  if (v.ok && state.mode === "existing" && extra.noItem) {
    v = { ok: false, error: "Pilih barang", canSubmit: false };
  }

  const it = selectedItem;
  const header = it
    ? `${it.name} · ${d.effPackageType}${d.effPackageType !== "pcs" ? ` ${d.effectivePkgSize} ${d.effBaseUnit}` : ""}`
    : `Barang baru · ${d.effPackageType}${d.effPackageType !== "pcs" ? ` ${d.effectivePkgSize} ${d.effBaseUnit}` : ""}`;

  const perBaseLine =
    d.effPackageType !== "pcs" && d.baseAdded !== 0 && Number.isFinite(d.totalCost / d.baseAdded)
      ? `[SUM] Harga per ${d.effBaseUnit} | ${rupiah(d.totalCost / d.baseAdded)}`
      : `[SUM] Harga per ${d.effBaseUnit} | —`;

  const lines: string[] = [
    `[FORM] mode=${state.mode}${extra.noItem ? " (noItem)" : ""} · pt=${state.packageType} · size=${state.packageSize} · qty=${JSON.stringify(
      state.packageQty,
    )} · pricePkg=${JSON.stringify(state.pricePerPackage)} · priceBase=${JSON.stringify(
      state.pricePerBase,
    )} · priceMode=${state.priceMode} · karton=${state.inputKarton ? "ON" : "OFF"} · payment=${state.paymentMethod} · supplier=${state.supplierId || "-"} · name=${JSON.stringify(state.name)}`,
    `[VALIDATE] ok=${v.ok} · error=${JSON.stringify(v.error)}`,
    `[BUTTON] Simpan disabled=${!v.canSubmit}`,
    `[SUM] Ringkasan | ${header}`,
    `[SUM] Jumlah kemasan | ${d.pkgQ.toLocaleString("id-ID", { maximumFractionDigits: 4 })} ${d.effPackageType}`,
    `[SUM] Tambahan stok | ${it ? fmtItemQty(d.baseAdded, it) : fmtBase(d.baseAdded, d.effBaseUnit)}`,
    `[SUM] Harga per ${d.effPackageType} | ${rupiah(d.price)}`,
    perBaseLine,
    `[SUM] Total biaya | ${rupiah(d.totalCost)}`,
    `[RAW] pkgQ=${d.pkgQ} · price=${d.price} · baseAdded=${d.baseAdded} · totalCost=${d.totalCost}`,
  ];
  return lines.join("\n");
}

function baseValid(): FormState {
  return {
    mode: "new",
    packageType: "gram",
    packageSize: "1000",
    packageQty: "2",
    pricePerPackage: "10000",
    priceMode: "package",
    pricePerBase: "",
    inputKarton: false,
    name: "Beras Premium",
    paymentMethod: "kas",
    supplierId: "",
  };
}

describe("Gudang — snapshot input tidak valid / error perhitungan", () => {
  beforeEach(() => {
    __resetBeliDerivedMemo();
  });

  describe("Kategori error: qty & harga invalid", () => {
    const cases: Array<{ label: string; patch: Partial<FormState> }> = [
      { label: "qty = 0", patch: { packageQty: "0" } },
      { label: "qty = kosong", patch: { packageQty: "" } },
      { label: "qty = whitespace", patch: { packageQty: "   " } },
      { label: "qty = -3 (negatif)", patch: { packageQty: "-3" } },
      { label: "qty = 'abc' (bukan angka)", patch: { packageQty: "abc" } },
      { label: "price = -5000 (negatif)", patch: { pricePerPackage: "-5000" } },
      {
        label: "price = 'abc' (bukan angka, dianggap 0 — valid non-negatif tapi qty tetap 2)",
        patch: { pricePerPackage: "abc" },
      },
      {
        label: "qty=0 & price=-1 (dua-duanya invalid)",
        patch: { packageQty: "0", pricePerPackage: "-1" },
      },
    ];
    for (const { label, patch } of cases) {
      it(`snapshot: ${label}`, () => {
        expect(renderScenario({ ...baseValid(), ...patch })).toMatchSnapshot();
      });
    }
  });

  describe("Kategori error: mode 'new' — nama & ukuran kemasan", () => {
    it("snapshot: nama kosong (whitespace)", () => {
      expect(renderScenario({ ...baseValid(), name: "   " })).toMatchSnapshot();
    });
    it("snapshot: nama kosong + qty valid + harga valid", () => {
      expect(renderScenario({ ...baseValid(), name: "" })).toMatchSnapshot();
    });
    it("snapshot: packageSize=0 pada gram (Ukuran kemasan harus > 0)", () => {
      expect(renderScenario({ ...baseValid(), packageSize: "0" })).toMatchSnapshot();
    });
    it("snapshot: packageSize='' pada botol", () => {
      expect(
        renderScenario({
          ...baseValid(),
          packageType: "botol",
          packageSize: "",
          pricePerPackage: "10000",
        }),
      ).toMatchSnapshot();
    });
    it("snapshot: packageSize=0 pada pcs — TETAP VALID (pcs paksa size=1)", () => {
      expect(
        renderScenario({
          ...baseValid(),
          packageType: "pcs",
          packageSize: "0",
          priceMode: "base",
          pricePerPackage: "",
          pricePerBase: "3000",
        }),
      ).toMatchSnapshot();
    });
  });

  describe("Kategori error: mode 'existing' — item belum dipilih", () => {
    it("snapshot: mode=existing tanpa item (noItem)", () => {
      expect(
        renderScenario({ ...baseValid(), mode: "existing" }, { noItem: true }),
      ).toMatchSnapshot();
    });
  });

  describe("Kategori error: hutang tanpa supplier", () => {
    it("snapshot: paymentMethod=hutang & supplier kosong", () => {
      expect(
        renderScenario({ ...baseValid(), paymentMethod: "hutang", supplierId: "" }),
      ).toMatchSnapshot();
    });
    it("snapshot: hutang + qty=0 → prioritas error 'Periksa jumlah & harga'", () => {
      // Aturan urutan: qty/price dicek DULU sebelum supplier.
      expect(
        renderScenario({
          ...baseValid(),
          paymentMethod: "hutang",
          supplierId: "",
          packageQty: "0",
        }),
      ).toMatchSnapshot();
    });
  });

  describe("Transisi input invalid A → invalid B → valid (anti-artefak)", () => {
    it("qty=-3 → qty='' → qty=2 (valid): pesan error & ringkasan bersih", () => {
      const stateA: FormState = { ...baseValid(), packageQty: "-3" };
      const stateB: FormState = { ...baseValid(), packageQty: "" };
      const stateC: FormState = { ...baseValid(), packageQty: "2" };

      const sA = renderScenario(stateA);
      const sB = renderScenario(stateB);
      const sC = renderScenario(stateC);

      // Snapshot pasangan A → B → C untuk audit visual.
      expect(
        `=== A: qty=-3 ===\n${sA}\n\n=== B: qty='' ===\n${sB}\n\n=== C: qty=2 (valid) ===\n${sC}`,
      ).toMatchSnapshot();

      // Kontrak: A & B sama-sama trigger error "Periksa jumlah & harga",
      // C valid tanpa error.
      expect(sA).toContain(`[VALIDATE] ok=false · error="Periksa jumlah & harga"`);
      expect(sB).toContain(`[VALIDATE] ok=false · error="Periksa jumlah & harga"`);
      expect(sC).toContain(`[VALIDATE] ok=true · error=null`);

      // Tombol Simpan: disabled saat invalid, enabled saat valid.
      expect(sA).toContain(`[BUTTON] Simpan disabled=true`);
      expect(sB).toContain(`[BUTTON] Simpan disabled=true`);
      expect(sC).toContain(`[BUTTON] Simpan disabled=false`);

      // Anti-artefak numerik: C (qty=2) tidak boleh berisi total dari
      // hipotesa A (qty=-3 · 10000 = -30.000 = "-Rp 30.000" atau
      // "Rp -30.000"; format id-ID → "-Rp30.000") atau B (qty=0 → Rp 0
      // yang sah muncul, jadi hanya guard A).
      expect(sC).not.toMatch(/-30\.000/);
      expect(sC).not.toMatch(/-3\.000\s*g\b/); // baseAdded A
      // Sanity: C berisi angkanya sendiri.
      expect(sC).toMatch(/Rp\s*20\.000/);
      expect(sC).toMatch(/2\s*kg\b/);
    });

    it("transisi error class: 'Nama wajib' → 'Ukuran > 0' → 'Periksa jumlah & harga'", () => {
      const s1 = renderScenario({ ...baseValid(), name: "" });
      const s2 = renderScenario({ ...baseValid(), packageSize: "0" });
      const s3 = renderScenario({ ...baseValid(), packageQty: "0" });

      expect(s1).toContain(`error="Nama barang wajib"`);
      expect(s2).toContain(`error="Ukuran kemasan harus > 0"`);
      // Prioritas: qty/price dicek DULU, jadi s3 muncul error jumlah/harga.
      expect(s3).toContain(`error="Periksa jumlah & harga"`);

      expect(
        `=== nama kosong ===\n${s1}\n\n=== ukuran=0 ===\n${s2}\n\n=== qty=0 ===\n${s3}`,
      ).toMatchSnapshot();
    });

    it("perbaikan bertahap: nama+ukuran+qty semua invalid → dibetulkan satu-per-satu", () => {
      const bad: FormState = {
        ...baseValid(),
        name: "",
        packageSize: "0",
        packageQty: "0",
        pricePerPackage: "-1",
      };
      const fixQty = { ...bad, packageQty: "2", pricePerPackage: "10000" };
      const fixSize = { ...fixQty, packageSize: "1000" };
      const fixName = { ...fixSize, name: "Beras Premium" };

      const s0 = renderScenario(bad);
      const s1 = renderScenario(fixQty);
      const s2 = renderScenario(fixSize);
      const s3 = renderScenario(fixName);

      // Setiap step, error yang muncul adalah prioritas berikutnya.
      expect(s0).toContain(`error="Periksa jumlah & harga"`);
      expect(s1).toContain(`error="Nama barang wajib"`);
      // Kalau nama masih kosong, urutan berikutnya nama sebelum ukuran.
      // Setelah nama diperbaiki (fixName), ukuran juga sudah OK → valid.
      expect(s2).toContain(`error="Nama barang wajib"`);
      expect(s3).toContain(`[VALIDATE] ok=true · error=null`);
      expect(s3).toContain(`[BUTTON] Simpan disabled=false`);

      expect(
        `=== s0 all-bad ===\n${s0}\n\n=== s1 fix qty ===\n${s1}\n\n=== s2 fix ukuran ===\n${s2}\n\n=== s3 fix nama (valid) ===\n${s3}`,
      ).toMatchSnapshot();
    });
  });

  describe("Guard: input invalid TIDAK memicu token racun di ringkasan", () => {
    const bads: Array<{ label: string; state: FormState }> = [
      { label: "qty=NaN string", state: { ...baseValid(), packageQty: "NaN" } },
      { label: "price=NaN string", state: { ...baseValid(), pricePerPackage: "NaN" } },
      { label: "qty=Infinity", state: { ...baseValid(), packageQty: "Infinity" } },
      { label: "price=-Infinity", state: { ...baseValid(), pricePerPackage: "-Infinity" } },
      { label: "qty=huge 1e308", state: { ...baseValid(), packageQty: "1e308" } },
      { label: "price=huge 1e308", state: { ...baseValid(), pricePerPackage: "1e308" } },
      {
        label: "qty=1e308 & price=1e308 (overflow → Infinity total)",
        state: { ...baseValid(), packageQty: "1e308", pricePerPackage: "1e308" },
      },
    ];
    for (const { label, state } of bads) {
      it(`no NaN/undefined/Infinity token — ${label}`, () => {
        const s = renderScenario(state);
        // Baris [RAW] boleh menampilkan angka numerik apapun (termasuk
        // Infinity di raw value untuk audit). Yang kita jaga adalah
        // baris ringkasan yang dilihat user ([SUM]).
        const sumLines = s
          .split("\n")
          .filter((l) => l.startsWith("[SUM]"))
          .join("\n");
        expect(sumLines).not.toMatch(/\bNaN\b/);
        expect(sumLines).not.toMatch(/\bundefined\b/);
        expect(sumLines).not.toMatch(/\bInfinity\b/i);
        expect(sumLines).toMatch(/Rp/);
      });
    }

    it("input Infinity/NaN memicu error validasi (tombol disabled)", () => {
      // Number("NaN") = NaN → NaN || 0 = 0 → pkgQ=0 → error jumlah/harga.
      const s = renderScenario({ ...baseValid(), packageQty: "NaN" });
      expect(s).toContain(`[VALIDATE] ok=false · error="Periksa jumlah & harga"`);
      expect(s).toContain(`[BUTTON] Simpan disabled=true`);

      // Number("Infinity") = Infinity → truthy → pkgQ=Infinity → LOLOS
      // validasi (pkgQ > 0). Ini contoh edge case yang seharusnya juga
      // ditolak oleh backend / trigger DB; test ini mendokumentasikan
      // perilaku saat ini agar regresi terlihat.
      const sInf = renderScenario({ ...baseValid(), packageQty: "Infinity" });
      expect(sInf).toContain(`[VALIDATE] ok=true · error=null`);
    });
  });

  describe("State tombol stabil setelah retry submit invalid", () => {
    it("submit → invalid → user tidak edit → tombol tetap disabled & error sama", () => {
      const invalid: FormState = { ...baseValid(), packageQty: "0" };
      // 3× render berturut-turut tanpa perubahan → harus deterministic.
      const r1 = renderScenario(invalid);
      const r2 = renderScenario(invalid);
      const r3 = renderScenario(invalid);
      expect(r1).toBe(r2);
      expect(r2).toBe(r3);
    });

    it("submit invalid → user edit qty valid → tombol enabled, error hilang", () => {
      const invalid = renderScenario({ ...baseValid(), packageQty: "-3" });
      const fixed = renderScenario({ ...baseValid(), packageQty: "3" });

      expect(invalid).toContain(`[BUTTON] Simpan disabled=true`);
      expect(fixed).toContain(`[BUTTON] Simpan disabled=false`);
      // Tidak ada residu error string dari invalid di render valid.
      expect(fixed).toContain(`[VALIDATE] ok=true · error=null`);
      expect(fixed).not.toMatch(/Periksa jumlah & harga/);
    });
  });
});
