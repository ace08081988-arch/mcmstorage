/**
 * Harness E2E: tombol mengambang (FAB) & action bar lengket tidak boleh
 * tertutup gesture bar / home indicator.
 *
 * Dipakai spec `tests/e2e/fab-action-bar-clearance.spec.ts` pada berbagai
 * lebar (320–1024) dan orientasi (portrait & landscape). Semua elemen yang
 * wajib bebas dari area sistem ditandai `data-clearance`.
 *
 * URL: /lovable/visual/fab-clearance — noindex, tanpa auth.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Send, Trash2 } from "lucide-react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { MobileBottomNav } from "@/components/MobileBottomNav";

type Search = { bar?: string; rows?: number };

export const Route = createFileRoute("/lovable/visual/fab-clearance")({
  validateSearch: (raw: Record<string, unknown>): Search => {
    const rows = Number(raw["rows"]);
    return {
      bar: raw["bar"] === "off" ? "off" : "on",
      rows: Number.isFinite(rows) && rows > 0 ? Math.min(rows, 300) : 40,
    };
  },
  head: () => ({
    meta: [
      { title: "Audit Jarak Aman FAB — Ace" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: FabClearanceHarness,
});

/** Jarak aman bawah standar: gesture bar / bilah navigasi (yang terbesar) + keyboard. */
const SAFE_BOTTOM =
  "calc(max(var(--app-safe-bottom, 0px), var(--app-bottom-bar-space, 0px)) + var(--app-keyboard-inset, 0px) + 1rem)";

function FabClearanceHarness() {
  const { bar = "on", rows = 40 } = Route.useSearch();
  const [selected, setSelected] = useState(true);

  return (
    <SidebarProvider>
      <main
        data-fab-clearance-harness
        className="min-h-screen w-full bg-background text-foreground app-bottom-spacer"
        style={{
          paddingLeft: "var(--app-safe-left, 0px)",
          paddingRight: "var(--app-safe-right, 0px)",
        }}
      >
        <header
          className="app-sticky-header p-ms-4"
          style={{
            paddingTop: "calc(var(--app-safe-top, 0px) + 1rem)",
            paddingLeft: "calc(var(--app-safe-left, 0px) + 1rem)",
            paddingRight: "calc(var(--app-safe-right, 0px) + 1rem)",
          }}
        >
          <h1 className="text-ms-lg font-bold">Audit Jarak Aman FAB</h1>
          <button
            type="button"
            data-testid="toggle-selection"
            className="mt-ms-2 rounded-lg border border-primary/30 px-ms-3 py-ms-2 text-ms-xs"
            onClick={() => setSelected((v) => !v)}
          >
            {selected ? "Kosongkan seleksi" : "Pilih semua"}
          </button>
        </header>

        <ul className="divide-y divide-border">
          {Array.from({ length: rows }, (_, i) => (
            <li key={i} className="px-ms-4 py-ms-3 text-ms-sm">
              Baris {i + 1}
            </li>
          ))}
        </ul>

        {/* FAB utama — dipaku ke kanan bawah di atas gesture bar. */}
        <button
          type="button"
          data-clearance="fab"
          data-testid="fab-tambah"
          aria-label="Tambah data"
          data-floating-ui="fab"
          className="depth-3d fixed z-fab flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
          style={{
            bottom: SAFE_BOTTOM,
            right: "calc(var(--app-safe-right, 0px) + 1rem)",
          }}
        >
          <Plus className="h-6 w-6" aria-hidden="true" />
        </button>

        {/* Action bar seleksi — muncul di atas bilah navigasi bawah. */}
        {selected && bar !== "off" ? (
          <div
            data-clearance="action-bar"
            data-testid="action-bar"
            data-floating-ui="fab"
            className="fixed z-fab flex items-center gap-ms-2 rounded-xl border border-border bg-card p-ms-2 shadow-lg"
            style={{
              bottom: SAFE_BOTTOM,
              left: "calc(var(--app-safe-left, 0px) + 1rem)",
              right: "calc(var(--app-safe-right, 0px) + 5.5rem)",
            }}
          >
            <button
              type="button"
              data-clearance="action-bar-item"
              className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-primary/10 px-ms-3 text-ms-xs"
            >
              <Send className="h-4 w-4" aria-hidden="true" /> Kirim
            </button>
            <button
              type="button"
              data-clearance="action-bar-item"
              className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-destructive/10 px-ms-3 text-ms-xs"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Hapus
            </button>
          </div>
        ) : null}

        <MobileBottomNav />
      </main>
    </SidebarProvider>
  );
}