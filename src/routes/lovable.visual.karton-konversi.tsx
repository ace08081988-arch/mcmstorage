import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { fmtItemQty, BOTOL_PER_KARTON } from "@/lib/stock-format";

/**
 * Harness publik no-auth untuk E2E konversi karton di kolom Stok gudang.
 *
 * Merender `fmtItemQty` (util yang dipakai kartu Stok di /gudang) untuk
 * synthetic StockItemLike agar E2E dapat memverifikasi bahwa input
 * stock_base tertentu — mis. 100 botol untuk item botol-per-pcs seperti
 * GS — otomatis dihitung menjadi "1 karton" dan tampil konsisten.
 */
export const Route = createFileRoute("/lovable/visual/karton-konversi")({
  head: () => ({
    meta: [
      { title: "Karton Konversi (harness) — MCM" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: KartonKonversiHarness,
});

type PT = "botol" | "gram" | "pcs" | "sachet";
type BU = "g" | "pcs";

function KartonKonversiHarness() {
  const [stockBase, setStockBase] = useState<string>("100");
  const [packageType, setPackageType] = useState<PT>("botol");
  const [packageSize, setPackageSize] = useState<string>("1");
  const [baseUnit, setBaseUnit] = useState<BU>("pcs");
  const [name, setName] = useState<string>("GS");

  const item = useMemo(
    () => ({
      name,
      base_unit: baseUnit,
      package_type: packageType,
      package_size: Number(packageSize) || 0,
    }),
    [name, baseUnit, packageType, packageSize],
  );
  const rendered = fmtItemQty(Number(stockBase) || 0, item);

  return (
    <div className="min-h-screen bg-background p-ms-4 font-sans text-ms-sm text-foreground">
      <div className="mx-auto max-w-xl space-ms-3">
        <h1 className="text-ms-lg font-semibold">Harness: Konversi Karton</h1>
        <p className="text-ms-xs text-muted-foreground">
          Merender <code>fmtItemQty</code> untuk verifikasi E2E bahwa 100
          botol otomatis dihitung menjadi 1 karton pada kolom Stok.
          Aturan: 1 karton = {BOTOL_PER_KARTON} botol.
        </p>

        <div className="grid grid-cols-2 gap-ms-2 rounded-lg border p-ms-3">
          <label className="block">
            <span className="text-ms-2xs text-muted-foreground">stock_base</span>
            <input
              className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5"
              inputMode="numeric"
              data-testid="kk-stock-base"
              value={stockBase}
              onChange={(e) => setStockBase(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-ms-2xs text-muted-foreground">name</span>
            <input
              className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5"
              data-testid="kk-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-ms-2xs text-muted-foreground">package_type</span>
            <select
              className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5"
              data-testid="kk-package-type"
              value={packageType}
              onChange={(e) => setPackageType(e.target.value as PT)}
            >
              <option value="botol">botol</option>
              <option value="gram">gram</option>
              <option value="pcs">pcs</option>
              <option value="sachet">sachet</option>
            </select>
          </label>
          <label className="block">
            <span className="text-ms-2xs text-muted-foreground">package_size</span>
            <input
              className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5"
              inputMode="numeric"
              data-testid="kk-package-size"
              value={packageSize}
              onChange={(e) => setPackageSize(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-ms-2xs text-muted-foreground">base_unit</span>
            <select
              className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5"
              data-testid="kk-base-unit"
              value={baseUnit}
              onChange={(e) => setBaseUnit(e.target.value as BU)}
            >
              <option value="pcs">pcs</option>
              <option value="g">g</option>
            </select>
          </label>
        </div>

        <div className="rounded-lg border p-ms-3">
          <div className="text-ms-2xs text-muted-foreground">
            Kolom Stok (fmtItemQty)
          </div>
          <div
            className="mt-1 font-semibold tabular-nums"
            data-testid="kk-stok-render"
          >
            {rendered}
          </div>
        </div>
      </div>
    </div>
  );
}