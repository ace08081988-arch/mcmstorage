import { useEffect, useState } from "react";
import { Minimize2, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const LS_KEY = "app-compact-mode";

export function applyCompactMode() {
  if (typeof document === "undefined") return;
  const on = localStorage.getItem(LS_KEY) === "1";
  document.documentElement.classList.toggle("compact", on);
}

export function CompactModeToggle() {
  const [on, setOn] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(LS_KEY) === "1";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("compact", on);
    localStorage.setItem(LS_KEY, on ? "1" : "0");
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