import { supabase } from "@/integrations/supabase/client";

export const PREP_BUCKET = "prep-photos";

export function genShareToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function genPin(): string {
  const n = Math.floor(Math.random() * 1_000_000);
  return n.toString().padStart(6, "0");
}

export async function signedUrl(path: string | null | undefined, expiresIn = 60 * 60 * 24 * 7): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(PREP_BUCKET).createSignedUrl(path, expiresIn);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function uploadPrepPhoto(taskToken: string, itemId: string, blob: Blob, ext = "jpg"): Promise<string | null> {
  const path = `${taskToken}/${itemId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(PREP_BUCKET).upload(path, blob, {
    contentType: blob.type || "image/jpeg",
    upsert: false,
  });
  if (error) return null;
  return path;
}

export function publicTaskUrl(token: string): string {
  if (typeof window === "undefined") return `/t/${token}`;
  return `${window.location.origin}/t/${token}`;
}

export type PrepSubmissionRow = {
  id: string;
  photo_path: string | null;
  location_url: string | null;
  note: string | null;
  submitted_at: string;
};

export type PrepItemRow = {
  id: string;
  name: string;
  category: string | null;
  qty_requested: number;
  qty_prepared: number;
  unit_label: string | null;
  ref_photo_path: string | null;
  note: string | null;
  submissions: PrepSubmissionRow[];
};

export type PrepTaskRow = {
  id: string;
  title: string;
  note: string | null;
  status: string;
  expires_at: string;
};