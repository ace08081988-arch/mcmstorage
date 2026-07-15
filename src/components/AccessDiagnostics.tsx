/**
 * Diagnostik RLS otomatis per area izin.
 *
 * Menjalankan satu probe SELECT ringan (LIMIT 1) untuk tabel perwakilan
 * tiap area sebagai user yang login (Data API + RLS aktif). Hasilnya
 * memperlihatkan kode error persis (42501 / PGRST301 / 401 / 403) beserta
 * policy yang berlaku. Sengaja pakai supabase-js client (bukan
 * server-fn) supaya identitas caller = user sekarang; policy
 * `is_chat_only(auth.uid())` dievaluasi apa adanya.
 */
import { useState } from "react";
import { CheckCircle2, XCircle, Loader2, ShieldQuestion, PlayCircle } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type AreaKey =
  | "chat"
  | "gudang"
  | "penjualan"
  | "hutang_piutang"
  | "penyiapan"
  | "pos_kasir";

type ProbeResult = {
  key: AreaKey;
  label: string;
  table: string;
  query: string;
  policy: string;
  ok: boolean;
  code: string | null;
  status: number | null;
  message: string | null;
  rows: number | null;
  ms: number;
};

type ProbeSpec = {
  key: AreaKey;
  label: string;
  table: string;
  query: string;
  policy: string;
  run: () => Promise<{
    data: unknown[] | null;
    error: { code?: string; message?: string; details?: string; hint?: string } | null;
    status?: number;
  }>;
};

/**
 * Probe list — satu tabel perwakilan per area. Query semuanya
 * `select('id').limit(1)` sehingga hemat & tidak membocorkan data lain
 * pengguna (RLS tetap saring baris milik user).
 */
const PROBES: ProbeSpec[] = [
  {
    key: "chat",
    label: "Komunikasi (Chat)",
    table: "conversations",
    query: "select id from conversations limit 1",
    policy: "auth.uid() = user_id (tanpa cek chat_only)",
    run: async () => await supabase.from("conversations").select("id").limit(1),
  },
  {
    key: "gudang",
    label: "Gudang & Stok",
    table: "warehouse_items",
    query: "select id from warehouse_items limit 1",
    policy: "user_id = auth.uid() AND NOT is_chat_only(auth.uid())",
    run: async () => await supabase.from("warehouse_items").select("id").limit(1),
  },
  {
    key: "penjualan",
    label: "Penjualan",
    table: "sales",
    query: "select id from sales limit 1",
    policy: "user_id = auth.uid() AND NOT is_chat_only(auth.uid())",
    run: async () => await supabase.from("sales").select("id").limit(1),
  },
  {
    key: "hutang_piutang",
    label: "Hutang & Piutang",
    table: "debts",
    query: "select id from debts limit 1",
    policy: "user_id = auth.uid() AND NOT is_chat_only(auth.uid())",
    run: async () => await supabase.from("debts").select("id").limit(1),
  },
  {
    key: "penyiapan",
    label: "Penyiapan Pegawai",
    table: "prep_tasks",
    query: "select id from prep_tasks limit 1",
    policy: "user_id = auth.uid() AND NOT is_chat_only(auth.uid())",
    run: async () => await supabase.from("prep_tasks").select("id").limit(1),
  },
  {
    key: "pos_kasir",
    label: "POS Kasir (baca stok)",
    table: "warehouse_item_variants",
    query: "select id from warehouse_item_variants limit 1",
    policy: "user_id = auth.uid() AND NOT is_chat_only(auth.uid())",
    run: async () => await supabase.from("warehouse_item_variants").select("id").limit(1),
  },
];

function classifyStatus(code: string | null, message: string | null): number | null {
  if (!code && !message) return null;
  if (code === "42501") return 403;
  if (code === "PGRST301") return 401;
  if (code === "PGRST116") return 404; // no rows — not a permission problem
  return null;
}

function isAccessDenied(code: string | null, message: string | null): boolean {
  if (!code && !message) return false;
  if (code === "42501" || code === "PGRST301") return true;
  const m = (message ?? "").toLowerCase();
  return (
    m.includes("permission denied") ||
    m.includes("row-level security") ||
    m.includes("jwt") ||
    m.includes("not authorized")
  );
}

