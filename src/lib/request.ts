import { inspectImageBlob, UPLOAD_IMAGE_MAX_BYTES } from "./upload-image-guard";
import { supabase } from "@/integrations/supabase/client";
import { logStorageError } from "@/lib/storage-log";

// Reuse ecer-photos bucket — same path scoping rules apply.
export const REQUEST_BUCKET = "ecer-photos";

type StorageClient = Pick<typeof supabase, "storage">;

export type RequestTitle = {
  id: string;
  user_id: string;
  name: string;
  note: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  // Bila diisi, prep dengan created_at ≤ nilai ini tidak dianggap
  // "sudah disiapkan" — dipakai tombol "Minta penyiapan ulang" untuk
  // memaksa title muncul kembali di portal pegawai tanpa mengubah
  // riwayat prep sebelumnya.
  reprep_requested_at: string | null;
};

export type RequestTitleItem = {
  id: string;
  title_id: string;
  warehouse_item_id: string;
  target_grams: number;
  unit_label: string;
  note: string | null;
  position: number;
};

export type RequestPreparation = {
  id: string;
  user_id: string;
  title_id: string;
  photo_path: string | null;
  location_url: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  note: string | null;
  created_by: string;
  prep_task_item_id: string | null;
  created_at: string;
  photo_paths?: string[] | null;
  /** Link lokasi per foto, sejajar index dengan `photo_paths`
   * (index 0 = foto ke-1). String kosong = foto itu tanpa lokasi. */
  location_urls?: string[] | null;
  sold_at?: string | null;
  sold_customer_id?: string | null;
  sold_party_name?: string | null;
  sold_total?: number | null;
  sold_paid_amount?: number | null;
  sold_payment_method?: string | null;
};

export type RequestPreparationItem = {
  id: string;
  preparation_id: string;
  warehouse_item_id: string;
  actual_grams: number;
};

/**
 * SSOT pemasangan foto ↔ lokasi untuk paket request.
 *
 * Urutan foto adalah urutan unggah pegawai (`photo_paths`), dan `location_urls`
 * disimpan sejajar index dengan array itu. Fungsi ini melakukan dedup path
 * (foto lama `photo_path` bisa duplikat dengan elemen pertama `photo_paths`)
 * TANPA menggeser pasangan lokasi, lalu jatuh balik ke `location_url` tunggal
 * untuk foto pertama pada data lama yang belum punya kolom baru.
 */
export function requestPhotoLocationPairs(
  prep: Pick<RequestPreparation, "photo_path" | "photo_paths" | "location_url" | "location_urls">,
): Array<{ path: string; locationUrl: string | null }> {
  const paths = (prep.photo_paths ?? []).filter((x): x is string => !!x);
  const base = paths.length > 0 ? paths : prep.photo_path ? [prep.photo_path] : [];
  const locs = prep.location_urls ?? [];
  const seen = new Set<string>();
  const out: Array<{ path: string; locationUrl: string | null }> = [];
  base.forEach((path, i) => {
    if (seen.has(path)) return;
    seen.add(path);
    const raw = (locs[i] ?? "").trim();
    const fallback = out.length === 0 ? (prep.location_url ?? "").trim() : "";
    out.push({ path, locationUrl: (raw || fallback) || null });
  });
  return out;
}

export async function requestSignedUrl(
  path: string | null | undefined,
  expiresIn = 60 * 60 * 24,
  client: StorageClient = supabase,
): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await client.storage.from(REQUEST_BUCKET).createSignedUrl(path, expiresIn);
  logStorageError({ bucket: REQUEST_BUCKET, op: "createSignedUrl", path, source: "requestSignedUrl" }, error);
  return data?.signedUrl ?? null;
}

export async function uploadRequestPhoto(
  userId: string,
  titleId: string,
  blob: Blob,
  ext = "jpg",
  client: StorageClient = supabase,
): Promise<string | null> {
  const guard = await inspectImageBlob(blob, { maxBytes: UPLOAD_IMAGE_MAX_BYTES });
  if (!guard.ok) {
    logStorageError(
      { bucket: REQUEST_BUCKET, op: "upload", path: "(magic-byte)", source: "uploadRequestPhoto" },
      new Error(`file ditolak: ${guard.reason}`),
    );
    return null;
  }
  const path = `${userId}/req-${titleId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await client.storage.from(REQUEST_BUCKET).upload(path, blob, {
    contentType: blob.type || "image/jpeg",
    upsert: false,
  });
  if (error) {
    logStorageError({ bucket: REQUEST_BUCKET, op: "upload", path, source: "uploadRequestPhoto" }, error);
    return null;
  }
  return path;
}

export async function uploadRequestPhotoViaToken(
  ownerUserId: string,
  shareToken: string,
  blob: Blob,
  ext = "jpg",
  client: StorageClient = supabase,
): Promise<string | null> {
  const guard = await inspectImageBlob(blob, { maxBytes: UPLOAD_IMAGE_MAX_BYTES });
  if (!guard.ok) {
    logStorageError(
      { bucket: REQUEST_BUCKET, op: "upload", path: "(magic-byte)", source: "uploadRequestPhotoViaToken" },
      new Error(`file ditolak: ${guard.reason}`),
    );
    return null;
  }
  const path = `${ownerUserId}/${shareToken}/req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await client.storage.from(REQUEST_BUCKET).upload(path, blob, {
    contentType: blob.type || "image/jpeg",
    upsert: false,
  });
  if (error) {
    logStorageError({ bucket: REQUEST_BUCKET, op: "upload", path, source: "uploadRequestPhotoViaToken" }, error);
    return null;
  }
  return path;
}

export async function deleteRequestPhoto(path: string | null | undefined): Promise<void> {
  if (!path) return;
  const { error } = await supabase.storage.from(REQUEST_BUCKET).remove([path]);
  logStorageError({ bucket: REQUEST_BUCKET, op: "remove", path, source: "deleteRequestPhoto" }, error);
}