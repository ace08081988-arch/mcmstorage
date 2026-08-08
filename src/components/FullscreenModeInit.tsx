import { useEffect } from "react";
import {
  startAutoFullscreenOnInstalled,
  startDisplayModeWatch,
} from "@/lib/fullscreen-mode";
import { startViewportHeightSync } from "@/lib/viewport-height";

/** Memasang pemantau mode tampilan (browser / standalone / layar penuh). */
export function FullscreenModeInit() {
  useEffect(() => startDisplayModeWatch(), []);
  // PWA terpasang di Android: minta layar penuh pada sentuhan pertama supaya
  // tidak ada pita kosong bilah status di atas header.
  useEffect(() => startAutoFullscreenOnInstalled(), []);
  // `--app-vh` = tinggi layar efektif (ikut bilah alamat) untuk layout chat.
  useEffect(() => startViewportHeightSync(), []);
  return null;
}

export default FullscreenModeInit;
