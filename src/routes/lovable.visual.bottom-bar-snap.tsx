/**
 * Harness E2E: bilah bawah HARUS selalu "snap" ke dasar layar.
 *
 * Skenario yang diuji spec `tests/e2e/bottom-bar-snap.spec.ts`:
 *   1. Saat halaman digulir (konten panjang).
 *   2. Saat pindah halaman (navigasi client-side lewat search param).
 *   3. Saat konten dinamis bertambah (list tumbuh, tinggi dokumen berubah).
 *
 * Komponen yang dirender adalah `MobileBottomNav` ASLI (bukan salinan
 * markup) sehingga regresi pada `.app-static-bottom-bar`, engine
 * `use-viewport-anchor`, atau `use-bottom-nav-height` langsung tertangkap.
 *
 * URL: /lovable/visual/bottom-bar-snap — noindex, tanpa auth.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { MobileBottomNav } from "@/components/MobileBottomNav";

type Search = { page?: number; rows?: number };

export const Route = createFileRoute("/lovable/visual/bottom-bar-snap")({
  validateSearch: (raw: Record<string, unknown>): Search => {
    const page = Number(raw["page"]);
    const rows = Number(raw["rows"]);
    return {
      page: Number.isFinite(page) && page > 0 ? Math.min(page, 9) : 1,
      rows: Number.isFinite(rows) && rows > 0 ? Math.min(rows, 400) : 30,
    };
  },
  head: () => ({
    meta: [
      { title: "Audit Bilah Bawah — Ace" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: BottomBarSnapHarness,
});

function BottomBarSnapHarness() {
  const { page = 1, rows = 30 } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [extra, setExtra] = useState(0);
  /** Fase loading: konten diganti skeleton lalu kembali (mensimulasikan fetch). */
  const [loading, setLoading] = useState(false);
  /** Streaming bertahap: baris ditambah sedikit demi sedikit tiap frame/tick. */
  const [streaming, setStreaming] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const total = rows + extra;

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );

  const startLoading = () => {
    setLoading(true);
    timers.current.push(setTimeout(() => setLoading(false), 1200));
  };

  /** 12 rerender bertahap @ ~100ms, masing-masing menambah 5 baris. */
  const startStreaming = () => {
    if (streaming) return;
    setStreaming(true);
    for (let i = 1; i <= 12; i++) {
      timers.current.push(
        setTimeout(() => {
          setExtra((n) => n + 5);
          if (i === 12) setStreaming(false);
        }, i * 100),
      );
    }
  };

  return (
    <SidebarProvider>
      <main
        data-bottom-bar-harness
        data-page={page}
        data-loading={loading ? "true" : "false"}
        data-streaming={streaming ? "true" : "false"}
        className="min-h-screen w-full bg-background text-foreground app-bottom-spacer"
        style={{
          paddingLeft: "var(--app-safe-left, 0px)",
          paddingRight: "var(--app-safe-right, 0px)",
        }}
      >
        <header
          className="app-sticky-header p-ms-4" style={{ paddingTop: "calc(var(--app-safe-top, 0px) + 1rem)", paddingLeft: "calc(var(--app-safe-left, 0px) + 1rem)", paddingRight: "calc(var(--app-safe-right, 0px) + 1rem)" }}
        >
          <h1 className="text-ms-lg font-bold">Audit Bilah Bawah</h1>
          <p data-testid="page-label" className="text-ms-xs text-muted-foreground">
            Halaman {page} · {total} baris
          </p>
          <div className="mt-ms-2 flex gap-ms-2">
            <button
              type="button"
              data-testid="go-next-page"
              className="rounded-lg border border-primary/30 px-ms-3 py-ms-2 text-ms-xs"
              onClick={() =>
                void navigate({
                  search: (prev: Search): Search => ({
                    ...prev,
                    page: (page % 3) + 1,
                  }),
                })
              }
            >
              Pindah halaman
            </button>
            <button
              type="button"
              data-testid="add-rows"
              className="rounded-lg border border-primary/30 px-ms-3 py-ms-2 text-ms-xs"
              onClick={() => setExtra((n) => n + 40)}
            >
              Tambah konten
            </button>
            <button
              type="button"
              data-testid="start-loading"
              className="rounded-lg border border-primary/30 px-ms-3 py-ms-2 text-ms-xs"
              onClick={startLoading}
            >
              Muat ulang data
            </button>
            <button
              type="button"
              data-testid="stream-rows"
              className="rounded-lg border border-primary/30 px-ms-3 py-ms-2 text-ms-xs"
              onClick={startStreaming}
            >
              Render bertahap
            </button>
          </div>
        </header>

        {loading ? (
          <div data-testid="loading-skeleton" className="space-y-ms-2 p-ms-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="h-6 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : (
          <ul data-testid="dynamic-list" className="divide-y divide-border">
          {Array.from({ length: total }, (_, i) => (
            <li key={i} className="px-ms-4 py-ms-3 text-ms-sm">
              Baris {i + 1} — halaman {page}
            </li>
          ))}
          </ul>
        )}

        <SidebarStateProbe />
        <MobileBottomNav />
      </main>
    </SidebarProvider>
  );
}
/** Probe status drawer sidebar untuk uji keyboard (Enter/Space di tombol Menu). */
function SidebarStateProbe() {
  // Bilah bawah hanya ada di mobile, jadi yang relevan adalah drawer mobile.
  const { openMobile } = useSidebar();
  return (
    <span data-testid="sidebar-state" className="sr-only">
      {openMobile ? "open" : "closed"}
    </span>
  );
}
