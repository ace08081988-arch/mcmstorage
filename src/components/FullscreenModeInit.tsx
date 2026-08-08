import { useEffect } from "react";
import {
  startAutoFullscreenOnInstalled,
  startDisplayModeWatch,
} from "@/lib/fullscreen-mode";
import { startViewportHeightSync } from "@/lib/viewport-height";
import { startSafeAreaRecalc } from "@/lib/safe-area-recalc";
import { FullscreenExitControl } from "@/components/FullscreenExitControl";

/** Memasang pemantau mode tampilan (browser / standalone / layar penuh). */
export function FullscreenModeInit() {
  useEffect(() => startDisplayModeWatch(), []);
  // PWA terpasang di Android: minta layar penuh pada sentuhan pertama supaya
  // tidak ada pita kosong bilah status di atas header.
  useEffect(() => startAutoFullscreenOnInstalled(), []);
  // `--app-vh` = tinggi layar efektif (ikut bilah alamat) untuk layout chat.
  useEffect(() => startViewportHeightSync(), []);
  // `--app-safe-*` = inset notch/status bar/gesture bar nyata, diukur ulang
  // saat rotasi & perubahan toolbar supaya header tidak terpotong.
  useEffect(() => startSafeAreaRecalc(), []);
  return <FullscreenExitControl />;
}

export default FullscreenModeInit;
