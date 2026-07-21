import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/metrik-query")({
  component: MetrikQueryPage,
  head: () => ({
    meta: [{ title: "Metrik Query — MCM Storage" }],
  }),
});

type Row = {
  query_name: string;
  day: string;
  samples: number;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
  avg_rows: number | null;
};

const KNOWN = [
  { name: "ecer_prep_aktif_list", label: "Ecer — daftar prep aktif" },
  { name: "request_prep_aktif_badge_count", label: "Request — badge count aktif" },
];

function MetrikQueryPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString();
      const { data, error } = await sb
        .from("query_metrics_daily_v1")
        .select("query_name,day,samples,avg_ms,p50_ms,p95_ms,max_ms,avg_rows")
        .gte("day", since)
        .order("day", { ascending: false })
        .order("query_name");
      if (error) throw error;
      setRows((data ?? []) as Row[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const byQuery = new Map<string, Row[]>();
  for (const r of rows ?? []) {
    const arr = byQuery.get(r.query_name) ?? [];
    arr.push(r);
    byQuery.set(r.query_name, arr);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Metrik Query</h1>
          <p className="text-xs text-muted-foreground">
            Latensi query hot-path per hari (14 hari terakhir, sampling 20%).
            Hanya data akun Anda.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
          Segarkan
        </button>
      </div>

      {err && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          Gagal memuat: {err}
        </div>
      )}

      {KNOWN.map((q) => {
        const list = byQuery.get(q.name) ?? [];
        return (
          <section key={q.name} className="rounded-md border bg-card">
            <header className="border-b p-3">
              <h2 className="text-sm font-semibold">{q.label}</h2>
              <p className="text-xs text-muted-foreground">
                <code className="rounded bg-muted px-1 py-0.5 text-[10px]">{q.name}</code>
              </p>
            </header>
            {list.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">
                {rows === null ? "Memuat…" : "Belum ada sampel."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="p-2 font-medium">Tanggal</th>
                      <th className="p-2 text-right font-medium">Sampel</th>
                      <th className="p-2 text-right font-medium">Avg</th>
                      <th className="p-2 text-right font-medium">p50</th>
                      <th className="p-2 text-right font-medium">p95</th>
                      <th className="p-2 text-right font-medium">Maks</th>
                      <th className="p-2 text-right font-medium">Ø baris</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.day} className="border-t">
                        <td className="p-2 whitespace-nowrap">
                          {new Date(r.day).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })}
                        </td>
                        <td className="p-2 text-right tabular-nums">{r.samples}</td>
                        <td className="p-2 text-right tabular-nums">{r.avg_ms} ms</td>
                        <td className="p-2 text-right tabular-nums">{r.p50_ms} ms</td>
                        <td className="p-2 text-right tabular-nums font-semibold">{r.p95_ms} ms</td>
                        <td className="p-2 text-right tabular-nums text-muted-foreground">{r.max_ms} ms</td>
                        <td className="p-2 text-right tabular-nums text-muted-foreground">
                          {r.avg_rows ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      <p className="text-[10px] text-muted-foreground">
        Data lebih dari 14 hari otomatis diringkas/dibersihkan. Ubah sampling
        via <code>setQueryMetricsSampleRate()</code> untuk debug lokal.
      </p>
    </div>
  );
}