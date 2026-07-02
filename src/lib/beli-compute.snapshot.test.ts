import { describe, it, expect, beforeEach } from "vitest";
import {
  computeBeliDerived,
  __resetBeliDerivedMemo,
  type BeliDerivedInput,
} from "@/lib/beli-derived";
import { computeBeliWarnings } from "@/lib/beli-warnings";

// ============================================================
// Snapshot tests untuk `computeBeliDerived` + `computeBeliWarnings`.
// Tujuan: mendeteksi perubahan output yang TIDAK disengaja lintas
// mode ("existing" / "new") dan itemId (botol/gram/pcs/sachet).
//
// Fixture bersifat deterministik dan tidak mengandung field non-
// efektif yang berisik (updated_at, name berubah, dll) supaya
// snapshot stabil. Bila ada perubahan formula/format pesan yang
// disengaja, jalankan `bunx vitest run -u` untuk memperbarui.
// ============================================================

type PT = "botol" | "gram" | "pcs" | "sachet";
type Item = {
  id: string;
  package_type: PT;
  package_size: number;
  base_unit: "g" | "pcs";
  stock_base: number;
  avg_cost_per_base: number;
};

const ITEMS: Record<string, Item> = {
  "botol-500": {
    id: "botol-500",
    package_type: "botol",
    package_size: 500,
    base_unit: "g",
    stock_base: 10_000,
    avg_cost_per_base: 20,
  },
  "gram-1000": {
    id: "gram-1000",
    package_type: "gram",
    package_size: 1000,
    base_unit: "g",
    stock_base: 5_000,
    avg_cost_per_base: 15,
  },
  "pcs-1": {
    id: "pcs-1",
    package_type: "pcs",
    package_size: 1,
    base_unit: "pcs",
    stock_base: 200,
    avg_cost_per_base: 3000,
  },
  "sachet-10": {
    id: "sachet-10",
    package_type: "sachet",
    package_size: 10,
    base_unit: "g",
    stock_base: 800,
    avg_cost_per_base: 50,
  },
};

function makeInput(
  mode: "existing" | "new",
  item: Item | null,
  over: Partial<BeliDerivedInput> = {},
): BeliDerivedInput {
  return {
    mode,
    selectedItem: mode === "existing" ? item : null,
    newPackageType: item?.package_type ?? "botol",
    newPackageSize: String(item?.package_size ?? 500),
    packageQty: "2",
    pricePerPackage: "10000",
    priceMode: "package",
    pricePerBase: "",
    inputKarton: false,
    ...over,
  };
}

beforeEach(() => {
  __resetBeliDerivedMemo();
});

describe("snapshot: computeBeliDerived lintas mode × itemId", () => {
  it("mode existing — semua itemId", () => {
    const rows = Object.values(ITEMS).map((item) => ({
      id: item.id,
      out: computeBeliDerived(makeInput("existing", item)),
    }));
    expect(rows).toMatchSnapshot();
  });

  it("mode new — semua packageType", () => {
    const rows = (["botol", "gram", "pcs", "sachet"] as PT[]).map((pt) => ({
      packageType: pt,
      out: computeBeliDerived(
        makeInput("new", null, {
          newPackageType: pt,
          newPackageSize: pt === "gram" ? "1000" : pt === "sachet" ? "10" : "500",
        }),
      ),
    }));
    expect(rows).toMatchSnapshot();
  });

  it("existing × karton aktif (hanya berlaku untuk botol)", () => {
    const rows = Object.values(ITEMS).map((item) => ({
      id: item.id,
      out: computeBeliDerived(
        makeInput("existing", item, { inputKarton: true, packageQty: "1" }),
      ),
    }));
    expect(rows).toMatchSnapshot();
  });

  it("existing × priceMode='base'", () => {
    const rows = Object.values(ITEMS).map((item) => ({
      id: item.id,
      out: computeBeliDerived(
        makeInput("existing", item, { priceMode: "base", pricePerBase: "25" }),
      ),
    }));
    expect(rows).toMatchSnapshot();
  });
});

describe("snapshot: computeBeliWarnings lintas mode × itemId", () => {
  it("mode existing — warnings default (harga normal, qty 2)", () => {
    const rows = Object.values(ITEMS).map((item) => {
      const inp = makeInput("existing", item);
      const derived = computeBeliDerived(inp);
      return {
        id: item.id,
        warnings: computeBeliWarnings({
          mode: "existing",
          selectedItem: item,
          derived,
          priceMode: "package",
          inputKarton: false,
        }),
      };
    });
    expect(rows).toMatchSnapshot();
  });

  it("mode existing — pemicu PRICE_PER_BASE_HIGH (harga 3× rata-rata)", () => {
    const rows = Object.values(ITEMS).map((item) => {
      const highPrice = String(item.avg_cost_per_base * item.package_size * 3);
      const inp = makeInput("existing", item, { pricePerPackage: highPrice });
      const derived = computeBeliDerived(inp);
      return {
        id: item.id,
        warnings: computeBeliWarnings({
          mode: "existing",
          selectedItem: item,
          derived,
          priceMode: "package",
          inputKarton: false,
        }),
      };
    });
    expect(rows).toMatchSnapshot();
  });

  it("mode existing — pemicu QTY_ZERO / PRICE_ZERO", () => {
    const rows = Object.values(ITEMS).map((item) => {
      const inp = makeInput("existing", item, {
        packageQty: "0",
        pricePerPackage: "0",
      });
      const derived = computeBeliDerived(inp);
      return {
        id: item.id,
        warnings: computeBeliWarnings({
          mode: "existing",
          selectedItem: item,
          derived,
          priceMode: "package",
          inputKarton: false,
        }),
      };
    });
    expect(rows).toMatchSnapshot();
  });

  it("mode existing — KARTON_ON_NON_BOTOL untuk item non-botol", () => {
    const nonBotol = [ITEMS["gram-1000"], ITEMS["pcs-1"], ITEMS["sachet-10"]];
    const rows = nonBotol.map((item) => {
      const inp = makeInput("existing", item, { inputKarton: true });
      const derived = computeBeliDerived(inp);
      return {
        id: item.id,
        warnings: computeBeliWarnings({
          mode: "existing",
          selectedItem: item,
          derived,
          priceMode: "package",
          inputKarton: true,
        }),
      };
    });
    expect(rows).toMatchSnapshot();
  });

  it("mode new — warnings default (tanpa selectedItem)", () => {
    const rows = (["botol", "gram", "pcs", "sachet"] as PT[]).map((pt) => {
      const inp = makeInput("new", null, {
        newPackageType: pt,
        newPackageSize: pt === "gram" ? "1000" : pt === "sachet" ? "10" : "500",
      });
      const derived = computeBeliDerived(inp);
      return {
        packageType: pt,
        warnings: computeBeliWarnings({
          mode: "new",
          selectedItem: null,
          derived,
          priceMode: "package",
          inputKarton: false,
        }),
      };
    });
    expect(rows).toMatchSnapshot();
  });
});