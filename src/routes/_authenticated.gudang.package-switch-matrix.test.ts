import { describe, it, expect, beforeEach } from "vitest";
import {
  computeBeliDerived,
  __resetBeliDerivedMemo,
  defaultBaseUnit,
  type BeliPackageType,
} from "@/lib/beli-derived";
import { beliResetKey } from "@/lib/beli-reset-key";
import { BOTOL_PER_KARTON, rupiah, fmtBase, fmtItemQty } from "@/lib/stock-format";

/**
 * Matriks pergantian Jenis kemasan untuk form Catat Pembelian:
 * setiap pasangan (from → to) diuji supaya
 *  (a) label form (Isi/kemasan, Stok disimpan dalam, Jumlah kemasan,
 *      Harga beli /…, toggle Harga per …, toggle Karton),
 *  (b) panel Ringkasan (header, Jumlah kemasan, Tambahan stok, Harga per …),
 *  (c) angka turunan (effectivePkgSize, baseAdded, price, totalCost),
 * seluruhnya ikut pilihan TERBARU dan tidak menyisakan artefak lama.
 */

type PT = BeliPackageType;
const ALL: PT[] = ["gram", "botol", "pcs", "sachet"];

type PtItem = {
  name: string;
  package_type: PT;
  package_size: number;
  base_unit: "g" | "pcs";
};
const ITEM: Record<PT, PtItem> = {
  gram: { name: "Gula Curah", package_type: "gram", package_size: 1000, base_unit: "g" },
  botol: { name: "Sirup Botol", package_type: "botol", package_size: 500, base_unit: "g" },
  pcs: { name: "Sikat", package_type: "pcs", package_size: 1, base_unit: "pcs" },
  sachet: { name: "Kopi Sachet", package_type: "sachet", package_size: 20, base_unit: "g" },
};

function createScreen(mode: "existing" | "new") {
  const state = {
    mode,
    itemId: "botol" as PT,
    newPackageType: "botol" as PT,
    newPackageSize: "500",
    packageQty: "1",
    pricePerPackage: "10000",
    priceMode: "package" as "package" | "base",
    pricePerBase: "",
    inputKarton: false,
  };
  let lastKey = beliResetKey({
    mode: state.mode,
    itemId: state.itemId,
    packageType: state.newPackageType,
  });

  function commit() {
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
      const it = state.mode === "existing" ? ITEM[state.itemId] : null;
      state.priceMode =
        state.mode === "existing"
          ? it && it.package_type === "pcs"
            ? "base"
            : "package"
          : state.newPackageType === "pcs"
            ? "base"
            : "package";
    }
    // Karton-guard: pcs tak boleh punya priceMode=package; hanya botol boleh karton.
    const it = state.mode === "existing" ? ITEM[state.itemId] : null;
    if (it) {
      if (it.package_type !== "botol" && state.inputKarton) state.inputKarton = false;
      if (it.package_type === "pcs" && state.priceMode !== "base") state.priceMode = "base";
    }
  }

  function derive() {
    return computeBeliDerived({
      mode: state.mode,
      selectedItem: state.mode === "existing" ? ITEM[state.itemId] : null,
      newPackageType: state.newPackageType,
      newPackageSize: state.newPackageSize,
      packageQty: state.packageQty,
      pricePerPackage: state.pricePerPackage,
      priceMode: state.priceMode,
      pricePerBase: state.pricePerBase,
      inputKarton: state.inputKarton,
    });
  }

  function renderAll(): string {
    const d = derive();
    const it = state.mode === "existing" ? ITEM[state.itemId] : null;
    const lines: string[] = [];
    // FORM
    if (d.effPackageType !== "pcs") lines.push(`FORM: Isi / kemasan (${d.effBaseUnit})`);
    lines.push(`FORM: Stok disimpan dalam ${d.effBaseUnit}.`);
    lines.push(`FORM: Jumlah ${d.kartonActive ? "karton" : "kemasan"}`);
    if (state.priceMode === "package") {
      lines.push(`FORM: Harga beli / ${d.kartonActive ? "karton" : d.effPackageType} (Rp)`);
    } else {
      lines.push(`FORM: Harga beli / ${d.effBaseUnit} (Rp)`);
    }
    if (d.effPackageType === "botol") lines.push(`FORM: Toggle "Input dalam karton"`);
    if (d.effPackageType !== "pcs") {
      lines.push(`FORM: [toggle] Harga per ${d.effPackageType}`);
      lines.push(`FORM: [toggle] Harga per ${d.effBaseUnit}`);
    }
    // RINGKASAN
    const header = it
      ? `${it.name} · ${d.effPackageType}${d.effPackageType !== "pcs" ? ` ${d.effectivePkgSize} ${d.effBaseUnit}` : ""}`
      : `Barang baru · ${d.effPackageType}${d.effPackageType !== "pcs" ? ` ${d.effectivePkgSize} ${d.effBaseUnit}` : ""}`;
    lines.push(`SUM: Ringkasan | ${header}`);
    lines.push(
      `SUM: Jumlah kemasan | ${d.pkgQ.toLocaleString("id-ID")} ${d.effPackageType}${
        d.kartonActive
          ? ` (${(d.pkgQ / BOTOL_PER_KARTON).toLocaleString("id-ID")} karton)`
          : ""
      }`,
    );
    lines.push(`SUM: Tambahan stok | ${it ? fmtItemQty(d.baseAdded, it) : fmtBase(d.baseAdded, d.effBaseUnit)}`);
    lines.push(`SUM: Harga per ${d.effPackageType} | ${rupiah(d.price)}`);
    if (d.effPackageType !== "pcs" && d.baseAdded > 0) {
      lines.push(`SUM: Harga per ${d.effBaseUnit} | ${rupiah(d.totalCost / d.baseAdded)}`);
    }
    return lines.join("\n");
  }

  return {
    state,
    derive,
    renderAll,
    switchTo(pt: PT) {
      if (mode === "existing") state.itemId = pt;
      else state.newPackageType = pt;
      commit();
    },
    setPackageSize(v: string) {
      state.newPackageSize = v;
    },
    setInputs(qty: string, price: string) {
      state.packageQty = qty;
      state.pricePerPackage = price;
    },
  };
}

