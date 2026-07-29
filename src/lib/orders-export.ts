/**
 * SSOT ekspor daftar pesanan + total penjualan per status.
 *
 * Angka nilai penjualan mengikuti aturan `src/lib/sold-total.ts`:
 * pakai `sold_total`, dan bila 0/kosong pakai jumlah `sales.total_revenue`
 * dari baris penjualan yang berasal dari paket itu (`source` + `source_id`).
 * Piutang = nilai penjualan − yang sudah dibayar (tidak pernah negatif).
 *
 * Modul ini murni membaca & memformat — tidak mengubah data apa pun.
 */
import { supabase } from "@/integrations/supabase/client";
import { rupiah } from "@/lib/stock-format";
import { resolveSoldTotal, type SoldSource } from "@/lib/sold-total";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export type OrderCategory = "Request" | "Ecer" | "Siapkan Sendiri";
export type OrderStatus = "Siap" | "Terkirim";

export type OrderExportRow = {
  kategori: OrderCategory;
  status: OrderStatus;
  nama: string;
  pihak: string;
  metode: string;
  dibuat: string;
  terkirim: string;
  total: number;
  dibayar: number;
  piutang: number;
  dariCatatanPenjualan: boolean;
};

export type OrderStatusSummary = {
  kategori: OrderCategory;
  status: OrderStatus;
  jumlah: number;
  total: number;
  dibayar: number;
  piutang: number;
};

export type OrdersExportData = {
  generatedAt: Date;
  rows: OrderExportRow[];
  summary: OrderStatusSummary[];
  totals: { jumlah: number; total: number; dibayar: number; piutang: number };
};

const num = (v: unknown) => Number(v) || 0;

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString("id-ID");
}

/** Total penjualan per paket dari tabel `sales` (fallback `sold_total` = 0). */
async function salesTotalsBySource(source: SoldSource): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const { data } = await sb
    .from("sales")
    .select("source_id,total_revenue")
    .eq("source", source);
  for (const r of (data ?? []) as Array<{ source_id: string | null; total_revenue: unknown }>) {
    if (!r.source_id) continue;
    map.set(r.source_id, (map.get(r.source_id) ?? 0) + num(r.total_revenue));
  }
  return map;
}

function buildRow(
  kategori: OrderCategory,
  nama: string,
  r: {
    sold_at?: string | null;
    sold_total?: unknown;
    sold_paid_amount?: unknown;
    sold_payment_method?: string | null;
    sold_party_name?: string | null;
    created_at?: string | null;
    status?: string | null;
    sent_at?: string | null;
    id: string;
  },
  salesTotals: Map<string, number>,
): OrderExportRow {
  const sold = Boolean(r.sold_at) || r.status === "sent";
  const resolved = resolveSoldTotal(r.sold_total as number, salesTotals.get(r.id) ?? 0);
  const dibayar = num(r.sold_paid_amount);
  return {
    kategori,
    status: sold ? "Terkirim" : "Siap",
    nama,
    pihak: r.sold_party_name ?? "-",
    metode: r.sold_payment_method ?? "-",
    dibuat: fmtDate(r.created_at),
    terkirim: fmtDate(r.sold_at ?? r.sent_at ?? null),
    total: resolved.total,
    dibayar,
    piutang: Math.max(resolved.total - dibayar, 0),
    dariCatatanPenjualan: resolved.fromSales,
  };
}

export async function fetchOrdersExportData(): Promise<OrdersExportData> {
  const [reqSales, ecerSales, selfSales] = await Promise.all([
    salesTotalsBySource("request_prep"),
    salesTotalsBySource("ecer_prep"),
    salesTotalsBySource("self_prep"),
  ]);

  const [reqRes, ecerRes, selfRes, reqTitles, ecerTitles] = await Promise.all([
    sb
      .from("request_preparations")
      .select(
        "id,title_id,created_at,sold_at,sold_total,sold_paid_amount,sold_payment_method,sold_party_name",
      )
      .order("created_at", { ascending: false }),
    sb
      .from("ecer_preparations")
      .select(
        "id,title_id,created_at,sold_at,sold_total,sold_paid_amount,sold_payment_method,sold_party_name",
      )
      .order("created_at", { ascending: false }),
    sb
      .from("self_prep_items")
      .select(
        "id,title,status,created_at,sent_at,sold_at,sold_total,sold_paid_amount,sold_payment_method",
      )
      .order("created_at", { ascending: false }),
    sb.from("request_titles").select("id,name"),
    sb.from("ecer_titles").select("id,name"),
  ]);

  const nameOf = (rows: Array<{ id: string; name: string }> | null) =>
    new Map((rows ?? []).map((t) => [t.id, t.name]));
  const reqName = nameOf(reqTitles?.data);
  const ecerName = nameOf(ecerTitles?.data);

  const rows: OrderExportRow[] = [
    ...((reqRes?.data ?? []) as Array<Record<string, unknown> & { id: string }>).map((r) =>
      buildRow("Request", reqName.get(String(r.title_id)) ?? "(tanpa judul)", r, reqSales),
    ),
    ...((ecerRes?.data ?? []) as Array<Record<string, unknown> & { id: string }>).map((r) =>
      buildRow("Ecer", ecerName.get(String(r.title_id)) ?? "(tanpa judul)", r, ecerSales),
    ),
    ...((selfRes?.data ?? []) as Array<Record<string, unknown> & { id: string }>).map((r) =>
      buildRow("Siapkan Sendiri", String(r.title ?? "(tanpa judul)"), r, selfSales),
    ),
  ];

  const summary: OrderStatusSummary[] = [];
  for (const kategori of ["Request", "Ecer", "Siapkan Sendiri"] as OrderCategory[]) {
    for (const status of ["Siap", "Terkirim"] as OrderStatus[]) {
      const group = rows.filter((r) => r.kategori === kategori && r.status === status);
      summary.push({
        kategori,
        status,
        jumlah: group.length,
        total: group.reduce((s, r) => s + r.total, 0),
        dibayar: group.reduce((s, r) => s + r.dibayar, 0),
        piutang: group.reduce((s, r) => s + r.piutang, 0),
      });
    }
  }

  return {
    generatedAt: new Date(),
    rows,
    summary,
    totals: {
      jumlah: rows.length,
      total: rows.reduce((s, r) => s + r.total, 0),
      dibayar: rows.reduce((s, r) => s + r.dibayar, 0),
      piutang: rows.reduce((s, r) => s + r.piutang, 0),
    },
  };
}

