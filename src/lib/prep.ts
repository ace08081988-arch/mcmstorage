import { supabase } from "@/integrations/supabase/client";
import { logStorageError } from "@/lib/storage-log";

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
  if (error) {
    logStorageError({ bucket: PREP_BUCKET, op: "createSignedUrl", path, source: "signedUrl" }, error);
    return null;
  }
  return data?.signedUrl ?? null;
}

export async function uploadPrepPhoto(taskToken: string, itemId: string, blob: Blob, ext = "jpg"): Promise<string | null> {
  const path = `${taskToken}/${itemId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(PREP_BUCKET).upload(path, blob, {
    contentType: blob.type || "image/jpeg",
    upsert: false,
  });
  if (error) {
    logStorageError({ bucket: PREP_BUCKET, op: "upload", path, source: "uploadPrepPhoto" }, error);
    return null;
  }
  return path;
}

// Format token share: base64url 24 byte ≈ 32 char ([A-Za-z0-9_-]).
// Validasi defensif sebelum membentuk URL agar tidak mengarahkan pegawai
// ke halaman gagal saat token kosong/rusak.
const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function isValidShareToken(token: unknown): token is string {
  return typeof token === "string" && SHARE_TOKEN_RE.test(token);
}

export class InvalidShareTokenError extends Error {
  constructor(message = "Token link tidak valid") {
    super(message);
    this.name = "InvalidShareTokenError";
  }
}

export function publicTaskUrl(token: string): string {
  if (!isValidShareToken(token)) {
    throw new InvalidShareTokenError(
      !token ? "Token link kosong" : "Token link tidak valid",
    );
  }
  // Selalu gunakan domain publik yang stabil agar link bisa dibuka di mana
  // saja — termasuk saat tombol "Buka di Tab Baru" diklik dari iframe
  // pratinjau Lovable (yang membutuhkan token query). Origin pratinjau
  // (lovableproject.com / *-preview*.lovable.app) tidak bisa dipakai pegawai.
  const PUBLIC_BASE = "https://mcmstorage.biz";
  if (typeof window === "undefined") return `${PUBLIC_BASE}/t/${token}`;
  const origin = window.location.origin;
  const isPreviewSandbox =
    origin.includes("lovableproject.com") ||
    origin.includes("id-preview--") ||
    /--[a-z0-9-]+\.lovable\.app$/i.test(origin);
  const base = isPreviewSandbox ? PUBLIC_BASE : origin;
  return `${base}/t/${token}`;
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