/** Regex satuan lain yang TIDAK boleh muncul saat target adalah `to`. */
function forbiddenLabels(to: PT): RegExp[] {
  const others = ALL.filter((p) => p !== to);
  const targetBase = defaultBaseUnit(to);
  const patterns: RegExp[] = [];
  for (const o of others) {
    // "pcs" adalah baik packageType maupun label base unit — jangan
    // larang bila kebetulan sama dengan base unit target (mis. target
    // botol/sachet punya base "pcs" sehingga "Harga per pcs" sah).
    if (o === targetBase) continue;
    // "Harga per botol" / "[toggle] Harga per botol" / "Harga beli / botol"
    patterns.push(new RegExp(`Harga per ${o}\\b`));
    patterns.push(new RegExp(`Harga beli / ${o}\\b`));
    // Header ringkasan: "· botol 500 g" ← angka bebas
    patterns.push(new RegExp(`· ${o}\\b`));
  }
  // Base unit lawan (g vs pcs) tidak boleh muncul sebagai label satuan isi/stok.
  const oppositeBase = targetBase === "g" ? "pcs" : "g";
  patterns.push(new RegExp(`Isi / kemasan \\(${oppositeBase}\\)`));
  patterns.push(new RegExp(`Stok disimpan dalam ${oppositeBase}\\.`));
  // Header ringkasan tidak boleh menyertakan base unit lawan.
  if (to !== "pcs") {
    patterns.push(new RegExp(`· ${to} \\d+ ${oppositeBase}\\b`));
  }
  return patterns;
}

function assertNoArtifacts(rendered: string, to: PT) {
  for (const rx of forbiddenLabels(to)) {
    expect(rendered, `expected no ${rx} for target ${to}:\n${rendered}`).not.toMatch(rx);
  }
}

function assertTargetLabels(rendered: string, to: PT) {
  const base = defaultBaseUnit(to);
  if (to !== "pcs") {
    expect(rendered).toContain(`FORM: Isi / kemasan (${base})`);
    expect(rendered).toContain(`FORM: [toggle] Harga per ${to}`);
    expect(rendered).toContain(`FORM: [toggle] Harga per ${base}`);
  }
  expect(rendered).toContain(`FORM: Stok disimpan dalam ${base}.`);
  // Ringkasan selalu memuat "· <to>" di header.
  expect(rendered).toMatch(new RegExp(`SUM: Ringkasan \\| .*· ${to}\\b`));
  // Jumlah kemasan ikut label target.
  expect(rendered).toMatch(new RegExp(`SUM: Jumlah kemasan \\| .*${to}\\b`));
  // Karton toggle hanya untuk botol.
  if (to === "botol") {
    expect(rendered).toContain(`FORM: Toggle "Input dalam karton"`);
  } else {
    expect(rendered).not.toContain(`FORM: Toggle "Input dalam karton"`);
  }
}

