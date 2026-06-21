import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { jsPDF } from "jspdf";

export const Route = createFileRoute("/_authenticated/label-preview")({
  head: () => ({
    meta: [
      { title: "Pratinjau Label · MCM Storage" },
    ],
  }),
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

  // Layout: A4 portrait, 2 kolom × 4 baris = 8 label/halaman
  const PAGE = { w: 210, h: 297, margin: 12, gap: 6, cols: 2, rows: 4 };
  const CARD_W = (PAGE.w - PAGE.margin * 2 - PAGE.gap * (PAGE.cols - 1)) / PAGE.cols;
  const CARD_H = (PAGE.h - PAGE.margin * 2 - 14 /*header*/ - 8 /*footer*/ - PAGE.gap * (PAGE.rows - 1)) / PAGE.rows;

  const drawPageChrome = (doc: jsPDF, pageNo: number, totalPages: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(30);
    doc.text("Pratinjau Label · MCM Storage", PAGE.margin, PAGE.margin + 4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);
    const dateStr = new Date().toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
    doc.text(dateStr, PAGE.w - PAGE.margin, PAGE.margin + 4, { align: "right" });
    // separator
    doc.setDrawColor(220);
    doc.setLineWidth(0.2);
    doc.line(PAGE.margin, PAGE.margin + 6, PAGE.w - PAGE.margin, PAGE.margin + 6);
    // footer
    doc.setTextColor(140);
    doc.text(`Halaman ${pageNo} / ${totalPages}`, PAGE.w / 2, PAGE.h - PAGE.margin + 2, { align: "center" });
    doc.setTextColor(0);
  };

  const drawLabelCard = (doc: jsPDF, s: Sample, x: number, y: number, w: number, h: number) => {
    const hasPkg = !!(s.package_type && s.package_type !== "pcs" && s.package_size > 0);
    // card border
    doc.setDrawColor(210);
    doc.setFillColor(252, 252, 253);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, w, h, 2, 2, "FD");

    const pad = 4;
    let cy = y + pad + 4;

    // Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(20);
    const titleLines = doc.splitTextToSize(s.name, w - pad * 2);
    doc.text(titleLines.slice(0, 1), x + pad, cy);
    cy += 5;

    // Subtitle (kemasan)
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(110);
    const sub = hasPkg
      ? `${s.package_type} · isi ${s.package_size} ${s.base_unit}`
      : `satuan: ${s.base_unit}`;
    doc.text(sub, x + pad, cy);
    cy += 4;

    // divider
    doc.setDrawColor(230);
    doc.line(x + pad, cy, x + w - pad, cy);
    cy += 4;

    // Key/value pairs — bersih, tanpa nama fungsi
    const total = s.price_per_base * s.qty_base;
    const pairs: [string, string][] = [
      ["Stok", fmtItemQty(s.stock_base, s)],
      ["Kuantitas", fmtItemQty(s.qty_base, s)],
      ["Harga", fmtItemPrice(s.price_per_base, s)],
      ["Total", rupiah(total)],
    ];

    doc.setFontSize(8.5);
    const labelW = 18;
    const valW = w - pad * 2 - labelW;
    pairs.forEach(([k, v]) => {
      doc.setFont("helvetica", "normal");
      doc.setTextColor(120);
      doc.text(k, x + pad, cy);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(25);
      const lines = doc.splitTextToSize(v, valW);
      doc.text(lines.slice(0, 2), x + pad + labelW, cy);
      cy += Math.min(2, lines.length) * 3.6 + 1.2;
    });

    doc.setTextColor(0);
  };

  const renderSamplesGrid = (doc: jsPDF, list: Sample[]) => {
    const perPage = PAGE.cols * PAGE.rows;
    const totalPages = Math.max(1, Math.ceil(list.length / perPage));
    list.forEach((s, i) => {
      const pageIdx = Math.floor(i / perPage);
      const slot = i % perPage;
      if (slot === 0 && pageIdx > 0) doc.addPage();
      if (slot === 0) drawPageChrome(doc, pageIdx + 1, totalPages);
      const col = slot % PAGE.cols;
      const row = Math.floor(slot / PAGE.cols);
      const x = PAGE.margin + col * (CARD_W + PAGE.gap);
      const y = PAGE.margin + 10 + row * (CARD_H + PAGE.gap);
      drawLabelCard(doc, s, x, y, CARD_W, CARD_H);
    });
  };

  const buildPdfForSample = (s: Sample) => {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    renderSamplesGrid(doc, [s]);
    const safe = s.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    doc.save(`label-${safe || "sampel"}.pdf`);
  };

  const exportAll = () => {
    if (samples.length === 0) return;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    renderSamplesGrid(doc, samples);
    doc.save(`label-preview-${samples.length}-sampel.pdf`);
  };

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto space-y-5">
      <header className="rounded-xl border bg-card p-4 sm:p-6 shadow-sm">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:gap-4">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight truncate">
              Pratinjau Label
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              Cek tampilan label stok, harga, dan kuantitas pada berbagai
              kombinasi kemasan sebelum dicetak.
            </p>
          </div>
          <Link
            to="/gudang"
            className="shrink-0 text-xs sm:text-sm px-3 py-2 rounded-md border hover:bg-muted whitespace-nowrap"
          >
            ← Gudang
          </Link>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportAll}
            className="text-xs sm:text-sm px-3 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 whitespace-nowrap"
          >
            ⬇ Ekspor semua PDF
          </button>
          <span className="text-xs text-muted-foreground self-center">
            {samples.length} sampel siap dicetak
          </span>
        </div>
      </header>

      <div className="grid gap-4">
        {samples.map((s, idx) => {
          const hasPkg = s.package_type && s.package_type !== "pcs" && s.package_size > 0;
          return (
            <div key={idx} className="rounded-xl border p-3 sm:p-5 space-y-4 bg-card shadow-sm">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <div className="text-sm font-medium min-w-0 truncate">
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
                  className="shrink-0 text-xs px-2.5 py-1.5 rounded-md border hover:bg-muted whitespace-nowrap"
                >
                  ⬇ PDF
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
              <div className="grid md:grid-cols-2 gap-3 text-sm bg-muted/40 rounded-md p-3 border">
                <Row label="Judul item">
                  {s.name}
                  {hasPkg ? ` (${s.package_type} ${s.package_size} ${s.base_unit})` : ""}
                </Row>
                <Row label="Stok tersedia">{fmtItemQty(s.stock_base, s)}</Row>
                <Row label="Kuantitas transaksi">{fmtItemQty(s.qty_base, s)}</Row>
                <Row label="Harga satuan">{fmtItemPrice(s.price_per_base, s)}</Row>
                <Row label="Kuantitas (tampilan dasar)">
                  {fmtQtyDual(s.qty_base, s.base_unit, s.package_type, s.package_size, "base")}
                </Row>
                <Row label="Kuantitas (tampilan kemasan)">
                  {fmtQtyDual(s.qty_base, s.base_unit, s.package_type, s.package_size, "package")}
                </Row>
                <Row label="Stok (unit dasar)">{fmtBase(s.stock_base, s.base_unit)}</Row>
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
    <div className="rounded-xl border overflow-x-auto bg-card shadow-sm">
      <table className="w-full text-sm min-w-[520px]">
        <thead className="bg-muted/60 text-left">
          <tr>
            <th className="p-3 font-medium">Item</th>
            <th className="p-3 font-medium">Stok</th>
            <th className="p-3 font-medium">Qty trx</th>
            <th className="p-3 font-medium">Harga</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              <td className="p-3 font-medium whitespace-nowrap">{r.name}</td>
              <td className="p-3 whitespace-nowrap">{r.stok}</td>
              <td className="p-3 whitespace-nowrap">{r.qty}</td>
              <td className="p-3 whitespace-nowrap">{r.harga}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}