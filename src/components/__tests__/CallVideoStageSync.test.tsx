// @vitest-environment happy-dom
/**
 * Integration test (React + happy-dom) untuk properti sinkron
 * `objectFit`/`objectPosition` antara dua elemen `<video>` yang
 * merepresentasikan remote (besar) dan preview lokal (PiP) di CallScreen.
 *
 * Test ini TIDAK me-mount `CallScreen` langsung — komponen itu bergantung
 * pada WebRTC/Supabase/getUserMedia. Alih-alih, kita membangun harness
 * kecil yang menggunakan HELPER YANG SAMA dipakai `CallScreen`
 * (`computeVideoStyle` + `videoFitClassFor`) untuk mengelola style kedua
 * video. Ini melindungi properti kritis:
 *
 *   1. Kedua video selalu punya `objectFit` yang sama.
 *   2. Kedua video selalu punya `objectPosition` yang sama.
 *   3. Properti (1)+(2) tetap sinkron setelah:
 *      - toggle Crop ↔ Fit,
 *      - siklus posisi preset (center → top → right → …),
 *      - swap besar/kecil (remote ↔ lokal),
 *      - swap kamera front ↔ back tanpa reload (dengan state
 *        posisi/fit per-kamera terpisah, seperti di CallScreen).
 *
 * Kalau ada regresi mengarahkan salah satu <video> ke sumber style
 * berbeda, test ini gagal — bukan menunggu QA manual.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  computeVideoStyle, videoFitClassFor,
  type VideoFit, type VideoPosPreset, type VideoPosXY,
} from "@/lib/call-video-style";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

// ---------- Harness ----------
// Mirror struktur CallScreen: fit + preset + custom disimpan PER-KAMERA
// (front/back) sehingga swap kamera memakai state yang sesuai. Elemen
// remote & lokal menerima style yang sama, style diselaraskan lewat
// helper `computeVideoStyle` — satu sumber kebenaran.

type Facing = "user" | "environment";

function Stage() {
  const [facing, setFacing] = useState<Facing>("user");
  const [fitFront, setFitFront] = useState<VideoFit>("cover");
  const [fitBack, setFitBack] = useState<VideoFit>("cover");
  const [posFront, setPosFront] = useState<VideoPosPreset>("center");
  const [posBack, setPosBack] = useState<VideoPosPreset>("center");
  const [customFront, setCustomFront] = useState<VideoPosXY | null>(null);
  const [customBack, setCustomBack] = useState<VideoPosXY | null>(null);
  const [swapped, setSwapped] = useState(false);

  const fit = facing === "user" ? fitFront : fitBack;
  const pos = facing === "user" ? posFront : posBack;
  const custom = facing === "user" ? customFront : customBack;
  const style = computeVideoStyle(fit, pos, custom);
  const cls = videoFitClassFor(fit);

  function toggleFit() {
    if (facing === "user") setFitFront((f) => (f === "cover" ? "contain" : "cover"));
    else setFitBack((f) => (f === "cover" ? "contain" : "cover"));
  }
  function cyclePos() {
    const next = (p: VideoPosPreset): VideoPosPreset =>
      p === "center" ? "top"
      : p === "top" ? "right"
      : p === "right" ? "bottom"
      : p === "bottom" ? "left"
      : "center";
    if (facing === "user") { setPosFront(next); setCustomFront(null); }
    else { setPosBack(next); setCustomBack(null); }
  }
  function dragTo(x: number, y: number) {
    if (facing === "user") setCustomFront({ x, y });
    else setCustomBack({ x, y });
  }

  return (
    <div>
      <video data-testid="remote" className={cls} style={style} />
      <video data-testid="local" className={cls} style={style} />
      <div data-testid="state"
        data-facing={facing}
        data-fit={fit}
        data-pos={pos}
        data-swapped={String(swapped)}
      />
      <button data-testid="toggleFit" onClick={toggleFit}>fit</button>
      <button data-testid="cyclePos" onClick={cyclePos}>pos</button>
      <button data-testid="swap" onClick={() => setSwapped((s) => !s)}>swap</button>
      <button data-testid="flip" onClick={() =>
        setFacing((f) => (f === "user" ? "environment" : "user"))} >flip</button>
      <button data-testid="drag" onClick={() => dragTo(20, 80)}>drag</button>
    </div>
  );
}

// ---------- Utilities ----------
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(<Stage />); });
});
afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

function q(testid: string): HTMLElement {
  const el = container.querySelector(`[data-testid="${testid}"]`);
  if (!el) throw new Error(`missing testid ${testid}`);
  return el as HTMLElement;
}
function click(testid: string) {
  act(() => { q(testid).click(); });
}
function stylesOf() {
  const remote = q("remote") as HTMLVideoElement;
  const local = q("local") as HTMLVideoElement;
  return {
    remoteFit: remote.style.objectFit,
    localFit: local.style.objectFit,
    remotePos: remote.style.objectPosition,
    localPos: local.style.objectPosition,
    remoteClass: remote.className,
    localClass: local.className,
  };
}
function assertSynced() {
  const s = stylesOf();
  expect(s.remoteFit).toBe(s.localFit);
  expect(s.remotePos).toBe(s.localPos);
  expect(s.remoteClass).toBe(s.localClass);
}

// ---------- Cases ----------
describe("CallScreen video sync (remote ↔ preview lokal)", () => {
  it("kondisi awal: kedua video pakai objectFit & objectPosition sama", () => {
    assertSynced();
    const s = stylesOf();
    expect(s.remoteFit).toBe("cover");
    expect(s.remotePos).toBe("50% 50%");
  });

  it("toggle Crop ↔ Fit tetap sinkron di kedua video", () => {
    click("toggleFit"); // cover → contain
    assertSynced();
    expect(stylesOf().remoteFit).toBe("contain");
    // Contain WAJIB reset posisi (helper mengunci ke 50% 50%).
    expect(stylesOf().remotePos).toBe("50% 50%");

    click("toggleFit"); // contain → cover
    assertSynced();
    expect(stylesOf().remoteFit).toBe("cover");
  });

  it("siklus posisi preset saat mode cover — kedua video ikut geser", () => {
    click("cyclePos"); // center → top
    assertSynced();
    expect(stylesOf().remotePos).toBe("50% 0%");
    click("cyclePos"); // top → right
    assertSynced();
    expect(stylesOf().remotePos).toBe("100% 50%");
  });

  it("drag custom posisi berlaku identik untuk remote & local", () => {
    click("drag");
    assertSynced();
    expect(stylesOf().remotePos).toBe("20.0% 80.0%");
  });

  it("swap besar/kecil TIDAK mengubah sinkronisasi style", () => {
    click("cyclePos"); // pindah dulu supaya beda dari default
    click("swap");
    assertSynced();
    click("swap");
    assertSynced();
  });

  it("swap kamera user ↔ environment (tanpa reload) — style ikut state kamera aktif dan tetap sinkron", () => {
    // Set kamera front ke posisi 'top' + custom drag.
    click("cyclePos"); // front: top
    click("drag"); // front: custom (20,80)
    assertSynced();
    const frontPos = stylesOf().remotePos;
    expect(frontPos).toBe("20.0% 80.0%");

    // Flip ke kamera belakang — belum diubah, jadi harus kembali ke default.
    click("flip");
    assertSynced();
    expect(stylesOf().remotePos).toBe("50% 50%");

    // Ubah preset kamera belakang jadi 'top'.
    click("cyclePos"); // back: top
    assertSynced();
    expect(stylesOf().remotePos).toBe("50% 0%");

    // Flip balik ke kamera depan — state front tersimpan (custom drag).
    click("flip");
    assertSynced();
    expect(stylesOf().remotePos).toBe(frontPos);
  });

  it("gabungan: swap kamera + swap besar/kecil + toggle fit, semua langkah tetap sinkron", () => {
    const steps = ["cyclePos", "swap", "flip", "toggleFit", "swap", "flip", "cyclePos"] as const;
    for (const s of steps) {
      click(s);
      assertSynced();
    }
  });
});