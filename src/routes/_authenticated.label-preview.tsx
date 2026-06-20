import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { jsPDF } from "jspdf";

  component: LabelPreviewPage,
});

/* ----------- Helper format (mirror dari gudang.tsx) ----------- */
function rupiah(n: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n || 0);
}
function fmtBase(n: number, u: "g" | "pcs") {
  const v = Number(n) || 0;
  if (u === "g") {
    if (Math.abs(v) >= 1000) {
      return `${(v / 1000).toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg`;
    }
    return `${v.toLocaleString("id-ID", { maximumFractionDigits: 2 })} g`;
  }
  return `${v.toLocaleString("id-ID")} pcs`;
}
function fmtQtyDual(
  baseQty: number,
  baseUnit: "g" | "pcs",
  packageType: string,
  packageSize: number,
  mode: "base" | "package",
) {
  if (mode === "base" || !packageType || packageType === "pcs" || packageSize <= 0) {
    return fmtBase(baseQty, baseUnit);
  }
  const pkgQty = baseQty / packageSize;
  const pkgStr = `${pkgQty.toLocaleString("id-ID", { maximumFractionDigits: 2 })} ${packageType}`;
  return `${pkgStr} (= ${fmtBase(baseQty, baseUnit)})`;
}
function fmtItemQty(
  baseQty: number,
  item: { base_unit: "g" | "pcs"; package_type: string; package_size: number },
) {
  const mode: "base" | "package" =
    item.package_type && item.package_type !== "pcs" && item.package_size > 0
      ? "package"
      : "base";
  return fmtQtyDual(baseQty, item.base_unit, item.package_type, item.package_size, mode);
}
function fmtItemPrice(
  pricePerBase: number,
  item: { base_unit: "g" | "pcs"; package_type: string; package_size: number },
) {
  if (item.package_type && item.package_type !== "pcs" && item.package_size > 0) {
    const perPkg = pricePerBase * item.package_size;
    return `${rupiah(perPkg)}/${item.package_type} (= ${rupiah(pricePerBase)}/${item.base_unit})`;
  }
  return `${rupiah(pricePerBase)}/${item.base_unit}`;
}

/* ----------- Sample data: semua kombinasi ----------- */
type Sample = {
  name: string;
  base_unit: "g" | "pcs";
  package_type: string;
  package_size: number;
  stock_base: number;
  qty_base: number;
  price_per_base: number;
};

const DEFAULT_SAMPLES: Sample[] = [
  // base = pcs, tanpa kemasan
  { name: "Pulpen (pcs)", base_unit: "pcs", package_type: "pcs", package_size: 1, stock_base: 250, qty_base: 12, price_per_base: 2500 },
  // base = pcs, ada kemasan botol
  { name: "Sirup botol", base_unit: "pcs", package_type: "botol", package_size: 100, stock_base: 5600, qty_base: 300, price_per_base: 500 },
  // base = pcs, kemasan dus besar
  { name: "Mie instan dus", base_unit: "pcs", package_type: "dus", package_size: 40, stock_base: 1000, qty_base: 80, price_per_base: 3000 },
  // base = g, kemasan sak (kg-an)
  { name: "Tepung sak", base_unit: "g", package_type: "sak", package_size: 25000, stock_base: 125000, qty_base: 50000, price_per_base: 12 },
  // base = g, tanpa kemasan (curah)
  { name: "Gula curah", base_unit: "g", package_type: "pcs", package_size: 1, stock_base: 750, qty_base: 250, price_per_base: 18 },
  // base = g, kemasan kecil (sachet)
  { name: "Kopi sachet", base_unit: "g", package_type: "sachet", package_size: 20, stock_base: 4000, qty_base: 60, price_per_base: 80 },
  // Stok pecahan (cek kemasan tidak bulat)
  { name: "Minyak (sisa pecahan)", base_unit: "g", package_type: "botol", package_size: 1000, stock_base: 2350, qty_base: 500, price_per_base: 25 },
];

