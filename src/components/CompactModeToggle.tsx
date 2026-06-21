import { useEffect, useState } from "react";
import { Minimize2, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const LS_KEY = "app-compact-mode";
const DEFAULT_ON = true; // default rilis: padat
export const COMPACT_MODE_EVENT = "compact-mode-change";

export function applyCompactMode() {
  if (typeof document === "undefined") return;
  let raw: string | null = null;
  try { raw = localStorage.getItem(LS_KEY); } catch { /* ignore */ }
  if (raw == null) {
    // First visit: aktifkan mode ringkas sebagai default.
    try { localStorage.setItem(LS_KEY, DEFAULT_ON ? "1" : "0"); } catch { /* ignore */ }
    raw = DEFAULT_ON ? "1" : "0";
  }
  const on = raw === "1";
  document.documentElement.classList.toggle("compact", on);
}

export function CompactModeToggle() {
  const [on, setOn] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const raw = localStorage.getItem(LS_KEY);
    return raw == null ? DEFAULT_ON : raw === "1";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("compact", on);
    localStorage.setItem(LS_KEY, on ? "1" : "0");
    try {
      window.dispatchEvent(new CustomEvent(COMPACT_MODE_EVENT, { detail: { on } }));
    } catch { /* ignore */ }
  }, [on]);

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 w-full justify-start gap-2 px-2 text-xs"
      onClick={() => setOn((v) => !v)}
      title={on ? "Matikan mode ringkas" : "Aktifkan mode ringkas"}
    >
      {on ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
      <span>{on ? "Mode normal" : "Mode ringkas"}</span>
    </Button>
  );
}