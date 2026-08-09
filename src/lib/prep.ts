import { supabase } from "@/integrations/supabase/client";
import { logStorageError } from "@/lib/storage-log";
import { compressImage } from "@/lib/prep-image-compress";

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

// Ambang re-kompresi safety-net di lapisan upload. stageFile() sudah
// mengompres saat file dipilih user, tapi:
//   • hasil edit PhotoEditor bisa lebih besar dari input (mis. rotasi
//     ulang atau crop di zoom tinggi meninggalkan area kosong),
//   • blob dari alur lain (mis. drag-drop di masa depan) belum tentu
//     lewat stageFile.
// Threshold 1.5 MB dipilih karena RPC/storage lancar di bawahnya dan foto
// bukti timbangan tetap tajam pada quality 0.8 sisi 2048 px.
const UPLOAD_COMPRESS_THRESHOLD = 1.5 * 1024 * 1024;
const UPLOAD_QUALITY = 0.8;
const UPLOAD_MAX_DIM = 2048;

// SPRINT 5 (High) — pagar ukuran akhir. Bucket prep-photos bisa ditulis oleh
// sesi anon (portal pegawai) dan Storage belum punya file_size_limit per
// bucket, jadi batas keras ditegakkan di sini: apa pun yang lolos kompresi
// tapi masih > 12 MB ditolak, bukan dikirim ke storage.
const UPLOAD_HARD_MAX_BYTES = 12 * 1024 * 1024;

// Peta MIME → ekstensi file. Batasi hanya ke format raster yang benar-benar
// bisa dihasilkan pipeline stageFile / PhotoEditor supaya tidak ada file
// aneh (mis. HEIC mentah) yang lolos ke storage.
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function extFromMime(mime: string | undefined | null): string {
  const m = (mime || "").toLowerCase();
  return MIME_EXT[m] ?? "jpg";
}

function mimeFromExt(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, "");
  if (e === "png") return "image/png";
  if (e === "webp") return "image/webp";
  return "image/jpeg";
}

export type UploadPrepPhotoOptions = {
  /** Ekstensi override; default: turunkan dari MIME blob (fallback "jpg"). */
  ext?: string;
  /**
   * Nama file yang dikirim ke storage backend. Jika `blob` sudah `File`,
   * dipakai apa adanya; jika tidak, blob dibungkus jadi `File(name, type)`
   * dengan nama unik + ekstensi yang konsisten. Nama ini juga muncul di
   * header `Content-Disposition` sehingga owner bisa mengenali foto saat
   * mengunduh dari dashboard.
   */
  fileName?: string;
  /**
   * Nonaktifkan safety-net kompresi (mis. saat test) — normalnya biarkan
   * `undefined` supaya foto > 1.5 MB otomatis dipangkas ke JPEG q=0.8.
   */
  skipCompress?: boolean;
};

export async function uploadPrepPhoto(
  taskToken: string,
  itemId: string,
  blob: Blob,
  extOrOpts: string | UploadPrepPhotoOptions = {},
  client: StorageClient = supabase,
): Promise<string | null> {
  const opts: UploadPrepPhotoOptions =
    typeof extOrOpts === "string" ? { ext: extOrOpts } : (extOrOpts ?? {});

  // 0) Tolak lebih awal apa pun yang bukan gambar (PDF, zip, video, dsb).
  //    MIME gambar non-standar seperti image/heic tetap diterima karena
  //    dinormalisasi ke JPEG di langkah kompresi/ekstensi di bawah. Blob
  //    tanpa MIME (kamera native Android) juga diteruskan.
  const inMime = (blob.type || "").toLowerCase();
  if (inMime && !inMime.startsWith("image/")) {
    logStorageError(
      { bucket: PREP_BUCKET, op: "upload", path: "(pre-check)", source: "uploadPrepPhoto" },
      new Error(`format tidak didukung: ${inMime}`),
    );
    return null;
  }

  // 1) Safety-net kompresi. compressImage() sendiri sudah menerapkan aturan
  //    "skip bila < minBytes / hasil >= asli", jadi aman dipanggil dua
  //    kali (di stageFile & di sini) tanpa risiko re-encode berulang.
  let out: Blob = blob;
  if (!opts.skipCompress) {
    try {
      const compressed = await compressImage(out, {
        maxDim: UPLOAD_MAX_DIM,
        quality: UPLOAD_QUALITY,
        minBytes: UPLOAD_COMPRESS_THRESHOLD,
        mimeType: "image/jpeg",
      });
      if (compressed && compressed.size > 0) out = compressed;
    } catch {
      // biarkan blob asli
    }
  }

  // 2) Tentukan ekstensi & MIME final. Prioritas: opts.ext > MIME blob >
  //    "jpg". MIME final selalu konsisten dengan ekstensi (jangan sampai
  //    file `.jpg` diupload dengan Content-Type `image/heic`).
  const ext = (opts.ext ?? extFromMime(out.type)).toLowerCase().replace(/^\./, "");
  const contentType = mimeFromExt(ext);

  if (out.size > UPLOAD_HARD_MAX_BYTES) {
    logStorageError(
      { bucket: PREP_BUCKET, op: "upload", path: "(pre-check)", source: "uploadPrepPhoto" },
      new Error(`file terlalu besar: ${out.size} byte`),
    );
    return null;
  }

  // 3) Bungkus jadi File dengan nama pasti supaya storage & unduhan owner
  //    tetap punya nama file yang bermakna. `blob` yang datang dari
  //    stageFile umumnya sudah File, tapi kita tetap normalisasi agar
  //    MIME dan nama ekstensi selalu sinkron.
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fileName = opts.fileName ?? `${itemId}-${stamp}.${ext}`;
  const path = `${taskToken}/${itemId}/${stamp}.${ext}`;

  let payload: Blob = out;
  const FileCtor = (globalThis as unknown as { File?: typeof File }).File;
  if (typeof FileCtor === "function") {
    try {
      payload = new FileCtor([out], fileName, { type: contentType });
    } catch {
      payload = out;
    }
  }

  const { error } = await client.storage.from(PREP_BUCKET).upload(path, payload, {
    contentType,
    upsert: false,
  });
  if (error) {
    logStorageError({ bucket: PREP_BUCKET, op: "upload", path, source: "uploadPrepPhoto" }, error);
    return null;
  }
  return path;
}

// Format token share: base64url 24 byte ≈ 32 char ([A-Za-z0-9_-]).
// Form pembuatan tugas memperbolehkan 8–48 karakter agar owner bisa
// memakai token yang mudah dikenali; URL publik harus sinkron dengan
// batasan tersebut agar tombol salin link tidak menolak token valid.
const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{8,128}$/;

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