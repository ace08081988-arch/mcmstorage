import { useEffect } from "react";
import { startDisplayModeWatch } from "@/lib/fullscreen-mode";
import { startViewportHeightSync } from "@/lib/viewport-height";

/** Memasang pemantau mode tampilan (browser / standalone / layar penuh). */
export function FullscreenModeInit() {
  useEffect(() => startDisplayModeWatch(), []);
  // `--app-vh` = tinggi layar efektif (ikut bilah alamat) untuk layout chat.
  useEffect(() => startViewportHeightSync(), []);
  return null;
}

export default FullscreenModeInit;
