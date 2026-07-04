import { useCallback, useEffect, useRef, useState } from "react";

/**
 * State React yang di-mirror ke `localStorage` dan tetap sinkron saat:
 *  - user berpindah tab / kembali ke tab (event `visibilitychange`, `focus`)
 *  - value diubah dari tab lain (event `storage`)
 *  - komponen di-unmount lalu dipasang lagi (initial value baca localStorage)
 *
 * Parse mengembalikan `null` untuk nilai tidak valid — dalam kasus itu
 * fallback ke `initial`. Menulis nilai memakai flag internal supaya event
 * `storage` yang datang dari tab yang sama (mis. write-back) tidak memicu
 * loop update.
 */
export function usePersistedState<T>(
  key: string,
  parse: (raw: string | null) => T | null,
  initial: T,
): [T, (v: T | ((prev: T) => T)) => void] {
  const read = useCallback((): T => {
    if (typeof window === "undefined") return initial;
    try {
      const parsed = parse(window.localStorage.getItem(key));
      return parsed ?? initial;
    } catch {
      return initial;
    }
  }, [key, parse, initial]);

  const [value, setValue] = useState<T>(read);
  const valueRef = useRef(value);
  valueRef.current = value;

  // Tulis ke localStorage tiap kali value berubah.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const serialized = typeof value === "string" ? value : JSON.stringify(value);
      window.localStorage.setItem(key, serialized);
    } catch {
      /* penuh / dinonaktifkan — abaikan */
    }
  }, [key, value]);

  // Re-sync saat kembali ke tab atau saat tab lain menulis nilai baru.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => {
      const next = read();
      // Bandingkan by-value untuk primitive; untuk objek biarkan React
      // yang membandingkan referensi (setValue sudah bail-out via Object.is).
      if (!Object.is(next, valueRef.current)) setValue(next);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === key) sync();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", sync);
    };
  }, [key, read]);

  return [value, setValue];
}

/** Helper parse untuk state string dengan whitelist nilai valid. */
export function parseEnum<T extends string>(allowed: readonly T[]) {
  return (raw: string | null): T | null =>
    raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}