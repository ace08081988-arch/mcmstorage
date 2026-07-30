import type {
  BeliDerivedInput,
  BeliDerivedItem,
  BeliPackageType,
  BeliBaseUnit,
} from "./beli-derived";
import type { BeliWarnItem } from "./beli-warnings";

/**
 * Fixture utility untuk item pembelian di test.
 *
 * `BeliItemFixture` adalah bentuk gabungan yang KOMPATIBEL dengan:
 *   - `BeliDerivedItem`  (dipakai `computeBeliDerived`)
 *   - `BeliWarnItem`     (dipakai `computeBeliWarnings`)
 *
 * Tujuannya: satu tempat kanonik yang menjamin shape (mis. `stock_base`,
 * `avg_cost_per_base`) tetap konsisten dengan tipe produksi. Ketika tipe
 * produksi berubah, TypeScript akan langsung menandai fixture ini sehingga
 * test tidak diam-diam menyimpang.
 */
export type BeliItemFixture = BeliDerivedItem &
  BeliWarnItem & {
    id: string;
    package_type: BeliPackageType;
    base_unit: BeliBaseUnit;
    stock_base: number;
    avg_cost_per_base: number;
    name?: string;
  };

const DEFAULT_ITEM: BeliItemFixture = {
  id: "botol-500",
  package_type: "botol",
  package_size: 500,
  base_unit: "g",
  stock_base: 10_000,
  avg_cost_per_base: 20,
};

/** Buat fixture item dengan override yang tetap bertipe. */
export function makeBeliItem(
  over: Partial<BeliItemFixture> = {},
): BeliItemFixture {
  return { ...DEFAULT_ITEM, ...over };
}

const DEFAULT_INPUT: BeliDerivedInput = {
  mode: "existing",
  selectedItem: null,
  newPackageType: "botol",
  newPackageSize: "500",
  packageQty: "2",
  pricePerPackage: "10000",
  priceMode: "package",
  pricePerBase: "",
  inputKarton: false,
};

/** Buat input `computeBeliDerived` dengan override yang tetap bertipe. */
export function makeBeliDerivedInput(
  over: Partial<BeliDerivedInput> = {},
): BeliDerivedInput {
  return { ...DEFAULT_INPUT, ...over };
}

/** Fixture kanonik untuk pemakaian cepat di test. */
export const FIXTURE_ITEM: BeliItemFixture = makeBeliItem();