export function AccessDiagnostics() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ProbeResult[] | null>(null);
  const [ranAt, setRanAt] = useState<Date | null>(null);

  const runAll = async () => {
    setRunning(true);
    const out: ProbeResult[] = [];
    for (const p of PROBES) {
      const started = performance.now();
      let ok = false;
      let code: string | null = null;
      let message: string | null = null;
      let rows: number | null = null;
      try {
        const res = await p.run();
        if (res.error) {
          code = res.error.code ?? null;
          message = res.error.message ?? null;
          ok = false;
        } else {
          ok = true;
          rows = Array.isArray(res.data) ? res.data.length : 0;
        }
      } catch (e: unknown) {
        message = e instanceof Error ? e.message : String(e);
        ok = false;
      }
      const ms = Math.round(performance.now() - started);
      out.push({
        key: p.key,
        label: p.label,
        table: p.table,
        query: p.query,
        policy: p.policy,
        ok,
        code,
        status: classifyStatus(code, message),
        message,
        rows,
        ms,
      });
    }
    setResults(out);
    setRanAt(new Date());
    setRunning(false);
  };

  const summary = results
    ? {
        total: results.length,
        ok: results.filter((r) => r.ok).length,
        denied: results.filter((r) => !r.ok && isAccessDenied(r.code, r.message)).length,
        other: results.filter((r) => !r.ok && !isAccessDenied(r.code, r.message)).length,
      }
    : null;

  return (
    <Card aria-labelledby="access-diagnostics-title">
      <CardHeader>
        <div className="flex items-center gap-ms-2">
          <ShieldQuestion className="h-5 w-5 text-primary" aria-hidden="true" />
          <CardTitle id="access-diagnostics-title" className="text-ms-base">
            Diagnostik RLS
          </CardTitle>
          {summary && (
            <Badge variant="secondary" className="ml-auto text-ms-2xs">
              {summary.ok}/{summary.total} lolos
            </Badge>
          )}
        </div>
        <CardDescription>
          Jalankan probe <code>select id … limit 1</code> pada tabel perwakilan tiap
          area sebagai akun Anda. Hasil menampilkan kode error persis (
          <code>42501</code>, <code>PGRST301</code>) dan policy yang menolak — tanpa
          menampilkan data baris manapun.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-ms-3">
        <div className="flex flex-wrap items-center gap-ms-2">
          <Button
            type="button"
            size="sm"
            onClick={runAll}
            disabled={running}
            data-testid="access-diagnostics-run"
          >
            {running ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <PlayCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            )}
            {running ? "Menjalankan…" : results ? "Jalankan ulang" : "Jalankan diagnostik"}
          </Button>
          {ranAt && (
            <span className="text-ms-2xs text-muted-foreground">
              Terakhir dijalankan {ranAt.toLocaleTimeString()} · {summary?.denied ?? 0} ditolak
              RLS, {summary?.other ?? 0} error lain
            </span>
          )}
        </div>

        {results && (
          <ul className="space-ms-2" data-testid="access-diagnostics-results">
            {results.map((r) => {
              const denied = !r.ok && isAccessDenied(r.code, r.message);
              return (
                <li
                  key={r.key}
                  className={`rounded-md border p-ms-2.5 ${
                    r.ok
                      ? "border-success/30 bg-success/5"
                      : denied
                        ? "border-warning/40 bg-warning/5"
                        : "border-destructive/40 bg-destructive/5"
                  }`}
                  data-testid={`access-diagnostics-${r.key}`}
                  data-ok={r.ok ? "1" : "0"}
                  data-code={r.code ?? ""}
                >
                  <div className="flex items-start gap-ms-2">
                    {r.ok ? (
                      <CheckCircle2
                        className="mt-0.5 h-4 w-4 shrink-0 text-success"
                        aria-label="Lolos"
                      />
                    ) : (
                      <XCircle
                        className={`mt-0.5 h-4 w-4 shrink-0 ${denied ? "text-warning" : "text-destructive"}`}
                        aria-label="Gagal"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-ms-sm font-medium">{r.label}</span>
                        <span className="text-ms-2xs text-muted-foreground">
                          tabel <code>{r.table}</code> · {r.ms} ms
                        </span>
                      </div>
                      <code className="mt-0.5 block break-words rounded bg-background/60 px-1.5 py-1 text-[10.5px]">
                        {r.query}
                      </code>
                    </div>
                    <Badge
                      variant={r.ok ? "secondary" : "outline"}
                      className="ml-1 shrink-0 text-ms-2xs"
                    >
                      {r.ok
                        ? `OK (${r.rows ?? 0} baris)`
                        : (r.code ?? (r.status ? String(r.status) : "ERROR"))}
                    </Badge>
                  </div>

                  {!r.ok && (
                    <div className="mt-2 space-y-1 pl-6 text-[11.5px]">
                      <div>
                        <span className="font-semibold text-muted-foreground">Pesan: </span>
                        <span className="break-words">{r.message ?? "(tidak ada pesan)"}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-muted-foreground">Policy: </span>
                        <code className="break-words">{r.policy}</code>
                      </div>
                      {denied && (
                        <div className="text-muted-foreground">
                          → Kemungkinan sebab: akun <b>chat_only</b> aktif, atau baris tidak
                          ada dengan <code>user_id = auth.uid()</code>. Upgrade ke MCM
                          Storage untuk membuka.
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {!results && !running && (
          <p className="text-ms-2xs text-muted-foreground">
            Tekan <b>Jalankan diagnostik</b> untuk memeriksa 6 area sekaligus. Probe
            hanya membaca kolom <code>id</code>, tidak menulis/menghapus apapun.
          </p>
        )}
      </CardContent>
    </Card>
  );
}