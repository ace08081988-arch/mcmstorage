// Penyimpanan draft foto sementara (kamera/galeri) untuk halaman pegawai
// `/t/:token`. Blob asli disimpan di IndexedDB agar bertahan lintas refresh
// halaman & pindah tab tanpa perlu meng-upload dulu ke server. localStorage
// tidak dipakai karena tidak bisa menyimpan Blob mentah dan kuotanya kecil.
//
// Kunci draft konvensi: `prep-draft:<token>:<scope>` (mis. `:item:<id>` atau
// `:request:<titleId>`). Draft dibersihkan setelah submit berhasil atau saat
// user menekan "Hapus semua".

const DB_NAME = "mcm-prep-draft";
const STORE = "photos";
const VERSION = 1;

function getIdb(): IDBFactory | null {
  const g = globalThis as unknown as { indexedDB?: IDBFactory };
  return g.indexedDB ?? null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const idb = getIdb();
    if (!idb) { reject(new Error("indexedDB unavailable")); return; }
    const req = idb.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("open failed"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | null): Promise<T | null> {
  if (!getIdb()) return null;
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db!.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      let out: T | null = null;
      if (req) req.onsuccess = () => { out = (req.result as T) ?? null; };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error ?? new Error("tx failed"));
      tx.onabort = () => reject(tx.error ?? new Error("tx abort"));
    });
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

/** Satu foto draft + status "sudah lewat editor". */
export type DraftPhotoEntry = { blob: Blob; edited: boolean };

type DraftRecordV2 = { v: 2; blobs: Blob[]; edited: boolean[] };

function isRecordV2(val: unknown): val is DraftRecordV2 {
  return (
    !!val &&
    typeof val === "object" &&
    (val as { v?: unknown }).v === 2 &&
    Array.isArray((val as DraftRecordV2).blobs)
  );
}

export async function saveDraftPhotos(
  key: string,
  blobs: Blob[],
  edited?: boolean[],
): Promise<void> {
  if (blobs.length === 0) { await clearDraftPhotos(key); return; }
  const rec: DraftRecordV2 = {
    v: 2,
    blobs,
    edited: blobs.map((_, i) => edited?.[i] === true),
  };
  await withStore("readwrite", (s) => s.put(rec, key));
}

/**
 * Muat draft beserta flag `edited`, supaya foto yang sudah melewati
 * PhotoEditor tidak diminta diedit ulang setelah refresh/WebView restart.
 * Format lama (Blob[] polos) tetap didukung → dianggap belum diedit.
 */
export async function loadDraftPhotoEntries(key: string): Promise<DraftPhotoEntry[]> {
  const val = await withStore<unknown>("readonly", (s) => s.get(key));
  if (isRecordV2(val)) {
    return val.blobs
      .map((b, i) => ({ blob: b, edited: val.edited?.[i] === true }))
      .filter((e) => e.blob instanceof Blob);
  }
  if (!Array.isArray(val)) return [];
  return val
    .filter((b): b is Blob => b instanceof Blob)
    .map((blob) => ({ blob, edited: false }));
}

export async function loadDraftPhotos(key: string): Promise<Blob[]> {
  return (await loadDraftPhotoEntries(key)).map((e) => e.blob);
}

export async function clearDraftPhotos(key: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(key));
}

export function itemDraftKey(token: string, itemId: string): string {
  return `prep-draft:${token}:item:${itemId}`;
}
export function requestDraftKey(token: string, titleId: string): string {
  return `prep-draft:${token}:request:${titleId}`;
}