function LabelPreviewPage() {
  const [samples, setSamples] = useState<Sample[]>(DEFAULT_SAMPLES);

  const update = (idx: number, patch: Partial<Sample>) =>
    setSamples((arr) => arr.map((s, i) => (i === idx ? { ...s, ...patch } : s)));

  const renderSampleOnDoc = (doc: jsPDF, s: Sample, startY: number) => {
    const hasPkg = s.package_type && s.package_type !== "pcs" && s.package_size > 0;
    const left = 15;
    let y = startY;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Preview Label", left, y);
    y += 7;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(
      `Item: ${s.name}${hasPkg ? ` (${s.package_type} ${s.package_size} ${s.base_unit})` : ""}`,
      left,
      y,
    );
    y += 6;
    doc.text(
      `Base unit: ${s.base_unit}  •  Kemasan: ${s.package_type || "-"}  •  Isi/kemasan: ${s.package_size}`,
      left,
      y,
    );
    y += 10;

    const rows: [string, string][] = [
      ["Nama + kemasan", `${s.name}${hasPkg ? ` (${s.package_type} ${s.package_size} ${s.base_unit})` : ""}`],
      ["fmtItemQty(stok)", fmtItemQty(s.stock_base, s)],
      ["fmtItemQty(qty trx)", fmtItemQty(s.qty_base, s)],
      ["fmtItemPrice(harga/base)", fmtItemPrice(s.price_per_base, s)],
      ["fmtQtyDual mode=base", fmtQtyDual(s.qty_base, s.base_unit, s.package_type, s.package_size, "base")],
      ["fmtQtyDual mode=package", fmtQtyDual(s.qty_base, s.base_unit, s.package_type, s.package_size, "package")],
      ["fmtBase(stok)", fmtBase(s.stock_base, s.base_unit)],
      ["Total harga trx", `${rupiah(s.price_per_base * s.qty_base)} (${fmtItemQty(s.qty_base, s)} × ${fmtItemPrice(s.price_per_base, s)})`],
    ];

    doc.setFontSize(10);
    const labelW = 55;
    const valW = 180 - left - labelW;
    rows.forEach(([label, val]) => {
      doc.setFont("helvetica", "bold");
      doc.text(label, left, y);
      doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(val, valW);
      doc.text(lines, left + labelW, y);
      y += Math.max(6, lines.length * 5);
      if (y > 280) {
        doc.addPage();
        y = 18;
      }
    });

    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(
      `Dibuat ${new Date().toLocaleString("id-ID")}`,
      left,
      290,
    );
    doc.setTextColor(0);
  };

  const buildPdfForSample = (s: Sample) => {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    renderSampleOnDoc(doc, s, 18);
    const safe = s.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    doc.save(`label-preview-${safe || "sample"}.pdf`);
  };

  const exportAll = () => {
    if (samples.length === 0) return;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    samples.forEach((s, i) => {
      if (i > 0) doc.addPage();
      renderSampleOnDoc(doc, s, 18);
    });
    doc.save(`label-preview-semua-${samples.length}-sampel.pdf`);
  };

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Preview Label Stok / Harga / Kuantitas</h1>
          <p className="text-sm text-muted-foreground">
            Cek cepat format label di semua kombinasi unit (kemasan vs unit dasar) sebelum rilis.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportAll}
            className="text-sm px-3 py-1.5 rounded-md border hover:bg-muted"
          >
            ⬇︎ Ekspor semua PDF
          </button>
          <Link
            to="/gudang"
            className="text-sm px-3 py-1.5 rounded-md border hover:bg-muted"
          >
            ← Ke Gudang
          </Link>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        Sumber helper: <code>fmtBase</code>, <code>fmtQtyDual</code>, <code>fmtItemQty</code>,{" "}
        <code>fmtItemPrice</code> (mirror dari <code>_authenticated.gudang.tsx</code>).
      </div>

      <div className="grid gap-3">
        {samples.map((s, idx) => {
          const hasPkg = s.package_type && s.package_type !== "pcs" && s.package_size > 0;
          return (
            <div key={idx} className="rounded-lg border p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">
                  {s.name}
                  {hasPkg ? (
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      · {s.package_type} {s.package_size} {s.base_unit}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => buildPdfForSample(s)}
                  className="text-xs px-2 py-1 rounded-md border hover:bg-muted"
                >
                  ⬇︎ Ekspor PDF
                </button>
              </div>
              {/* Editor */}
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-sm">
                <label className="col-span-2 flex flex-col">
                  <span className="text-xs text-muted-foreground">Nama</span>
                  <input
                    className="border rounded px-2 py-1"
                    value={s.name}
                    onChange={(e) => update(idx, { name: e.target.value })}
                  />
                </label>
                <label className="flex flex-col">
                  <span className="text-xs text-muted-foreground">Base unit</span>
                  <select
                    className="border rounded px-2 py-1"
                    value={s.base_unit}
                    onChange={(e) => update(idx, { base_unit: e.target.value as "g" | "pcs" })}
                  >
                    <option value="pcs">pcs</option>
                    <option value="g">g</option>
                  </select>
                </label>
                <label className="flex flex-col">
                  <span className="text-xs text-muted-foreground">Kemasan</span>
                  <input
                    className="border rounded px-2 py-1"
                    value={s.package_type}
                    onChange={(e) => update(idx, { package_type: e.target.value })}
                  />
                </label>
                <label className="flex flex-col">
                  <span className="text-xs text-muted-foreground">Isi/kemasan</span>
                  <input
                    type="number"
                    className="border rounded px-2 py-1"
                    value={s.package_size}
                    onChange={(e) => update(idx, { package_size: Number(e.target.value) || 0 })}
                  />
                </label>
                <label className="flex flex-col">
                  <span className="text-xs text-muted-foreground">Stok (base)</span>
                  <input
                    type="number"
                    className="border rounded px-2 py-1"
                    value={s.stock_base}
                    onChange={(e) => update(idx, { stock_base: Number(e.target.value) || 0 })}
                  />
                </label>
                <label className="flex flex-col">
                  <span className="text-xs text-muted-foreground">Qty trx (base)</span>
                  <input
                    type="number"
                    className="border rounded px-2 py-1"
                    value={s.qty_base}
                    onChange={(e) => update(idx, { qty_base: Number(e.target.value) || 0 })}
                  />
                </label>
                <label className="flex flex-col">
                  <span className="text-xs text-muted-foreground">Harga / base</span>
                  <input
                    type="number"
                    className="border rounded px-2 py-1"
                    value={s.price_per_base}
                    onChange={(e) => update(idx, { price_per_base: Number(e.target.value) || 0 })}
                  />
                </label>
              </div>

              {/* Output */}
              <div className="grid md:grid-cols-2 gap-2 text-sm bg-muted/40 rounded p-3">
                <Row label="Nama + kemasan (judul item)">
                  {s.name}
                  {hasPkg ? ` (${s.package_type} ${s.package_size} ${s.base_unit})` : ""}
                </Row>
                <Row label="fmtItemQty(stok)">{fmtItemQty(s.stock_base, s)}</Row>
                <Row label="fmtItemQty(qty trx)">{fmtItemQty(s.qty_base, s)}</Row>
                <Row label="fmtItemPrice(harga/base)">{fmtItemPrice(s.price_per_base, s)}</Row>
                <Row label="fmtQtyDual mode=base">
                  {fmtQtyDual(s.qty_base, s.base_unit, s.package_type, s.package_size, "base")}
                </Row>
                <Row label="fmtQtyDual mode=package">
                  {fmtQtyDual(s.qty_base, s.base_unit, s.package_type, s.package_size, "package")}
                </Row>
                <Row label="fmtBase(stok)">{fmtBase(s.stock_base, s.base_unit)}</Row>
                <Row label="Total harga trx">
                  {rupiah(s.price_per_base * s.qty_base)}{" "}
                  <span className="text-muted-foreground">
                    ({fmtItemQty(s.qty_base, s)} × {fmtItemPrice(s.price_per_base, s)})
                  </span>
                </Row>
              </div>
            </div>
          );
        })}
      </div>

      <SummaryMatrix samples={samples} />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium break-words">{children}</span>
    </div>
  );
}

function SummaryMatrix({ samples }: { samples: Sample[] }) {
  const rows = useMemo(
    () =>
      samples.map((s) => ({
        name: s.name,
        stok: fmtItemQty(s.stock_base, s),
        qty: fmtItemQty(s.qty_base, s),
        harga: fmtItemPrice(s.price_per_base, s),
      })),
    [samples],
  );
  return (
    <div className="rounded-lg border overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-left">
          <tr>
            <th className="p-2">Item</th>
            <th className="p-2">Stok</th>
            <th className="p-2">Qty trx</th>
            <th className="p-2">Harga</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              <td className="p-2 font-medium">{r.name}</td>
              <td className="p-2">{r.stok}</td>
              <td className="p-2">{r.qty}</td>
              <td className="p-2">{r.harga}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}