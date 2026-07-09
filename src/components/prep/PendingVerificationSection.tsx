import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { VerificationDialog, type VerificationSubmission } from "./VerificationDialog";
import { ShieldCheck } from "lucide-react";

/**
 * Section admin: daftar submisi karyawan yang menunggu verifikasi.
 * Dipakai di /request dan /ecer. Filter opsional via `taskIds` untuk
 * scope per-title. Bila `taskIds` undefined → semua task milik user.
 */
export function PendingVerificationSection({
  taskIds,
  onVerified,
}: {
  taskIds?: string[];
  onVerified?: () => void;
}) {
  const [rows, setRows] = useState<
    Array<VerificationSubmission & { photo_paths?: string[] | null; photo_path?: string | null }>
  >([]);
  // Nama task dan nama item untuk triage. Ambil terpisah supaya query
  // utama tetap sederhana dan tidak bergantung pada FK embed (yang bisa
  // gagal diam-diam bila relasi tidak terdeteksi PostgREST). Peta ini
  // dipakai untuk menampilkan "Task · Item" pada tiap baris pending.
  const [taskNames, setTaskNames] = useState<Record<string, string>>({});
  const [itemNames, setItemNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<VerificationSubmission | null>(null);
  const [pickedPhotos, setPickedPhotos] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  const taskFilter = useMemo(() => taskIds?.slice().sort().join(",") ?? "", [taskIds]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase
        .from("prep_submissions")
        .select("id,task_id,task_item_id,photo_path,photo_paths,location_url,note,qty_reported,submitted_at,verification_status")
        .eq("verification_status", "pending")
        .order("submitted_at", { ascending: false })
        .limit(50);
      if (taskIds && taskIds.length > 0) {
        q = q.in("task_id", taskIds);
      }
      const { data, error } = await q;
      if (error) throw error;
      const list = (data ?? []) as typeof rows;
      setRows(list);

      // Resolusi nama task & item untuk triage — ambil dari SSOT tabelnya
      // masing-masing, bukan duplikasi manual. RLS `prep_tasks` /
      // `prep_task_items` sudah membatasi ke owner sehingga aman.
      const taskIdSet = Array.from(
        new Set(list.map((r) => r.task_id).filter((v): v is string => !!v)),
      );
      const itemIdSet = Array.from(
        new Set(list.map((r) => r.task_item_id).filter((v): v is string => !!v)),
      );
      const [tasksRes, itemsRes] = await Promise.all([
        taskIdSet.length > 0
          ? supabase.from("prep_tasks").select("id,title").in("id", taskIdSet)
          : Promise.resolve({ data: [] as Array<{ id: string; title: string | null }> }),
        itemIdSet.length > 0
          ? supabase.from("prep_task_items").select("id,name").in("id", itemIdSet)
          : Promise.resolve({ data: [] as Array<{ id: string; name: string | null }> }),
      ]);
      const tMap: Record<string, string> = {};
      for (const t of (tasksRes.data ?? []) as Array<{ id: string; title: string | null }>) {
        if (t.title) tMap[t.id] = t.title;
      }
      const iMap: Record<string, string> = {};
      for (const it of (itemsRes.data ?? []) as Array<{ id: string; name: string | null }>) {
        if (it.name) iMap[it.id] = it.name;
      }
      setTaskNames(tMap);
      setItemNames(iMap);
    } catch {
      setRows([]);
      setTaskNames({});
      setItemNames({});
    } finally {
      setLoading(false);
    }
  }, [taskFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);

  async function openDialog(sub: (typeof rows)[number]) {
    const paths = (sub.photo_paths && sub.photo_paths.length > 0)
      ? sub.photo_paths
      : (sub.photo_path ? [sub.photo_path] : []);
    const urls: string[] = [];
    for (const p of paths) {
      const { data } = await supabase.storage
        .from("prep-photos")
        .createSignedUrl(p, 300);
      if (data?.signedUrl) urls.push(data.signedUrl);
    }
    setPicked(sub);
    setPickedPhotos(urls);
    setOpen(true);
  }

  if (!loading && rows.length === 0) return null;

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" />
            Menunggu Verifikasi
            <StatusBadge lifecycle="waiting_verification" size="xs" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <p className="text-xs text-muted-foreground">Memuat…</p>
          ) : (
            rows.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-2 rounded border p-2"
              >
                <div className="min-w-0 flex-1 text-xs">
                  {(() => {
                    const taskName = r.task_id ? taskNames[r.task_id] : undefined;
                    const itemName = r.task_item_id ? itemNames[r.task_item_id] : undefined;
                    const label = [taskName, itemName].filter(Boolean).join(" · ");
                    return (
                      <>
                        <div className="truncate font-medium">
                          {label || "Submisi pegawai"}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {new Date(r.submitted_at).toLocaleString("id-ID")}
                        </div>
                      </>
                    );
                  })()}
                  {r.note ? (
                    <div className="truncate text-muted-foreground">{r.note}</div>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  onClick={() => void openDialog(r)}
                  aria-label="Verifikasi submisi"
                >
                  Verifikasi
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
      <VerificationDialog
        open={open}
        onOpenChange={setOpen}
        submission={picked}
        photoUrls={pickedPhotos}
        onDone={() => { void load(); onVerified?.(); }}
      />
    </>
  );
}