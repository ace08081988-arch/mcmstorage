import { useEffect, useState, useCallback } from "react";
import type { StickerCard } from "@/lib/chat-cards";

/**
 * Koleksi stiker lokal (per device/browser). Disimpan di localStorage agar
 * pengguna bisa pakai ulang stiker yang pernah dibuat — mirip panel stiker WA.
 * - saved   : stiker yang sengaja disimpan (urut terbaru dulu)
 * - recents : stiker yang baru dikirim (auto, dibatasi REC_LIMIT)
 * - fav     : id stiker yang difavoritkan
 */
const KEY_SAVED = "mcm.stickers.saved.v1";
const KEY_RECENTS = "mcm.stickers.recents.v1";
const KEY_FAV = "mcm.stickers.fav.v1";
const REC_LIMIT = 24;
const SAVED_LIMIT = 60;

export type SavedSticker = {
  id: string;
  card: StickerCard;
  created_at: number;
  label?: string;
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
  try { window.dispatchEvent(new CustomEvent("mcm-stickers-changed")); } catch { /* SSR */ }
}

function fingerprint(c: StickerCard): string {
  // Lewatkan transformasi visual (rotation/scale/caption) untuk dedupe.
  const base = { ...c, rotation: 0, scale: 1, caption: "" };
  return JSON.stringify(base);
}

export function getSaved(): SavedSticker[] {
  return read<SavedSticker[]>(KEY_SAVED, []);
}
export function getRecents(): SavedSticker[] {
  return read<SavedSticker[]>(KEY_RECENTS, []);
}
export function getFavSet(): Set<string> {
  return new Set(read<string[]>(KEY_FAV, []));
}

export function saveSticker(card: StickerCard, label?: string): SavedSticker {
  const list = getSaved();
  const fp = fingerprint(card);
  const existing = list.find((s) => fingerprint(s.card) === fp);
  if (existing) return existing;
  const item: SavedSticker = { id: crypto.randomUUID(), card, created_at: Date.now(), label };
  const next = [item, ...list].slice(0, SAVED_LIMIT);
  write(KEY_SAVED, next);
  return item;
}

export function removeSaved(id: string) {
  write(KEY_SAVED, getSaved().filter((s) => s.id !== id));
  // bersihkan favorit yang menggantung
  const fav = getFavSet(); if (fav.delete(id)) write(KEY_FAV, Array.from(fav));
}

export function toggleFav(id: string) {
  const fav = getFavSet();
  if (fav.has(id)) fav.delete(id); else fav.add(id);
  write(KEY_FAV, Array.from(fav));
}

export function pushRecent(card: StickerCard) {
  const fp = fingerprint(card);
  const list = getRecents().filter((s) => fingerprint(s.card) !== fp);
  const item: SavedSticker = { id: crypto.randomUUID(), card, created_at: Date.now() };
  write(KEY_RECENTS, [item, ...list].slice(0, REC_LIMIT));
}

/** React hook reaktif: dengar storage + event lokal. */
export function useStickerLibrary() {
  const [snap, setSnap] = useState(() => ({
    saved: getSaved(),
    recents: getRecents(),
    fav: getFavSet(),
  }));
  const refresh = useCallback(() => {
    setSnap({ saved: getSaved(), recents: getRecents(), fav: getFavSet() });
  }, []);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key.startsWith("mcm.stickers.")) refresh();
    };
    const onLocal = () => refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener("mcm-stickers-changed", onLocal as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("mcm-stickers-changed", onLocal as EventListener);
    };
  }, [refresh]);
  return { ...snap, refresh };
}