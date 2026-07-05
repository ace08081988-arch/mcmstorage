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

  return [mode, setMode];
}

export function layoutGridClass(mode: LayoutMode): string {
  switch (mode) {
    case "grid":
      return "grid grid-cols-2 gap-2";
    case "dense":
      return "grid grid-cols-2 sm:grid-cols-3 gap-1.5";
    case "compact":
      return "grid grid-cols-1 gap-1";
    case "list":
    default:
      return "grid grid-cols-1 gap-2 sm:grid-cols-2";
  }
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