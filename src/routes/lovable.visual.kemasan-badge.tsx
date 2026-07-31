import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { fmtItemQty, BOTOL_PER_KARTON } from "@/lib/stock-format";
import { KemasanKonversiBadge } from "@/components/KemasanKonversiBadge";
import { KemasanRumusPopover } from "@/components/KemasanRumusPopover";

/**
 * Harness publik no-auth untuk E2E badge & popover breakdown konversi
 * kemasan di halaman /gudang. Merender:
 *   - <KemasanKonversiBadge> untuk mode base/package/karton
 *   - <KemasanRumusPopover> yang berisi hint "1 karton = 100 botol" dan
 *     baris "Hitungan saat ini"
 *   - fmtItemQty(qty_base) untuk memverifikasi konsistensi antara badge
 *     karton dan kolom Stok gudang
 */
export const Route = createFileRoute("/lovable/visual/kemasan-badge")({
  head: () => ({
    meta: [
      { title: "Kemasan Badge (harness) — MCM" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: KemasanBadgeHarness,
});

type PT = "botol" | "gram" | "pcs" | "sachet";
type BU = "g" | "pcs";
type Mode = "base" | "package" | "karton";

function KemasanBadgeHarness() {
  const [packageType, setPackageType] = useState<PT>("botol");
  const [packageSize, setPackageSize] = useState<string>("1");
  const [baseUnit, setBaseUnit] = useState<BU>("pcs");
  const [qty, setQty] = useState<string>("1");
  const [mode, setMode] = useState<Mode>("karton");

  const n = Number(qty) || 0;
  const ps = Number(packageSize) || 1;

  // stok_base "ekuivalen" untuk mode karton: N karton = N × BOTOL_PER_KARTON botol
  // Kita render fmtItemQty(qty_base_botol) supaya badge karton konsisten
  // dengan kolom Stok gudang untuk item botol-per-pcs.
  const stokBase = useMemo(() => {
    if (mode === "karton" && packageType === "botol") return n * BOTOL_PER_KARTON;
    if (mode === "package") return n * ps;
    return n;
  }, [mode, packageType, n, ps]);

  const item = {
    name: "GS",
    base_unit: baseUnit,
    package_type: packageType,
    package_size: ps,
  };

  return (
    <div className="min-h-screen bg-background p-ms-4 font-sans text-ms-sm text-foreground">
      <div className="mx-auto max-w-xl space-ms-3">
        <h1 className="text-ms-lg font-semibold">
          Harness: Kemasan Badge &amp; Popover
        </h1>

        <div className="grid grid-cols-2 gap-ms-2 rounded-lg border p-ms-3">
          <label className="block">
            <span className="text-ms-2xs text-muted-foreground">package_type</span>
            <select
              className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5"
              data-testid="kb-package-type"
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
              data-testid="kb-package-size"
              value={packageSize}
              onChange={(e) => setPackageSize(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-ms-2xs text-muted-foreground">base_unit</span>
            <select
              className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5"
              data-testid="kb-base-unit"
              value={baseUnit}
              onChange={(e) => setBaseUnit(e.target.value as BU)}
            >
              <option value="pcs">pcs</option>
              <option value="g">g</option>
            </select>
          </label>
          <label className="block">
            <span className="text-ms-2xs text-muted-foreground">qty</span>
            <input
              className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5"
              inputMode="numeric"
              data-testid="kb-qty"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-ms-2xs text-muted-foreground">mode</span>
            <select
              className="mt-1 w-full rounded-md border bg-background px-ms-2 py-1.5"
              data-testid="kb-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
            >
              <option value="base">base</option>
              <option value="package">package</option>
              <option value="karton">karton</option>
            </select>
          </label>
        </div>

        <div className="rounded-lg border p-ms-3">
          <div className="text-ms-2xs text-muted-foreground">Popover trigger (hint)</div>
          <div className="mt-1">
            <KemasanRumusPopover
              packageType={packageType}
              packageSize={ps}
              baseUnit={baseUnit}
              qty={n}
              mode={mode}
              testId="kb-rumus-trigger"
            >
              <span>ℹ️ Rumus konversi</span>
            </KemasanRumusPopover>
          </div>
        </div>

        <div className="rounded-lg border p-ms-3">
          <div className="text-ms-2xs text-muted-foreground">Badge breakdown</div>
          <div className="mt-1">
            <KemasanKonversiBadge
              packageType={packageType}
              packageSize={ps}
              baseUnit={baseUnit}
              qty={n}
              mode={mode}
              testId="kb-badge"
            />
          </div>
        </div>

        <div className="rounded-lg border p-ms-3">
          <div className="text-ms-2xs text-muted-foreground">
            fmtItemQty(stok_base) — Kolom Stok gudang
          </div>
          <div
            className="mt-1 font-semibold tabular-nums"
            data-testid="kb-stok-render"
          >
            {fmtItemQty(stokBase, item)}
          </div>
        </div>
      </div>
    </div>
  );
}