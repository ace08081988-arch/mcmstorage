import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  computeBeliDerived,
  defaultBaseUnit,
  type BeliPackageType,
  type BeliBaseUnit,
} from "@/lib/beli-derived";

export const Route = createFileRoute("/diagnostik/paket")({
  head: () => ({
    meta: [
      { title: "Diagnostik Paket — MCM" },
      { name: "description", content: "Halaman diagnostik untuk melacak state packageType, displayBaseUnit, displayPackageType, dan label hasil render." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: DiagnostikPaket,
});

type Mode = "new" | "existing";
type PackageType = BeliPackageType;

function DiagnostikPaket() {
  // ------- INPUT STATE (mirror src/routes/_authenticated.gudang.tsx) -------
  const [mode, setMode] = useState<Mode>("new");
  const [packageType, setPackageType] = useState<PackageType>("gram");
  const [packageSize, setPackageSize] = useState<string>("500");
  const [packageQty, setPackageQty] = useState<string>("1");
  const [priceMode, setPriceMode] = useState<"package" | "base">("package");
  const [pricePerPackage, setPricePerPackage] = useState<string>("10000");
  const [pricePerBase, setPricePerBase] = useState<string>("0");
  const [inputKarton, setInputKarton] = useState<boolean>(false);

  // Simulasi selectedItem (mode "existing")
  const [itemPackageType, setItemPackageType] = useState<PackageType>("botol");
  const [itemPackageSize, setItemPackageSize] = useState<string>("600");
  const [itemBaseUnit, setItemBaseUnit] = useState<BeliBaseUnit>("pcs");

  // ------- IMPORT PAYLOAD (untuk E2E & debugging cepat) -------
  const [payloadText, setPayloadText] = useState<string>("");
  const [payloadError, setPayloadError] = useState<string>("");
  // Override display fields — mensimulasikan bug "render stale" di mana
  // label yang tampil tidak sinkron dengan derived. Berguna untuk E2E
  // mismatch banner. Null = pakai perhitungan asli.
  const [displayBaseUnitOverride, setDisplayBaseUnitOverride] =
    useState<BeliBaseUnit | null>(null);
  const [displayPackageTypeOverride, setDisplayPackageTypeOverride] =
    useState<PackageType | null>(null);

  const applyPayload = (raw: string) => {
    try {
      const p = JSON.parse(raw) as Partial<{
        mode: Mode;
        packageType: PackageType;
        packageSize: string | number;
        packageQty: string | number;
        priceMode: "package" | "base";
        pricePerPackage: string | number;
        pricePerBase: string | number;
        inputKarton: boolean;
        selectedItem: {
          package_type?: PackageType;
          package_size?: string | number;
          base_unit?: BeliBaseUnit;
        } | null;
        displayBaseUnitOverride: BeliBaseUnit | null;
        displayPackageTypeOverride: PackageType | null;
      }>;
      if (p.mode) setMode(p.mode);
      if (p.packageType) setPackageType(p.packageType);
      if (p.packageSize !== undefined) setPackageSize(String(p.packageSize));
      if (p.packageQty !== undefined) setPackageQty(String(p.packageQty));
      if (p.priceMode) setPriceMode(p.priceMode);
      if (p.pricePerPackage !== undefined)
        setPricePerPackage(String(p.pricePerPackage));
      if (p.pricePerBase !== undefined)
        setPricePerBase(String(p.pricePerBase));
      if (typeof p.inputKarton === "boolean") setInputKarton(p.inputKarton);
      if (p.selectedItem) {
        if (p.selectedItem.package_type)
          setItemPackageType(p.selectedItem.package_type);
        if (p.selectedItem.package_size !== undefined)
          setItemPackageSize(String(p.selectedItem.package_size));
        if (p.selectedItem.base_unit)
          setItemBaseUnit(p.selectedItem.base_unit);
      }
      // Override eksplisit — reset ke null bila field tidak ada / null.
      if ("displayBaseUnitOverride" in p) {
        setDisplayBaseUnitOverride(p.displayBaseUnitOverride ?? null);
      }
      if ("displayPackageTypeOverride" in p) {
        setDisplayPackageTypeOverride(p.displayPackageTypeOverride ?? null);
      }
      setPayloadError("");
    } catch (e) {
      setPayloadError(e instanceof Error ? e.message : "Payload tidak valid");
    }
  };

  const selectedItem = mode === "existing"
    ? {
        package_type: itemPackageType,
        package_size: Number(itemPackageSize) || 0,
        base_unit: itemBaseUnit,
      }
    : null;

  // ------- DERIVED (identik dengan gudang.tsx) -------
  const derived = useMemo(
    () =>
      computeBeliDerived({
        mode,
        selectedItem,
        newPackageType: packageType,
        newPackageSize: packageSize,
        packageQty,
        pricePerPackage,
        priceMode,
        pricePerBase,
        inputKarton,
      }),
    [
      mode,
      selectedItem,
      packageType,
      packageSize,
      packageQty,
      pricePerPackage,
      priceMode,
      pricePerBase,
      inputKarton,
    ],
  );

  // Display fields — SAMA PERSIS dengan gudang.tsx baris 1712-1720.
  // `*Override` mensimulasikan render stale untuk memicu mismatch banner.
  const displayPackageType: PackageType = displayPackageTypeOverride
    ?? (mode === "existing" && selectedItem
      ? (selectedItem.package_type as PackageType)
      : packageType);
  const displayBaseUnit: BeliBaseUnit = displayBaseUnitOverride
    ?? (mode === "existing" && selectedItem
      ? (selectedItem.base_unit as BeliBaseUnit)
      : defaultBaseUnit(packageType));
  const displayPkgSize: number = mode === "existing" && selectedItem
    ? Number(selectedItem.package_size) || 0
    : (packageType === "pcs" ? 1 : Number(packageSize) || 0);

  // ------- MISMATCH DETECTION -------
  const mismatches: string[] = [];
  if (displayPackageType !== derived.effPackageType) {
    mismatches.push(
      `displayPackageType (${displayPackageType}) ≠ effPackageType (${derived.effPackageType})`,
    );
  }
  if (displayBaseUnit !== derived.effBaseUnit) {
    mismatches.push(
      `displayBaseUnit (${displayBaseUnit}) ≠ effBaseUnit (${derived.effBaseUnit})`,
    );
  }
  const expectedDefaultBase = defaultBaseUnit(displayPackageType);
  if (
    mode === "new" &&
    displayBaseUnit !== expectedDefaultBase
  ) {
    mismatches.push(
      `mode=new: displayBaseUnit (${displayBaseUnit}) tidak sesuai defaultBaseUnit(${displayPackageType})=${expectedDefaultBase}`,
    );
  }

  // ------- STATE JSON (untuk salin) -------
  const snapshot = {
    inputs: {
      mode,
      packageType,
      packageSize,
      packageQty,
      priceMode,
      pricePerPackage,
      pricePerBase,
      inputKarton,
      selectedItem,
    },
    derived,
    display: { displayPackageType, displayBaseUnit, displayPkgSize },
    mismatches,
  };

  const copySnapshot = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 font-sans text-sm text-foreground">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold">Diagnostik Paket</h1>
            <p className="text-xs text-muted-foreground">
              Melacak <code>packageType</code>, <code>displayBaseUnit</code>,{" "}
              <code>displayPackageType</code> dan label render agar mismatch mudah dilihat.
            </p>
          </div>
          <Link
            to="/"
            className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
          >
            ← Beranda
          </Link>
        </header>

        {/* ------- INPUT PANEL ------- */}
        <section className="rounded-lg border p-3">
          <h2 className="mb-2 text-sm font-semibold">Input</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="mode">
              <select
                className="input"
                data-testid="diag-input-mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as Mode)}
              >
                <option value="new">new (Barang baru)</option>
                <option value="existing">existing (Item terpilih)</option>
              </select>
            </Field>

            <Field label="packageType (form)">
              <select
                className="input"
                data-testid="diag-input-package-type"
                value={packageType}
                onChange={(e) => setPackageType(e.target.value as PackageType)}
              >
                <option value="gram">gram</option>
                <option value="pcs">pcs</option>
                <option value="botol">botol</option>
                <option value="sachet">sachet</option>
              </select>
            </Field>

            <Field label="packageSize (form)">
              <input
                className="input"
                inputMode="numeric"
                value={packageSize}
                onChange={(e) => setPackageSize(e.target.value)}
              />
            </Field>

            <Field label="packageQty">
              <input
                className="input"
                inputMode="numeric"
                value={packageQty}
                onChange={(e) => setPackageQty(e.target.value)}
              />
            </Field>

            <Field label="priceMode">
              <select
                className="input"
                data-testid="diag-input-price-mode"
                value={priceMode}
                onChange={(e) => setPriceMode(e.target.value as "package" | "base")}
              >
                <option value="package">package</option>
                <option value="base">base</option>
              </select>
            </Field>

            <Field label="pricePerPackage">
              <input
                className="input"
                inputMode="numeric"
                value={pricePerPackage}
                onChange={(e) => setPricePerPackage(e.target.value)}
              />
            </Field>

            <Field label="pricePerBase">
              <input
                className="input"
                inputMode="numeric"
                value={pricePerBase}
                onChange={(e) => setPricePerBase(e.target.value)}
              />
            </Field>

            <Field label="inputKarton">
              <label className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  checked={inputKarton}
                  onChange={(e) => setInputKarton(e.target.checked)}
                />
                <span className="text-xs">botol → karton</span>
              </label>
            </Field>
          </div>

          {mode === "existing" && (
            <div className="mt-3 rounded-md border border-dashed p-2">
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                Simulasi selectedItem
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Field label="item.package_type">
                  <select
                    className="input"
                    value={itemPackageType}
                    onChange={(e) => setItemPackageType(e.target.value as PackageType)}
                  >
                    <option value="gram">gram</option>
                    <option value="pcs">pcs</option>
                    <option value="botol">botol</option>
                    <option value="sachet">sachet</option>
                  </select>
                </Field>
                <Field label="item.package_size">
                  <input
                    className="input"
                    inputMode="numeric"
                    value={itemPackageSize}
                    onChange={(e) => setItemPackageSize(e.target.value)}
                  />
                </Field>
                <Field label="item.base_unit">
                  <select
                    className="input"
                    value={itemBaseUnit}
                    onChange={(e) => setItemBaseUnit(e.target.value as BeliBaseUnit)}
                  >
                    <option value="g">g</option>
                    <option value="pcs">pcs</option>
                  </select>
                </Field>
              </div>
            </div>
          )}
        </section>

        {/* ------- IMPORT PAYLOAD ------- */}
        <section className="rounded-lg border p-3" data-testid="diag-import-payload">
          <h2 className="mb-2 text-sm font-semibold">Impor payload</h2>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Tempel JSON payload (mode, packageType, packageSize, packageQty,
            priceMode, pricePerPackage, pricePerBase, inputKarton,
            selectedItem) lalu klik <em>Terapkan</em>. Berguna untuk E2E:
            memastikan label render selalu konsisten dengan dropdown Jenis
            kemasan setelah state di-hydrate dari payload.
          </p>
          <textarea
            className="input font-mono"
            rows={4}
            data-testid="diag-payload-input"
            value={payloadText}
            onChange={(e) => setPayloadText(e.target.value)}
            placeholder='{"mode":"new","packageType":"gram","packageSize":"500","packageQty":"2","pricePerPackage":"10000"}'
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="diag-payload-apply"
              onClick={() => applyPayload(payloadText)}
              className="rounded-md border bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              Terapkan
            </button>
            {payloadError ? (
              <span
                className="text-[11px] text-red-600 dark:text-red-400"
                data-testid="diag-payload-error"
              >
                {payloadError}
              </span>
            ) : null}
          </div>
        </section>

        {/* ------- MISMATCH ALERT ------- */}
        {mismatches.length > 0 ? (
          <section
            className="rounded-lg border border-red-500/60 bg-red-500/10 p-3 text-red-700 dark:text-red-300"
            data-testid="diag-mismatch"
          >
            <h2 className="text-sm font-semibold">⚠ Mismatch terdeteksi</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
              {mismatches.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </section>
        ) : (
          <section
            className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 p-3 text-emerald-700 dark:text-emerald-300"
            data-testid="diag-ok"
          >
            <span className="text-xs font-medium">✓ display fields konsisten dengan derived</span>
          </section>
        )}

        {/* ------- STATE TABLE ------- */}
        <section className="rounded-lg border">
          <h2 className="border-b bg-muted/30 px-3 py-2 text-sm font-semibold">State</h2>
          <div className="divide-y text-xs">
            <Row label="mode" value={mode} />
            <Row label="packageType (form)" value={packageType} />
            <Row label="packageSize (form)" value={packageSize} />
            <Row label="selectedItem" value={selectedItem ? JSON.stringify(selectedItem) : "null"} />
          </div>
        </section>

        <section className="rounded-lg border">
          <h2 className="border-b bg-muted/30 px-3 py-2 text-sm font-semibold">
            Derived (computeBeliDerived)
          </h2>
          <div className="divide-y text-xs">
            <Row label="effPackageType" value={derived.effPackageType} data-testid="diag-eff-package-type" />
            <Row label="effBaseUnit" value={derived.effBaseUnit} data-testid="diag-eff-base-unit" />
            <Row label="effectivePkgSize" value={String(derived.effectivePkgSize)} />
            <Row label="kartonActive" value={String(derived.kartonActive)} />
            <Row label="pkgQ" value={String(derived.pkgQ)} />
            <Row label="price" value={String(derived.price)} />
            <Row label="baseAdded" value={String(derived.baseAdded)} />
            <Row label="totalCost" value={String(derived.totalCost)} />
          </div>
        </section>

        <section className="rounded-lg border">
          <h2 className="border-b bg-muted/30 px-3 py-2 text-sm font-semibold">Display</h2>
          <div className="divide-y text-xs">
            <Row
              label="displayPackageType"
              value={displayPackageType}
              data-testid="diag-display-package-type"
            />
            <Row
              label="displayBaseUnit"
              value={displayBaseUnit}
              data-testid="diag-display-base-unit"
            />
            <Row
              label="displayPkgSize"
              value={String(displayPkgSize)}
              data-testid="diag-display-pkg-size"
            />
          </div>
        </section>

        {/* ------- RENDERED LABELS ------- */}
        <section className="rounded-lg border">
          <h2 className="border-b bg-muted/30 px-3 py-2 text-sm font-semibold">
            Label hasil render (persis seperti di /gudang)
          </h2>
          <div className="space-y-2 p-3 text-xs">
            <LabelRow
              location="Isi / kemasan"
              rendered={`Isi / kemasan (${displayBaseUnit})`}
              testid="diag-label-isi"
            />
            <LabelRow
              location="Harga beli"
              rendered={`Harga beli / ${derived.kartonActive ? "karton" : displayPackageType} (Rp)`}
              testid="diag-label-harga-beli"
            />
            <LabelRow
              location="Harga per (base)"
              rendered={`Harga per ${displayBaseUnit} (Rp)`}
              testid="diag-label-harga-per-base"
            />
            <LabelRow
              location="Harga per (package)"
              rendered={`Harga per ${displayPackageType}`}
              testid="diag-label-harga-per-pkg"
            />
            <LabelRow
              location="Info stok"
              rendered={`Stok disimpan dalam ${displayBaseUnit}. Saat dijual per ${displayBaseUnit}, akan dikurangi otomatis.`}
              testid="diag-label-info"
            />
            <LabelRow
              location="Ringkasan · yang tersedia"
              rendered={
                displayPackageType !== "pcs"
                  ? `${Number(packageQty) || 0} ${displayPackageType} · ${displayPkgSize} ${displayBaseUnit}`
                  : `${Number(packageQty) || 0} ${displayPackageType}`
              }
              testid="diag-label-ringkasan"
            />
          </div>
        </section>

        {/* ------- ACTIONS ------- */}
        <section className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={copySnapshot}
            className="rounded-md border bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            Salin snapshot JSON
          </button>
          <Link
            to="/gudang"
            className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
          >
            Buka /gudang (kirim yang sesungguhnya)
          </Link>
        </section>

        <details className="rounded-lg border p-3 text-xs">
          <summary className="cursor-pointer font-semibold">Snapshot JSON</summary>
          <pre
            className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-[11px] leading-snug"
            data-testid="diag-snapshot-json"
          >
{JSON.stringify(snapshot, null, 2)}
          </pre>
        </details>
      </div>

      <style>{`
        .input {
          width: 100%;
          border-radius: 6px;
          border: 1px solid hsl(var(--border));
          background: hsl(var(--background));
          padding: 4px 8px;
          font-size: 12px;
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function Row({
  label,
  value,
  ...rest
}: {
  label: string;
  value: string;
  "data-testid"?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5">
      <span className="font-mono text-[11px] text-muted-foreground">{label}</span>
      <span className="font-mono text-[11px] font-medium" {...rest}>
        {value}
      </span>
    </div>
  );
}

function LabelRow({
  location,
  rendered,
  testid,
}: {
  location: string;
  rendered: string;
  testid: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-l-2 border-primary/40 pl-2">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {location}
      </span>
      <span className="font-mono text-[11px]" data-testid={testid}>
        “{rendered}”
      </span>
    </div>
  );
}