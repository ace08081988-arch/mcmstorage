import { supabase } from "@/integrations/supabase/client";

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
};

export async function ecerSignedUrl(
  path: string | null | undefined,
  expiresIn = 60 * 60 * 24,
): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from(ECER_BUCKET).createSignedUrl(path, expiresIn);
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
  if (error) return null;
  return path;
}

export async function deleteEcerPhoto(path: string | null | undefined): Promise<void> {
  if (!path) return;
  await supabase.storage.from(ECER_BUCKET).remove([path]);
}