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
};

export type RequestPreparationItem = {
  id: string;
  preparation_id: string;
  warehouse_item_id: string;
  actual_grams: number;
};

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