const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

/** CSV ramah Excel id-ID: pemisah `;`, angka mentah tanpa format. */
export function buildOrdersCsv(data: OrdersExportData): string {
  const lines: string[] = [];
  lines.push(esc("Daftar Pesanan & Total Penjualan per Status"));
  lines.push(esc(`Dibuat: ${data.generatedAt.toLocaleString("id-ID")}`));
  lines.push(esc("Sumber angka: sold_total dengan fallback catatan penjualan (SSOT)"));
  lines.push("");
  lines.push(["Kategori", "Status", "Jumlah", "Total penjualan", "Dibayar", "Piutang"].map(esc).join(";"));
  for (const s of data.summary) {
    lines.push(
      [s.kategori, s.status, s.jumlah, Math.round(s.total), Math.round(s.dibayar), Math.round(s.piutang)]
        .map(esc)
        .join(";"),
    );
  }
  lines.push(
    ["TOTAL", "", data.totals.jumlah, Math.round(data.totals.total), Math.round(data.totals.dibayar), Math.round(data.totals.piutang)]
      .map(esc)
      .join(";"),
  );
  lines.push("");
  lines.push(
    [
      "Kategori",
      "Status",
      "Nama",
      "Pihak",
      "Metode",
      "Dibuat",
      "Terkirim",
      "Total penjualan",
      "Dibayar",
      "Piutang",
      "Sumber angka",
    ]
      .map(esc)
      .join(";"),
  );
  for (const r of data.rows) {
    lines.push(
      [
        r.kategori,
        r.status,
        r.nama,
        r.pihak,
        r.metode,
        r.dibuat,
        r.terkirim,
        Math.round(r.total),
        Math.round(r.dibayar),
        Math.round(r.piutang),
        r.dariCatatanPenjualan ? "catatan penjualan" : "paket",
      ]
        .map(esc)
        .join(";"),
    );
  }
  return lines.join("\r\n");
}

export function ordersExportFilename(at: Date, ext: "csv" | "xls"): string {
  const p = (v: number) => String(v).padStart(2, "0");
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}`;
  return `daftar-pesanan-${stamp}.${ext}`;
}

function htmlEsc(v: string | number): string {
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Excel (.xls) berbasis tabel HTML — dibuka native di Excel/WPS tanpa dependensi. */
export function buildOrdersExcelHtml(data: OrdersExportData): string {
  const sumRows = data.summary
    .map(
      (s) =>
        `<tr><td>${htmlEsc(s.kategori)}</td><td>${htmlEsc(s.status)}</td><td>${s.jumlah}</td><td>${Math.round(s.total)}</td><td>${Math.round(s.dibayar)}</td><td>${Math.round(s.piutang)}</td></tr>`,
    )
    .join("");
  const detailRows = data.rows
    .map(
      (r) =>
        `<tr><td>${htmlEsc(r.kategori)}</td><td>${htmlEsc(r.status)}</td><td>${htmlEsc(r.nama)}</td><td>${htmlEsc(r.pihak)}</td><td>${htmlEsc(r.metode)}</td><td>${htmlEsc(r.dibuat)}</td><td>${htmlEsc(r.terkirim)}</td><td>${Math.round(r.total)}</td><td>${Math.round(r.dibayar)}</td><td>${Math.round(r.piutang)}</td></tr>`,
    )
    .join("");
  return `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8" /></head><body>
<h3>Daftar Pesanan &amp; Total Penjualan per Status</h3>
<p>Dibuat: ${htmlEsc(data.generatedAt.toLocaleString("id-ID"))}</p>
<table border="1"><thead><tr><th>Kategori</th><th>Status</th><th>Jumlah</th><th>Total penjualan</th><th>Dibayar</th><th>Piutang</th></tr></thead><tbody>${sumRows}
<tr><td><b>TOTAL</b></td><td></td><td>${data.totals.jumlah}</td><td>${Math.round(data.totals.total)}</td><td>${Math.round(data.totals.dibayar)}</td><td>${Math.round(data.totals.piutang)}</td></tr></tbody></table>
<br/>
<table border="1"><thead><tr><th>Kategori</th><th>Status</th><th>Nama</th><th>Pihak</th><th>Metode</th><th>Dibuat</th><th>Terkirim</th><th>Total penjualan</th><th>Dibayar</th><th>Piutang</th></tr></thead><tbody>${detailRows}</tbody></table>
</body></html>`;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportOrdersCsv(data: OrdersExportData): void {
  download(
    new Blob(["\uFEFF" + buildOrdersCsv(data)], { type: "text/csv;charset=utf-8" }),
    ordersExportFilename(data.generatedAt, "csv"),
  );
}

export function exportOrdersExcel(data: OrdersExportData): void {
  download(
    new Blob(["\uFEFF" + buildOrdersExcelHtml(data)], {
      type: "application/vnd.ms-excel;charset=utf-8",
    }),
    ordersExportFilename(data.generatedAt, "xls"),
  );
}

export const fmtRupiah = rupiah;