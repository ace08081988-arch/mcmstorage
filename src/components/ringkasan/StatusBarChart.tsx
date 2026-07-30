/**
 * Chart batang "pesanan per status" untuk halaman Ringkasan.
 *
 * Dipisah ke modul sendiri supaya `recharts` (~300 kB) tidak ikut bundel
 * awal route. Route memuatnya lewat `React.lazy`, jadi kartu statistik di
 * atas chart tetap muncul instan di Android WebView walau chunk chart
 * belum selesai diunduh.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { rupiah } from "@/lib/stock-format";

const BAR_COLORS = ["hsl(var(--primary))", "hsl(var(--chart-2, var(--primary)))"];

export type StatusBarRow = {
  label: string;
  jumlah: number;
  total: number;
  piutang: number;
};

export function StatusBarChart({ data }: { data: readonly StatusBarRow[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data as StatusBarRow[]} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10 }}
          interval={0}
          angle={-18}
          textAnchor="end"
          height={54}
        />
        <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
        <Tooltip
          formatter={(v: number, _n, p) =>
            [`${v} pesanan · ${rupiah(Number(p?.payload?.total) || 0)}`, "Jumlah"] as [
              string,
              string,
            ]
          }
        />
        <Bar dataKey="jumlah" radius={[6, 6, 0, 0]}>
          {data.map((row, i) => (
            <Cell key={row.label} fill={BAR_COLORS[i % BAR_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default StatusBarChart;
