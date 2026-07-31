import {
  ResponsiveContainer,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Bar,
  Line,
} from "recharts";

export type TrenItem = {
  label: string;
  omzet: number;
  beratKg: number;
};

const rupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);

export function RingkasanChart({ data }: { data: TrenItem[] }) {
  return (
    <div className="w-full min-w-0 h-64 sm:h-72 md:h-80">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="label" stroke="#94a3b8" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={16} />
          <YAxis
            yAxisId="left"
            stroke="#34d399"
            tick={{ fontSize: 10 }}
            width={44}
            tickFormatter={(v) =>
              v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}jt` : v >= 1000 ? `${(v / 1000).toFixed(0)}rb` : `${v}`
            }
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke="#60a5fa"
            tick={{ fontSize: 10 }}
            width={36}
            tickFormatter={(v) => `${v}kg`}
          />
          <Tooltip
            contentStyle={{
              background: "#0f172a",
              border: "1px solid #334155",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: "#e2e8f0" }}
            formatter={(value: number, name: string) => {
              if (name === "Omzet") return [rupiah(value), name];
              if (name === "Berat (kg)")
                return [`${value.toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg`, name];
              return [value, name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
          <Bar yAxisId="left" dataKey="omzet" name="Omzet" fill="#10b981" radius={[4, 4, 0, 0]} />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="beratKg"
            name="Berat (kg)"
            stroke="#60a5fa"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
