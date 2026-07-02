// @vitest-environment happy-dom
/**
 * Unit test untuk `ChatModeSplash`.
 *
 * Yang diverifikasi:
 *  1. Saat `prefers-reduced-motion: reduce` aktif, splash TIDAK
 *     melakukan transisi fade — `fade` scheduler dijadwalkan pada
 *     durasi 0ms sehingga `visible` langsung menjadi `false` tepat
 *     setelah hold selesai (tanpa jeda animasi). Kita juga memastikan
 *     className mengandung `motion-reduce:transition-none` untuk
 *     kasus di mana keyframes CSS terpakai.
 *  2. Splash konsisten saat "pindah halaman": remount komponen di
 *     session yang sama TIDAK menampilkan splash lagi (dilindungi
 *     `sessionStorage` + flag modul).
 *
 * Catatan: `ChatModeSplash` men-schedule state via `setTimeout` &
 * merender via `createPortal(document.body)`, jadi kita pakai
 * `vi.useFakeTimers()` dan periksa DOM `document.body` (bukan wrapper
 * container React).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// React 19: perlu flag ini di test env agar `act()` tidak memancarkan
// warning "The current testing environment is not configured...".
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

// Kontrol return value `isChatOnly()` per-test.
let chatOnly = true;
vi.mock("@/lib/app-mode", () => ({
  isChatOnly: () => chatOnly,
}));

// Fabrikasi `window.matchMedia` yang bisa diarahkan per-test untuk
// mensimulasikan `prefers-reduced-motion: reduce`.
let reduceMotion = false;
// Instrumentasi listener untuk memverifikasi cleanup (add/remove
// listener) — kalau komponen mendaftarkan `change` listener ke
// media query, harus melepasnya saat unmount agar tidak memicu
// `setState` setelah komponen hilang (misal setelah navigasi klien).
let mmListenerAdds = 0;
let mmListenerRemoves = 0;
// Rekam setiap query yang diminta ke `window.matchMedia` supaya kita
// bisa memverifikasi splash membaca ulang preferensi setiap mount
// (bukan memakai nilai cache lama antar-navigasi).
let mmQueries: string[] = [];
function installMatchMedia() {
  mmListenerAdds = 0;
  mmListenerRemoves = 0;
  mmQueries = [];
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      mmQueries.push(query);
      return {
      matches: reduceMotion && query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: () => {
        mmListenerAdds += 1;
      },
      removeEventListener: () => {
        mmListenerRemoves += 1;
      },
      addListener: () => {
        mmListenerAdds += 1;
      },
      removeListener: () => {
        mmListenerRemoves += 1;
      },
      dispatchEvent: () => false,
    };
    },
  });
}

async function loadComponent() {
  vi.resetModules();
  const mod = await import("../ChatModeSplash");
  return mod.ChatModeSplash;
}

function mount(Component: React.ComponentType): { root: Root; host: HTMLDivElement } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<Component />);
  });
  return { root, host };
}

function splashNode(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[aria-label="Memuat MCM Chat"]');
}

beforeEach(() => {
  vi.useFakeTimers();
  chatOnly = true;
  reduceMotion = false;
  installMatchMedia();
  window.sessionStorage.clear();
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ChatModeSplash · prefers-reduced-motion", () => {
  it("tidak melakukan transisi fade dan hilang tanpa jeda animasi", async () => {
    reduceMotion = true;
    const Splash = await loadComponent();
    const { root } = mount(Splash);

    // Setelah mount + useEffect, splash tampak.
    act(() => {
      // Biarkan efek berjalan.
    });
    const el = splashNode();
    expect(el).not.toBeNull();
    // Marker className harus tetap ada supaya CSS `motion-reduce`
    // tidak menganimasikan opacity meski komponen dipakai di
    // konteks lain.
    expect(el!.className).toContain("motion-reduce:transition-none");

    // Reduce-motion: hold=400ms, fade=0ms → total sampai unmount = 400ms.
    // Setelah 399ms splash masih ada, setelah 400ms sudah hilang.
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(splashNode()).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    // Kedua timer (fade + unmount) jatuh di tick yang sama karena
    // fade=0ms → splash langsung tidak dirender lagi tanpa jeda fade.
    expect(splashNode()).toBeNull();

    // Session key harus tercatat supaya remount berikutnya tidak
    // memutar splash lagi.
    expect(window.sessionStorage.getItem("mcm.chat.splashShown")).toBe("1");

    act(() => root.unmount());
  });

  it("mode normal (motion penuh) menahan fade selama FADE_MS", async () => {
    reduceMotion = false;
    const Splash = await loadComponent();
    const { root } = mount(Splash);

    // hold = 1000ms, fade = 500ms.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // Splash masih dirender selama fase fade — opacity-0 tapi node
    // belum di-unmount.
    const midFade = splashNode();
    expect(midFade).not.toBeNull();
    expect(midFade!.className).toContain("opacity-0");
    expect(midFade!.getAttribute("style") ?? "").toContain("transition-duration: 500ms");

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(splashNode()).toBeNull();

    act(() => root.unmount());
  });
});

describe("ChatModeSplash · konsistensi antar-navigasi", () => {
  it("remount di session yang sama TIDAK menampilkan splash lagi", async () => {
    reduceMotion = true;
    const Splash = await loadComponent();

    // Mount pertama: splash tampil lalu selesai.
    const first = mount(Splash);
    expect(splashNode()).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(splashNode()).toBeNull();
    act(() => first.root.unmount());
    // Pastikan sessionStorage-nya tercatat — inilah kontrak konsistensi.
    expect(window.sessionStorage.getItem("mcm.chat.splashShown")).toBe("1");

    // Mount kedua (mensimulasikan pindah halaman): splash TIDAK
    // muncul lagi meskipun `mcm.chat.splashShown` di sessionStorage
    // hadir. Tidak ada `document.body` node baru untuk splash.
    const second = mount(Splash);
    // Jalankan semua timer — kalau splash akan ditampilkan,
    // node-nya sudah ada di sini.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(splashNode()).toBeNull();
    act(() => second.root.unmount());
  });

  it("session baru (sessionStorage kosong, flag modul reset) menampilkan splash lagi", async () => {
    reduceMotion = true;
    // Simulasi session baru: sessionStorage sudah dibersihkan di
    // beforeEach, dan `loadModule()` fresh-import ChatModeSplash
    // sehingga flag modul `shownThisSession` reset.
    const Splash = await loadComponent();
    const { root } = mount(Splash);
    expect(splashNode()).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(splashNode()).toBeNull();
    act(() => root.unmount());
  });

  it("mode non-chat tidak pernah menampilkan splash apapun", async () => {
    chatOnly = false;
    reduceMotion = false;
    const Splash = await loadComponent();
    const { root } = mount(Splash);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(splashNode()).toBeNull();
    // Session storage juga tidak dicemari.
    expect(window.sessionStorage.getItem("mcm.chat.splashShown")).toBeNull();
    act(() => root.unmount());
  });
});

describe("ChatModeSplash · toggle prefers-reduced-motion", () => {
  // Kontrak yang diverifikasi:
  //  - `matchMedia("prefers-reduced-motion: reduce")` dibaca SEKALI pada
  //     mount di dalam useEffect. Toggle nilai media query di tengah
  //     siklus splash TIDAK boleh mengubah timeline yang sudah
  //     terjadwal — kalau berubah, user akan melihat transisi janggal
  //     (mis. splash tiba-tiba hilang di tengah fade, atau fade muncul
  //     padahal reduce baru saja aktif).
  //  - Sebaliknya, mount berikutnya di session/import baru HARUS
  //     memakai nilai reduce-motion terbaru — bukan value yang di-cache.

  it("toggle reduce→normal setelah mount TIDAK memperpanjang atau memicu fade", async () => {
    reduceMotion = true;
    const Splash = await loadComponent();
    const { root } = mount(Splash);
    expect(splashNode()).not.toBeNull();

    // Simulasikan user menonaktifkan reduce-motion setelah splash
    // mulai — timeline reduce (hold 400ms, fade 0ms) tetap berlaku.
    reduceMotion = false;
    installMatchMedia();

    // Setelah 399ms masih ada; setelah 400ms sudah hilang tanpa fade.
    act(() => {
      vi.advanceTimersByTime(399);
    });
    const midway = splashNode();
    expect(midway).not.toBeNull();
    // Tidak boleh masuk fase fade (className opacity-0) — reduce tetap.
    expect(midway!.className).not.toContain("opacity-0");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(splashNode()).toBeNull();
    expect(window.sessionStorage.getItem("mcm.chat.splashShown")).toBe("1");

    act(() => root.unmount());
  });

  it("toggle normal→reduce setelah mount TIDAK memangkas fade yang sudah terjadwal", async () => {
    reduceMotion = false;
    const Splash = await loadComponent();
    const { root } = mount(Splash);
    expect(splashNode()).not.toBeNull();

    // User baru saja mengaktifkan reduce-motion di tengah hold —
    // seharusnya tidak memaksa splash hilang lebih cepat.
    reduceMotion = true;
    installMatchMedia();

    act(() => {
      vi.advanceTimersByTime(999);
    });
    // Masih di fase hold, belum fade.
    expect(splashNode()).not.toBeNull();
    expect(splashNode()!.className).not.toContain("opacity-0");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    // hold selesai → masuk fase fade (opacity-0), node MASIH ada.
    const fading = splashNode();
    expect(fading).not.toBeNull();
    expect(fading!.className).toContain("opacity-0");
    expect(fading!.getAttribute("style") ?? "").toContain(
      "transition-duration: 500ms",
    );

    // Fade penuh 500ms harus diselesaikan — bukan dipotong ke 0.
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(splashNode()).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(splashNode()).toBeNull();

    act(() => root.unmount());
  });

  it("mount berikutnya di session baru memakai nilai reduce-motion yang baru", async () => {
    // Session #1 dengan reduce=true → selesai singkat.
    reduceMotion = true;
    const Splash1 = await loadComponent();
    const first = mount(Splash1);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(splashNode()).toBeNull();
    act(() => first.root.unmount());

    // Simulasi session baru: bersihkan session storage & re-import
    // modul supaya `shownThisSession` flag reset — lalu toggle
    // reduce-motion ke OFF. Timeline mount berikutnya harus penuh.
    window.sessionStorage.clear();
    reduceMotion = false;
    installMatchMedia();
    const Splash2 = await loadComponent();
    const second = mount(Splash2);
    expect(splashNode()).not.toBeNull();

    // Belum masuk fade sebelum hold penuh (1000ms).
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(splashNode()!.className).not.toContain("opacity-0");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    // Sekarang fase fade — bukti timeline reduce=false benar-benar
    // terpakai di mount baru, bukan value lama.
    expect(splashNode()!.className).toContain("opacity-0");

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(splashNode()).toBeNull();
    act(() => second.root.unmount());
  });
});

describe("ChatModeSplash · cleanup saat unmount", () => {
  // Kontrak: setelah komponen unmount (mis. karena navigasi klien
  // pindah route dan __root remount subtree), TIDAK boleh ada
  // `setState` yang terpicu dari timer/listener yang masih hidup —
  // ini menyebabkan warning "state update on unmounted component"
  // di React dan bisa menulis sessionStorage secara janggal.

  it("unmount mid-splash membatalkan timer sehingga tidak ada setState pascanavigasi", async () => {
    reduceMotion = false;
    const Splash = await loadComponent();
    const { root } = mount(Splash);
    expect(splashNode()).not.toBeNull();

    // Unmount SEBELUM hold selesai — mensimulasikan user pindah
    // halaman di tengah splash.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => root.unmount());

    // Kalau timer tidak dibersihkan, `setFading(true)` @1000ms dan
    // `setVisible(false)` @1500ms akan tetap jalan → biasanya juga
    // menulis sessionStorage. Kita jalankan seluruh timeline dan
    // pastikan tidak ada efek samping.
    const errors: unknown[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      act(() => {
        vi.advanceTimersByTime(5000);
      });
    } finally {
      console.error = origError;
    }

    // Tidak ada warning React "update on unmounted component".
    const joined = errors
      .map((a) => (Array.isArray(a) ? a.join(" ") : String(a)))
      .join("\n");
    expect(joined).not.toMatch(/unmounted component/i);
    expect(joined).not.toMatch(/act\(\)/i);

    // Node tidak muncul kembali.
    expect(splashNode()).toBeNull();

    // sessionStorage TIDAK boleh ditulis karena t2 dibatalkan sebelum
    // sempat menandai splash selesai — session berikutnya harus tetap
    // bisa memutar splash penuh kalau tab tidak ditutup.
    expect(window.sessionStorage.getItem("mcm.chat.splashShown")).toBeNull();
  });

  it("jumlah addEventListener matchMedia diimbangi removeEventListener saat unmount", async () => {
    reduceMotion = true;
    const Splash = await loadComponent();
    const { root } = mount(Splash);

    // Snapshot counter setelah mount + effect berjalan.
    const addsAfterMount = mmListenerAdds;
    const removesBeforeUnmount = mmListenerRemoves;

    act(() => root.unmount());

    // Kontrak: setiap listener yang didaftarkan pada media query
    // harus dibersihkan saat unmount. Implementasi sekarang tidak
    // memasang listener sama sekali (0 === 0), test ini juga
    // mengunci kontrak itu supaya penambahan listener di masa
    // depan wajib disertai cleanup.
    const netListeners =
      addsAfterMount - removesBeforeUnmount - (mmListenerRemoves - removesBeforeUnmount);
    expect(netListeners).toBe(0);
    expect(mmListenerAdds).toBe(mmListenerRemoves);
  });
});

describe("ChatModeSplash · toggle reduce-motion bertubi-tubi", () => {
  // Kontrak: timeline (hold + fade) ditetapkan sekali di mount dari
  // snapshot `matchMedia` awal. Toggle media query berkali-kali
  // dalam waktu singkat TIDAK boleh:
  //   - menjadwalkan timer tambahan (splash tidak boleh "flicker"
  //     antara opacity-100/opacity-0 lebih dari sekali),
  //   - memperpanjang atau memangkas total durasi yang sudah
  //     terjadwal,
  //   - menulis sessionStorage lebih dari sekali.

  it("toggle 10x dalam 200ms tidak menghasilkan timeline yang tumpang tindih (start=normal)", async () => {
    reduceMotion = false;
    const Splash = await loadComponent();
    const { root } = mount(Splash);
    expect(splashNode()).not.toBeNull();

    // Toggle 10x dalam 200ms (fase hold masih berjalan).
    for (let i = 0; i < 10; i++) {
      reduceMotion = i % 2 === 0;
      installMatchMedia();
      act(() => {
        vi.advanceTimersByTime(20);
      });
    }
    // Total 200ms — masih fase hold penuh (1000ms). Belum fade.
    const midClass = splashNode()!.className;
    expect(midClass).not.toContain("opacity-0");
    // sessionStorage belum ditulis di tengah timeline.
    // sessionStorage belum ditulis di tengah timeline.
    expect(window.sessionStorage.getItem("mcm.chat.splashShown")).toBeNull();

    // Lanjut sampai 999ms total — masih hold.
    act(() => {
      vi.advanceTimersByTime(799);
    });
    expect(splashNode()!.className).not.toContain("opacity-0");

    // 1000ms → fade mulai (opacity-0), transitionDuration tetap 500ms
    // sesuai timeline mount (tidak dipotong oleh toggle terakhir).
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const fadeEl = splashNode();
    expect(fadeEl).not.toBeNull();
    expect(fadeEl!.className).toContain("opacity-0");
    expect(fadeEl!.getAttribute("style") ?? "").toContain(
      "transition-duration: 500ms",
    );

    // 1500ms total → unmount.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(splashNode()).toBeNull();

    // Tepat satu penanda tersimpan — bukti tidak ada timer duplikat
    // yang tumpang tindih. Jalankan sisa timer dan pastikan
    // splash tidak muncul lagi.
    expect(window.sessionStorage.getItem("mcm.chat.splashShown")).toBe("1");
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(splashNode()).toBeNull();
    expect(window.sessionStorage.getItem("mcm.chat.splashShown")).toBe("1");
    act(() => root.unmount());
  });

  it("toggle 10x dalam 100ms (start=reduce) tetap menyelesaikan splash sesuai timeline reduce", async () => {
    reduceMotion = true;
    const Splash = await loadComponent();
    const { root } = mount(Splash);
    expect(splashNode()).not.toBeNull();

    // Toggle cepat 10x dalam 100ms total.
    for (let i = 0; i < 10; i++) {
      reduceMotion = i % 2 === 1; // mulai flip ke false
      installMatchMedia();
      act(() => {
        vi.advanceTimersByTime(10);
      });
    }
    // 100ms — masih di dalam hold reduce (400ms). Tidak boleh sudah
    // fade, tidak boleh sudah selesai.
    expect(splashNode()).not.toBeNull();
    expect(splashNode()!.className).not.toContain("opacity-0");
    expect(window.sessionStorage.getItem("mcm.chat.splashShown")).toBeNull();

    // 399ms total — masih ada.
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(splashNode()).not.toBeNull();

    // 400ms total → reduce timeline: hold+fade(0) bareng → langsung
    // hilang. Persis satu tulis sessionStorage.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(splashNode()).toBeNull();
    expect(window.sessionStorage.getItem("mcm.chat.splashShown")).toBe("1");

    // Lanjut jalankan semua timer tersisa — pastikan tidak ada
    // callback tambahan yang menulis lagi.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(splashNode()).toBeNull();
    expect(window.sessionStorage.getItem("mcm.chat.splashShown")).toBe("1");
    act(() => root.unmount());
  });
});