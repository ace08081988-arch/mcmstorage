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
  // PIN 6 digit acak kriptografis. Pakai rejection sampling agar
  // distribusi 0..999999 seragam (tanpa bias modulo).
  const buf = new Uint32Array(1);
  const MAX = 4_294_000_000; // kelipatan 1_000_000 terbesar < 2^32
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= MAX);
  return (n % 1_000_000).toString().padStart(6, "0");
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

// Link pegawai HARUS memakai origin tempat tugas dibuat.
// Saat owner membuat tugas dari preview/sandbox Lovable, datanya tersimpan pada
// backend preview tersebut. Jika link dipaksa ke mcmstorage.biz, halaman pegawai
// dapat membaca backend/domain berbeda dan RPC prep_get_task akan mengembalikan
// not_found meskipun PIN benar. Di production, current origin tetap mcmstorage.biz.
// Fallback berlapis untuk QR / link halaman pegawai (/t/:token):
//   1) Base URL saat ini (origin browser yang membuat tugas).
//   2) Domain produksi utama (https://mcmstorage.biz) untuk SSR / non-browser.
//   3) URL pegawai default (mirror lovable.app) sebagai cadangan terakhir.
const PRODUCTION_BASE = "https://mcmstorage.biz";
const PRODUCTION_BASE_FALLBACK = "https://mcmstorage.lovable.app";

function isValidHttpBase(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && !!u.hostname;
  } catch {
    return false;
  }
}

function currentOrigin(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const { protocol, hostname, origin } = window.location;
    if (protocol !== "http:" && protocol !== "https:") return null;
    if (!hostname) return null;
    return isValidHttpBase(origin) ? origin : null;
  } catch {
    return null;
  }
}

/**
 * Apakah origin saat ini layak dipakai sebagai base URL link pegawai?
 *
 * Backend (Lovable Cloud / Supabase) dipakai bersama di semua environment,
 * jadi link `mcmstorage.biz` tetap valid walau tugas dibuat dari preview.
 * Sebaliknya, URL sandbox preview (`id-preview--…lovable.app`,
 * `*.lovableproject.com`, `localhost`) tidak boleh dibagikan ke pegawai —
 * sandbox tersebut bisa hilang/berubah dan link jadi mati di HP pegawai.
 */
function isShareableOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    if (!host) return false;
    if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) return false;
    if (host.startsWith("id-preview--")) return false;
    if (host.endsWith(".lovableproject.com")) return false;
    // Domain *.lovable.app yang valid hanya yang persis = subdomain produksi
    // proyek (mis. mcmstorage.lovable.app). Preview build seperti
    // `id-preview--xxx.lovable.app` sudah tersaring di atas.
    return true;
  } catch {
    return false;
  }
}

/** Daftar kandidat base URL berurutan dari yang paling diutamakan. */
export function taskBaseUrlCandidates(): string[] {
  const origin = currentOrigin();
  const shareableOrigin = origin && isShareableOrigin(origin) ? origin : null;
  const list = [
    // Domain produksi selalu diprioritaskan agar link yang dibagikan ke
    // pegawai tetap hidup setelah preview sandbox mati / pemilik pindah
    // perangkat. Origin saat ini hanya dipakai bila itu domain produksi
    // yang sudah terverifikasi (mcmstorage.biz / www.mcmstorage.biz /
    // mcmstorage.lovable.app), bukan URL sandbox preview.
    isValidHttpBase(PRODUCTION_BASE) ? PRODUCTION_BASE : null,
    shareableOrigin,
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
  updated_at?: string | null;
  submissions: PrepSubmissionRow[];
};

export type PrepTaskRow = {
  id: string;
  title: string;
  note: string | null;
  status: string;
  expires_at: string;
};