import { supabase } from "@/integrations/supabase/client";
import { logStorageError } from "@/lib/storage-log";

export const PREP_BUCKET = "prep-photos";

type StorageClient = Pick<typeof supabase, "storage">;

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

export async function signedUrl(path: string | null | undefined, expiresIn = 60 * 60 * 24 * 7, client: StorageClient = supabase): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await client.storage.from(PREP_BUCKET).createSignedUrl(path, expiresIn);
  if (error) {
    logStorageError({ bucket: PREP_BUCKET, op: "createSignedUrl", path, source: "signedUrl" }, error);
    return null;
  }
  return data?.signedUrl ?? null;
}

export async function uploadPrepPhoto(taskToken: string, itemId: string, blob: Blob, ext = "jpg", client: StorageClient = supabase): Promise<string | null> {
  const path = `${taskToken}/${itemId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await client.storage.from(PREP_BUCKET).upload(path, blob, {
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

// Daftar host produksi yang sah untuk membuka halaman pegawai (/t/:token).
// Selain ini dianggap pratinjau / sandbox / origin tidak valid dan akan
// otomatis di-fallback ke PRODUCTION_BASE.
// Fallback berlapis untuk QR / link halaman pegawai (/t/:token):
//   1) Base URL saat ini (origin) — hanya jika host termasuk produksi yang sah.
//   2) Domain produksi utama (https://mcmstorage.biz).
//   3) URL pegawai default (mirror lovable.app) sebagai cadangan terakhir
//      jika base utama tidak bisa diparse.
const PRODUCTION_BASE = "https://mcmstorage.biz";
const PRODUCTION_BASE_FALLBACK = "https://mcmstorage.lovable.app";
const PRODUCTION_HOSTS = new Set<string>([
  "mcmstorage.biz",
  "www.mcmstorage.biz",
  "mcmstorage.lovable.app",
]);

function isValidHttpBase(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && !!u.hostname;
  } catch {
    return false;
  }
}

function currentOriginIfProduction(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const { protocol, hostname, origin } = window.location;
    if (protocol !== "http:" && protocol !== "https:") return null;
    const isPreviewSandbox =
      hostname.endsWith("lovableproject.com") ||
      hostname.startsWith("id-preview--") ||
      /--[a-z0-9-]+\.lovable\.app$/i.test(hostname) ||
      hostname === "localhost" ||
      hostname === "127.0.0.1";
    if (isPreviewSandbox) return null;
    if (!PRODUCTION_HOSTS.has(hostname)) return null;
    return isValidHttpBase(origin) ? origin : null;
  } catch {
    return null;
  }
}

/** Daftar kandidat base URL berurutan dari yang paling diutamakan. */
export function taskBaseUrlCandidates(): string[] {
  const list = [
    currentOriginIfProduction(),
    isValidHttpBase(PRODUCTION_BASE) ? PRODUCTION_BASE : null,
    isValidHttpBase(PRODUCTION_BASE_FALLBACK) ? PRODUCTION_BASE_FALLBACK : null,
  ].filter((v): v is string => !!v);
  // Dedup tanpa mengubah urutan.
  return Array.from(new Set(list));
}

function resolveBaseUrl(): string {
  const [first] = taskBaseUrlCandidates();
  return first ?? PRODUCTION_BASE_FALLBACK;
}

function pinFragment(pin?: string | null): string {
  if (!pin) return "";
  const clean = String(pin).replace(/\D/g, "");
  if (clean.length < 4) return "";
  // Fragment (#) tidak dikirim ke server / log, jadi aman untuk PIN.
  return `#p=${clean}`;
}

export function publicTaskUrl(token: string, pin?: string | null): string {
  if (!isValidShareToken(token)) {
    throw new InvalidShareTokenError(
      !token ? "Token link kosong" : "Token link tidak valid",
    );
  }
  return `${resolveBaseUrl()}/t/${token}${pinFragment(pin)}`;
}

/** Semua URL kandidat untuk token tertentu (urutan = prioritas fallback). */
export function publicTaskUrlCandidates(token: string, pin?: string | null): string[] {
  if (!isValidShareToken(token)) {
    throw new InvalidShareTokenError(
      !token ? "Token link kosong" : "Token link tidak valid",
    );
  }
  const frag = pinFragment(pin);
  return taskBaseUrlCandidates().map((b) => `${b}/t/${token}${frag}`);
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