describe("Matriks pergantian Jenis kemasan (Barang baru) — semua field ikut, tanpa artefak lama", () => {
  beforeEach(() => __resetBeliDerivedMemo());

  for (const from of ALL) {
    for (const to of ALL) {
      if (from === to) continue;
      it(`new: ${from} → ${to}`, () => {
        const s = createScreen("new");
        // 1) prime state di `from` dengan angka non-default supaya artefak lebih mudah terdeteksi.
        s.state.newPackageType = from;
        s.setPackageSize(from === "pcs" ? "1" : from === "sachet" ? "20" : from === "gram" ? "1000" : "500");
        s.setInputs("7", "13579");
        // 2) pindah ke `to`.
        s.switchTo(to);
        // 3) setelah reset effect, isi angka baru supaya baris "Harga per base" muncul.
        s.setPackageSize(to === "pcs" ? "1" : to === "sachet" ? "20" : to === "gram" ? "1000" : "500");
        s.setInputs("2", "8000");

        const rendered = s.renderAll();
        assertTargetLabels(rendered, to);
        assertNoArtifacts(rendered, to);

        // Verifikasi angka: baseAdded & totalCost bersih.
        const d = s.derive();
        const size = to === "pcs" ? 1 : to === "sachet" ? 20 : to === "gram" ? 1000 : 500;
        expect(d.effPackageType).toBe(to);
        expect(d.effBaseUnit).toBe(defaultBaseUnit(to));
        expect(d.effectivePkgSize).toBe(size);
        expect(d.pkgQ).toBe(2);
        expect(d.baseAdded).toBe(2 * size);
        expect(d.totalCost).toBe(2 * 8000);
      });
    }
  }
});

describe("Matriks pergantian item (Barang yang ada) — label & angka ikut item terbaru", () => {
  beforeEach(() => __resetBeliDerivedMemo());

  for (const from of ALL) {
    for (const to of ALL) {
      if (from === to) continue;
      it(`existing: ${from} → ${to}`, () => {
        const s = createScreen("existing");
        s.state.itemId = from;
        // Sinkronkan lastKey ke posisi awal (from) — hindari reset saat prime.
        s.state.packageQty = "5";
        s.state.pricePerPackage = "99999";

        s.switchTo(to);
        // Isi ulang qty+harga setelah reset.
        s.state.packageQty = "3";
        s.state.pricePerPackage = to === "pcs" ? "" : "4000";
        if (to === "pcs") {
          s.state.pricePerBase = "4000";
          s.state.priceMode = "base";
        }

        const rendered = s.renderAll();
        assertTargetLabels(rendered, to);
        // Header memakai NAMA item baru — tidak menyisakan nama lama.
        expect(rendered).toContain(ITEM[to].name);
        for (const other of ALL) {
          if (other !== to) expect(rendered).not.toContain(ITEM[other].name);
        }
        assertNoArtifacts(rendered, to);

        const d = s.derive();
        const it = ITEM[to];
        expect(d.effPackageType).toBe(it.package_type);
        expect(d.effBaseUnit).toBe(it.base_unit);
        expect(d.effectivePkgSize).toBe(it.package_type === "pcs" ? 1 : it.package_size);
        expect(d.baseAdded).toBe(3 * (it.package_type === "pcs" ? 1 : it.package_size));
      });
    }
  }
});

describe("Round-trip gram ↔ botol/pcs/sachet — tidak menahan artefak dari langkah sebelumnya", () => {
  beforeEach(() => __resetBeliDerivedMemo());

  const roundTrips: PT[][] = [
    ["gram", "botol", "gram"],
    ["gram", "pcs", "gram"],
    ["gram", "sachet", "gram"],
    ["botol", "gram", "botol"],
    ["pcs", "gram", "pcs"],
    ["sachet", "gram", "sachet"],
  ];

  for (const [a, b, c] of roundTrips) {
    it(`new: ${a} → ${b} → ${c}`, () => {
      const s = createScreen("new");
      const seq: PT[] = [a, b, c];
      const renders: string[] = [];
      for (const pt of seq) {
        s.switchTo(pt);
        s.setPackageSize(pt === "pcs" ? "1" : pt === "sachet" ? "20" : pt === "gram" ? "1000" : "500");
        s.setInputs("2", "5000");
        renders.push(s.renderAll());
      }
      // Setiap render bersih untuk target di langkah tsb.
      renders.forEach((r, i) => {
        assertTargetLabels(r, seq[i]);
        assertNoArtifacts(r, seq[i]);
      });
      // Render awal (a) dan akhir (c=a) menghasilkan struktur label yang IDENTIK
      // (buktinya tidak ada state yang bocor melintasi loop).
      expect(renders[0]).toBe(renders[2]);
    });
  }
});