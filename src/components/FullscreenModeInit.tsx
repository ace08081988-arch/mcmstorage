import { useEffect } from "react";
import { startDisplayModeWatch } from "@/lib/fullscreen-mode";

/** Memasang pemantau mode tampilan (browser / standalone / layar penuh). */
export function FullscreenModeInit() {
  useEffect(() => startDisplayModeWatch(), []);
  return null;
}

export default FullscreenModeInit;
