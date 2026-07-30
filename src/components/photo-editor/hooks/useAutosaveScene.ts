// Autosave Scene JSON ke IndexedDB (via key generik). Debounce 500ms.
// Reusable — key ditentukan caller (mis. token+item id).

import { useEffect, useRef } from "react";

const DB_NAME = "mcm-photo-editor";
const STORE = "scenes";
const VERSION = 1;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const idb = (globalThis as unknown as { indexedDB?: IDBFactory }).indexedDB;
    if (!idb) { resolve(null); return; }
    const req = idb.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function loadSceneDraft(key: string): Promise<string | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise<string | null>((res) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).get(key);
      r.onsuccess = () => res((r.result as string) ?? null);
      r.onerror = () => res(null);
    } catch { res(null); }
  }).finally(() => { try { db.close(); } catch { /* ignore */ } });
}

export async function clearSceneDraft(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((res) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    } catch { res(); }
  });
  try { db.close(); } catch { /* ignore */ }
}

async function saveSceneDraft(key: string, json: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((res) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(json, key);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    } catch { res(); }
  });
  try { db.close(); } catch { /* ignore */ }
}

export function useAutosaveScene(key: string | undefined, sceneJson: string) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!key) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void saveSceneDraft(key, sceneJson); }, 500);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [key, sceneJson]);
}