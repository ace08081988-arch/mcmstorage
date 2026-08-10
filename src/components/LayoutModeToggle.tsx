import { useEffect, useState } from "react";
import { LayoutList, LayoutGrid, Grid3x3, Rows3 } from "lucide-react";

export type LayoutMode = "list" | "grid" | "dense" | "compact";

const MODES: { mode: LayoutMode; label: string; Icon: typeof LayoutList }[] = [
  { mode: "list", label: "1 kolom", Icon: LayoutList },
  { mode: "grid", label: "2 kolom", Icon: LayoutGrid },
  { mode: "dense", label: "3 kolom", Icon: Grid3x3 },
  { mode: "compact", label: "Kompak", Icon: Rows3 },
];

const STORAGE_PREFIX = "mcm.layoutMode.";
const SAME_TAB_EVENT = "mcm:layoutMode";

type LayoutModeChangeDetail = { key: string; mode: LayoutMode };

function isMode(v: unknown): v is LayoutMode {
  return v === "list" || v === "grid" || v === "dense" || v === "compact";
}

export function useLayoutMode(key: string, initial: LayoutMode = "list"): [LayoutMode, (m: LayoutMode) => void] {
  const [mode, setMode] = useState<LayoutMode>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
      return isMode(raw) ? raw : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_PREFIX + key, mode);
    } catch {
      /* ignore */
    }
  }, [key, mode]);

  // Sinkronisasi antar-instance di tab yang sama: event `storage` tidak
  // di-fire di tab yang menulis, jadi kalau dua komponen (mis. daftar
  // utama + dialog detail) sama-sama pakai `useLayoutMode("readyEcer")`,
  // toggle di satu komponen tidak akan mengubah komponen lain tanpa
  // bantuan pub/sub ini.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onSameTab = (e: Event) => {
      const detail = (e as CustomEvent<LayoutModeChangeDetail>).detail;
      if (!detail || detail.key !== key) return;
      if (isMode(detail.mode)) setMode(detail.mode);
    };
    window.addEventListener(SAME_TAB_EVENT, onSameTab as EventListener);
    return () => window.removeEventListener(SAME_TAB_EVENT, onSameTab as EventListener);
  }, [key]);

  // Sinkronisasi antar-tab: dengarkan perubahan localStorage dari tab lain.
  // Event `storage` hanya di-fire di tab lain (bukan tab yang menulis), jadi
  // aman untuk langsung setMode tanpa loop.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const storageKey = STORAGE_PREFIX + key;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey || e.storageArea !== window.localStorage) return;
      if (e.newValue === null) {
        setMode(initial);
        return;
      }
      if (isMode(e.newValue)) setMode(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key, initial]);

  const setModeBroadcast = (m: LayoutMode) => {
    setMode(m);
    if (typeof window !== "undefined") {
      try {
        window.dispatchEvent(
          new CustomEvent<LayoutModeChangeDetail>(SAME_TAB_EVENT, {
            detail: { key, mode: m },
          }),
        );
      } catch {
        /* ignore */
      }
    }
  };

  return [mode, setModeBroadcast];
}

export function layoutGridClass(mode: LayoutMode): string {
  switch (mode) {
    case "grid":
      return "grid grid-cols-2 gap-ms-2";
    case "dense":
      return "grid grid-cols-2 sm:grid-cols-3 gap-ms-1.5";
    case "compact":
      return "grid grid-cols-1 gap-ms-1";
    case "list":
    default:
      return "grid grid-cols-1 gap-ms-2 sm:grid-cols-2";
  }
}

/**
 * Grid class untuk pasangan input di dialog form (mis. Target/Satuan,
 * Latitude/Longitude, Kemasan/Isi). Mengikuti mode tersimpan halaman
 * induk supaya dialog konsisten dengan preferensi user:
 *   - compact → 1 kolom (menumpuk penuh)
 *   - list/grid/dense → responsif: 1 kolom di HP, 2 kolom mulai `sm:`
 *
 * Field pair dibatasi maksimum 2 kolom karena label + input butuh
 * ruang minimum yang layak; mode `dense` (3-col) tetap dipetakan ke 2
 * kolom agar tidak memaksa input jadi terlalu sempit.
 */
export function layoutFieldPairClass(mode: LayoutMode): string {
  if (mode === "compact") return "grid grid-cols-1 gap-ms-2";
  return "grid grid-cols-1 gap-ms-2 sm:grid-cols-2";
}

export function LayoutModeToggle({
  mode,
  onChange,
  className = "",
}: {
  mode: LayoutMode;
  onChange: (m: LayoutMode) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Mode tata ruang"
      className={"inline-flex overflow-hidden rounded-md border bg-card " + className}
    >
      {MODES.map(({ mode: m, label, Icon }) => {
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => onChange(m)}
            className={
              "flex h-6 w-6 items-center justify-center transition-colors " +
              (active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")
            }
          >
            <Icon className="h-3 w-3" />
          </button>
        );
      })}
    </div>
  );
}