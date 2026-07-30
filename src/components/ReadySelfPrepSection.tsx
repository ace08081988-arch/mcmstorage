import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { PackagePlus, MapPin, Image as ImageIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useLayoutMode, layoutGridClass, LayoutModeToggle } from "@/components/LayoutModeToggle";
import { useOnDebtTx } from "@/lib/debt-tx-event";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type Row = {
  id: string;
  title: string;
  note: string | null;
  photo_path: string | null;
  photo_paths: string[] | null;
  location_url: string | null;
  created_at: string;
};

/**
 * Ringkasan paket "Siapkan Sendiri" (self_prep_items status='ready') di
 * halaman utama, sejajar dengan ReadyRequestSection agar item yang sudah
 * disiapkan pemilik langsung terlihat di depan — bukan tersembunyi di
 * balik tab Tugas → Siapkan Sendiri.
 */
export function ReadySelfPrepSection() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [layout, setLayout] = useLayoutMode("readySelfPrep", "list");
  const gridClass = layoutGridClass(layout);
  const compact = layout === "compact";

  const load = useCallback(async () => {
    const { data } = await sb
      .from("self_prep_items")
      .select("id,title,note,photo_path,photo_paths,location_url,created_at")
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(12);
    setRows((data ?? []) as Row[]);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useOnDebtTx(useCallback(() => { void load(); }, [load]));

  return (
    <section className="space-ms-2">
      <div className="flex items-center justify-between">
        <p className="text-ms-2xs uppercase tracking-wide text-muted-foreground">
          Siapkan Sendiri — Siap Dikirim
        </p>
        <div className="flex items-center gap-ms-2">
          <LayoutModeToggle mode={layout} onChange={setLayout} />
          <Link to="/tugas" className="text-ms-2xs font-medium text-primary hover:underline">
            Kelola →
          </Link>
        </div>
      </div>

      {rows === null ? (
        <div className={gridClass} aria-busy="true">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-ms-1.5 rounded-md border bg-card p-ms-2.5">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-2.5 w-4/5" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Link
          to="/tugas"
          className="flex flex-col items-center gap-ms-1.5 rounded-md border border-dashed bg-card p-ms-5 text-center text-ms-xs text-muted-foreground hover:border-primary/40 hover:bg-accent"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
            <PackagePlus className="h-4 w-4 text-primary" />
          </div>
          <span className="font-medium text-foreground">Belum ada paket sendiri</span>
          <span>Tap untuk menyiapkan produk sendiri.</span>
        </Link>
      ) : (
        <div className={gridClass}>
          {rows.map((r) => {
            const photoCount =
              (r.photo_paths?.length ?? 0) + (r.photo_path && !(r.photo_paths ?? []).includes(r.photo_path) ? 1 : 0);
            return (
              <Link
                key={r.id}
                to="/tugas"
                className={
                  "flex flex-col gap-0.5 rounded-md border bg-card hover:border-primary/40 hover:bg-accent " +
                  (compact ? "px-ms-2.5 py-1.5" : "p-ms-2.5")
                }
              >
                <div className="flex items-center justify-between gap-ms-2">
                  <span className="truncate text-ms-xs font-semibold">{r.title}</span>
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-ms-2xs font-medium text-primary">
                    siap
                  </span>
                </div>
                {!compact && (
                <div className="flex items-center gap-ms-2 text-ms-2xs text-muted-foreground">
                  {photoCount > 0 && (
                    <span className="inline-flex items-center gap-0.5">
                      <ImageIcon className="h-3 w-3" /> {photoCount}
                    </span>
                  )}
                  {r.location_url && (
                    <span className="inline-flex items-center gap-0.5">
                      <MapPin className="h-3 w-3" /> lokasi
                    </span>
                  )}
                  {r.note && <span className="line-clamp-1">{r.note}</span>}
                </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}