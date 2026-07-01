import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, RefreshCw, Search, ShieldAlert, X } from "lucide-react";
import { listAdminDenialEvents } from "@/lib/admin-denial-log.functions";
import { useAdminStatus } from "@/hooks/use-is-admin";

export const Route = createFileRoute("/_authenticated/admin-denial-log")({
  head: () => ({
    meta: [
      { title: "Log Penolakan Admin · MCM Storage" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AdminDenialLogPage,
});

const ANY_FN = "__any__";

function fmtAbs(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("id-ID", { hour12: false });
  } catch {
    return iso;
  }
}

function fmtAgo(iso: string | null | undefined) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} dtk lalu`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.round(h / 24)} hari lalu`;
}

function AdminDenialLogPage() {
  const { isAdmin, isCheckingAdmin } = useAdminStatus();
  const fetchLog = useServerFn(listAdminDenialEvents);

  const [fnFilter, setFnFilter] = useState<string>(ANY_FN);
  const [userIdFilter, setUserIdFilter] = useState<string>("");
  const [refererFilter, setRefererFilter] = useState<string>("");
  const [userIdDraft, setUserIdDraft] = useState<string>("");
  const [refererDraft, setRefererDraft] = useState<string>("");

  const q = useQuery({
    queryKey: [
      "admin-denial-log",
      { fn: fnFilter, userId: userIdFilter, referer: refererFilter },
    ],
    queryFn: () =>
      fetchLog({
        data: {
          fn: fnFilter === ANY_FN ? null : fnFilter,
          userId: userIdFilter || null,
          referer: refererFilter || null,
          limit: 200,
        },
      }),
    enabled: isAdmin,
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;
  const fnOptions = q.data?.fnOptions ?? [];

  const byReferer = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((r) => {
      const key = r.referer ?? "(tanpa referer)";
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [rows]);

  const activeFilters =
    (fnFilter !== ANY_FN ? 1 : 0) +
    (userIdFilter ? 1 : 0) +
    (refererFilter ? 1 : 0);

  function applyFilters() {
    setUserIdFilter(userIdDraft.trim());
    setRefererFilter(refererDraft.trim());
  }

  function clearFilters() {
    setFnFilter(ANY_FN);
    setUserIdFilter("");
    setRefererFilter("");
    setUserIdDraft("");
    setRefererDraft("");
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <Link
          to="/diagnostics"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Diagnostik
        </Link>
        <Button
          variant="outline"
          size="sm"
          onClick={() => q.refetch()}
          disabled={q.isFetching || !isAdmin}
        >
          <RefreshCw
            className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`}
          />
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-amber-600" />
          Log Penolakan Admin
        </h1>
        <p className="text-sm text-muted-foreground">
          Menampilkan pemanggilan server fn admin yang ditolak (non-admin
          mencoba akses). Gunakan untuk melacak route/halaman yang masih
          memanggil fn admin.
        </p>
      </div>

      {isCheckingAdmin ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Memeriksa akses…
          </CardContent>
        </Card>
      ) : !isAdmin ? (
        <Card>
          <CardContent className="space-y-2 p-6 text-sm">
            <div className="font-medium">Halaman ini hanya untuk admin.</div>
            <p className="text-muted-foreground">
              Kembali ke{" "}
              <Link to="/diagnostics" className="underline">
                Diagnostik
              </Link>{" "}
              atau{" "}
              <Link to="/" className="underline">
                halaman utama
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Filter</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Fungsi (fn)</label>
                <Select value={fnFilter} onValueChange={setFnFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Semua fn" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY_FN}>Semua fn</SelectItem>
                    {fnOptions.map((fn) => (
                      <SelectItem key={fn} value={fn}>
                        {fn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">User ID</label>
                <Input
                  value={userIdDraft}
                  placeholder="uuid persis"
                  onChange={(e) => setUserIdDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") applyFilters();
                  }}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  Referer mengandung
                </label>
                <Input
                  value={refererDraft}
                  placeholder="/pengaturan-apk"
                  onChange={(e) => setRefererDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") applyFilters();
                  }}
                />
              </div>
              <div className="sm:col-span-3 flex flex-wrap items-center gap-2 pt-1">
                <Button size="sm" onClick={applyFilters}>
                  <Search className="h-4 w-4" />
                  <span className="ml-2">Terapkan</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={clearFilters}
                  disabled={activeFilters === 0}
                >
                  <X className="h-4 w-4" />
                  <span className="ml-2">Bersihkan</span>
                </Button>
                <div className="ml-auto text-xs text-muted-foreground">
                  {total} baris · diperbarui {fmtAgo(q.data?.fetchedAt)}
                </div>
              </div>
            </CardContent>
          </Card>

          {byReferer.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Referer teratas (hasil saat ini)
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {byReferer.map(([ref, count]) => (
                  <button
                    key={ref}
                    type="button"
                    className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-xs hover:bg-muted"
                    onClick={() => {
                      const v = ref === "(tanpa referer)" ? "" : ref;
                      setRefererDraft(v);
                      setRefererFilter(v);
                    }}
                    title="Klik untuk filter referer ini"
                  >
                    <span className="max-w-[280px] truncate text-left">
                      {ref}
                    </span>
                    <Badge variant="secondary" className="tabular-nums">
                      {count}
                    </Badge>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {rows.length} kejadian terbaru
              </CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {q.isLoading ? (
                <div className="px-6 pb-4 text-sm text-muted-foreground">
                  Memuat…
                </div>
              ) : rows.length === 0 ? (
                <div className="px-6 pb-4 text-sm text-muted-foreground">
                  Tidak ada penolakan admin yang cocok dengan filter.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 text-left">Waktu</th>
                        <th className="px-4 py-2 text-left">Fungsi</th>
                        <th className="px-4 py-2 text-left">User ID</th>
                        <th className="px-4 py-2 text-left">Referer</th>
                        <th className="px-4 py-2 text-left">Alasan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="border-t border-border/60 align-top">
                          <td className="px-4 py-2">
                            <div className="font-medium">
                              {fmtAgo(r.created_at)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {fmtAbs(r.created_at)}
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            <button
                              type="button"
                              className="font-mono text-xs hover:underline"
                              onClick={() => setFnFilter(r.fn)}
                              title="Filter fn ini"
                            >
                              {r.fn}
                            </button>
                          </td>
                          <td className="px-4 py-2">
                            {r.user_id ? (
                              <button
                                type="button"
                                className="font-mono text-xs hover:underline"
                                onClick={() => {
                                  setUserIdDraft(r.user_id!);
                                  setUserIdFilter(r.user_id!);
                                }}
                                title="Filter user id ini"
                              >
                                {r.user_id.slice(0, 8)}…
                              </button>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            {r.referer ? (
                              <button
                                type="button"
                                className="max-w-[320px] truncate text-left text-xs hover:underline"
                                onClick={() => {
                                  setRefererDraft(r.referer!);
                                  setRefererFilter(r.referer!);
                                }}
                                title={r.referer}
                              >
                                {r.referer}
                              </button>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">
                            {r.reason}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}