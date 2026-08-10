/**
 * Pemantau performa daftar virtual (produksi-friendly).
 *
 * Menampilkan metrik yang dikumpulkan `VirtualizedList` selama sesi
 * berjalan: jumlah re-render, mount, durasi commit (terakhir / rata-rata
 * / terlama), dan berapa commit yang melewati satu frame 60fps.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronLeft, RotateCcw } from "lucide-react";
import {
  getListPerfSnapshot,
  resetListPerf,
  subscribeListPerf,
  type ListPerfStat,
} from "@/lib/list-perf";

export const Route = createFileRoute("/_authenticated/diagnostik-list")({
  head: () => ({
    meta: [
      { title: "Performa daftar · Ace Storage" },
      {
        name: "description",
        content:
          "Pantau render time dan jumlah re-render daftar virtual per halaman.",
      },
      { property: "og:title", content: "Performa daftar · Ace Storage" },
      {
        property: "og:description",
        content: "Metrik ringan VirtualizedList: render time & re-render per route.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: ListPerfPage,
});

let cachedSnapshot: ListPerfStat[] = [];
function getSnapshotStable() {
  const next = getListPerfSnapshot();
  const same =
    next.length === cachedSnapshot.length &&
    next.every((s, i) => cachedSnapshot[i]?.id === s.id && cachedSnapshot[i]?.updatedAt === s.updatedAt);
  if (!same) cachedSnapshot = next;
  return cachedSnapshot;
}

function ListPerfPage() {
  const rows = useSyncExternalStore(
    subscribeListPerf,
    getSnapshotStable,
    () => cachedSnapshot,
  );

  return (
    <div className="px-ms-4 py-ms-4">
      <div className="mb-ms-3 flex items-center justify-between gap-ms-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/diagnostics">
            <ChevronLeft className="size-4" /> Diagnostik
          </Link>
        </Button>
        <Button variant="outline" size="sm" onClick={() => resetListPerf()}>
          <RotateCcw className="size-4" /> Reset
        </Button>
      </div>

      <h1 className="mb-ms-2 text-ms-lg font-semibold">Performa daftar</h1>
      <p className="mb-ms-4 text-ms-xs text-muted-foreground">
        Metrik dikumpulkan sejak halaman terakhir dimuat. Buka halaman
        Gudang/Request/Chat lebih dulu, lalu kembali ke sini.
      </p>

      {rows.length === 0 ? (
        <p className="text-ms-sm text-muted-foreground">
          Belum ada data — belum ada daftar virtual yang dirender di sesi ini.
        </p>
      ) : (
        <div className="grid gap-ms-3">
          {rows.map((s) => (
            <Card key={s.id}>
              <CardHeader className="pb-ms-2">
                <CardTitle className="text-ms-sm">
                  {s.list}
                  <span className="ml-ms-2 text-ms-2xs font-normal text-muted-foreground">
                    {s.route}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-ms-2 text-ms-xs tabular-nums">
                <Metric label="Re-render" value={String(s.renders)} />
                <Metric label="Mount" value={String(s.mounts)} />
                <Metric label="Frame lambat" value={String(s.slowFrames)} />
                <Metric label="Terakhir" value={`${s.lastMs} ms`} />
                <Metric label="Rata-rata" value={`${s.avgMs} ms`} />
                <Metric label="Terlama" value={`${s.maxMs} ms`} />
                <Metric label="Item" value={String(s.items)} />
                <Metric label="Dirender" value={String(s.rendered)} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 p-ms-2">
      <div className="text-ms-2xs text-muted-foreground">{label}</div>
      <div className="text-ms-sm font-medium">{value}</div>
    </div>
  );
}