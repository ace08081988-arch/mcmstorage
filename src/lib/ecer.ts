import { supabase } from "@/integrations/supabase/client";
import { logStorageError } from "@/lib/storage-log";

export const ECER_BUCKET = "ecer-photos";

export type EcerTitle = {
  id: string;
  user_id: string;
  warehouse_item_id: string;
  name: string;
  target_grams: number;
  unit_label: string;
  note: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

export type EcerPreparation = {
  id: string;
  user_id: string;
  title_id: string;
  warehouse_item_id: string;
  actual_grams: number;
  photo_path: string | null;
  location_url: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  note: string | null;
  created_by: string;
  prep_task_item_id: string | null;
  created_at: string;
  sold_at?: string | null;
  sold_customer_id?: string | null;
  sold_party_name?: string | null;
  sold_total?: number | null;
  sold_paid_amount?: number | null;
  sold_payment_method?: string | null;
  sold_note?: string | null;
};

export async function ecerSignedUrl(
  path: string | null | undefined,
  expiresIn = 60 * 60 * 24,
): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(ECER_BUCKET).createSignedUrl(path, expiresIn);
  logStorageError({ bucket: ECER_BUCKET, op: "createSignedUrl", path, source: "ecerSignedUrl" }, error);
  return data?.signedUrl ?? null;
}

export async function uploadEcerPhoto(
  userId: string,
  titleId: string,
  blob: Blob,
  ext = "jpg",
): Promise<string | null> {
  const path = `${userId}/${titleId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(ECER_BUCKET).upload(path, blob, {
    contentType: blob.type || "image/jpeg",
    upsert: false,
  });
  if (error) {
    logStorageError({ bucket: ECER_BUCKET, op: "upload", path, source: "uploadEcerPhoto" }, error);
    return null;
  }
  return path;
}

export async function deleteEcerPhoto(path: string | null | undefined): Promise<void> {
  if (!path) return;
  const { error } = await supabase.storage.from(ECER_BUCKET).remove([path]);
  logStorageError({ bucket: ECER_BUCKET, op: "remove", path, source: "deleteEcerPhoto" }, error);
  // Bersihkan folder induk kalau sudah tidak ada foto tersisa. Supabase
  // Storage tidak punya konsep folder nyata — "folder" hanya prefix dari
  // path objek, plus dashboard/CLI kadang menaruh file penanda
  // `.emptyFolderPlaceholder`. Setelah menghapus foto terakhir di prefix
  // `userId/titleId/`, marker itu (atau file yatim lain) akan bikin folder
  // tetap terlihat kosong di UI. Sapu bersih di sini.
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash <= 0) return;
  const folder = path.slice(0, lastSlash);
  try {
    const { data: entries } = await supabase.storage
      .from(ECER_BUCKET)
      .list(folder, { limit: 100 });
    if (!entries || entries.length === 0) return;
    // Hanya bersihkan kalau semua yang tersisa adalah placeholder kosong —
    // jangan sekali-kali menyentuh file foto asli milik penyiapan lain.
    const stale = entries
      .filter((e) => {
        const n = e.name ?? "";
        if (n === ".emptyFolderPlaceholder") return true;
        const size = (e.metadata as { size?: number } | null | undefined)?.size;
        return typeof size === "number" && size === 0;
      })
      .map((e) => `${folder}/${e.name}`);
    if (stale.length === 0 || stale.length !== entries.length) return;
    const { error: cleanupErr } = await supabase.storage.from(ECER_BUCKET).remove(stale);
    logStorageError(
      { bucket: ECER_BUCKET, op: "remove", path: folder, source: "deleteEcerPhoto:cleanupFolder" },
      cleanupErr,
    );
  } catch (err) {
    logStorageError(
      { bucket: ECER_BUCKET, op: "list", path: folder, source: "deleteEcerPhoto:cleanupFolder" },
      err as { message?: string } | null,
    );
  }
}