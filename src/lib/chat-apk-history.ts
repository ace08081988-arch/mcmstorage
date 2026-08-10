/**
 * Riwayat versi APK Ace Chat yang pernah diunduh dari perangkat ini.
 * Disimpan di localStorage — per-perangkat, tidak lintas-device.
 *
 * Bentuk entri: { name, versionName, versionCode, url, sizeMB, downloadedAt }
 * Duplikat (name yang sama) di-dedup: entri lama dihapus, versi baru
 * ditulis dengan timestamp terkini di posisi teratas.
 */

import { useEffect, useState } from "react";

export type ChatApkHistoryEntry = {
  name: string;
  versionName: string | null;
  versionCode: number | null;
  url: string;
  sizeMB: number | null;
  downloadedAt: string; // ISO
};

const KEY = "mcm.chat-apk-history.v1";
const EV = "mcm:chat-apk-history-changed";
const MAX_ENTRIES = 20;

function safeParse(raw: string | null): ChatApkHistoryEntry[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (x): x is ChatApkHistoryEntry =>
          !!x &&
          typeof x === "object" &&
          typeof (x as ChatApkHistoryEntry).name === "string" &&
          typeof (x as ChatApkHistoryEntry).url === "string" &&
          typeof (x as ChatApkHistoryEntry).downloadedAt === "string",
      )
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function getChatApkHistory(): ChatApkHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return safeParse(window.localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

export function recordChatApkDownload(entry: Omit<ChatApkHistoryEntry, "downloadedAt">): void {
  if (typeof window === "undefined") return;
  try {
    const existing = getChatApkHistory().filter((e) => e.name !== entry.name);
    const next: ChatApkHistoryEntry[] = [
      { ...entry, downloadedAt: new Date().toISOString() },
      ...existing,
    ].slice(0, MAX_ENTRIES);
    window.localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(EV));
  } catch {
    /* quota / privacy mode — abaikan */
  }
}

export function clearChatApkHistory(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent(EV));
  } catch {
    /* ignore */
  }
}

/** Hook reactive — ikut refresh saat riwayat berubah (termasuk lintas-tab). */
export function useChatApkHistory(): ChatApkHistoryEntry[] {
  const [list, setList] = useState<ChatApkHistoryEntry[]>(() => getChatApkHistory());
  useEffect(() => {
    const on = () => setList(getChatApkHistory());
    window.addEventListener(EV, on);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setList(getChatApkHistory());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EV, on);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return list;
}

/** Format singkat "berapa waktu lalu" berbahasa Indonesia. */
export function formatAgoID(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "-";
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} hari lalu`;
  return new Date(t).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}