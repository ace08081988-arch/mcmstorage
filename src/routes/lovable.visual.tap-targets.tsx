/**
 * Harness statis untuk audit tap-target tombol aksi.
 *
 * Merender tiap kombinasi <Button> variant × size DAN pola baris aksi
 * yang benar-benar dipakai di app (2-col Batal/Simpan, chip icon di
 * kartu, dsb.) supaya spec Playwright bisa mengukur bounding box
 * setiap tombol tanpa perlu login.
 *
 * Marker DOM yang dipakai spec:
 *   [data-tap-target]        — tombol yang ikut audit ukuran.
 *   [data-tap-target-kind]   — "text" | "icon".
 *   [data-action-row]        — kontainer baris tombol; gap antar-tombol
 *                              dalam kontainer ini diaudit ≥ 8px.
 *
 * URL: /lovable/visual/tap-targets
 * Tidak diindeks, tidak butuh auth, tidak ada network.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Trash2, Copy, Send, Edit3, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/lovable/visual/tap-targets")({
  head: () => ({
    meta: [
      { title: "Tap Target Audit — MCM" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: TapTargetsHarness,
});

const VARIANTS = ["default", "destructive", "outline", "secondary", "ghost"] as const;
const SIZES = ["default", "sm", "lg", "icon"] as const;

function TapTargetsHarness() {
  return (
    <main className="mx-auto max-w-md space-ms-6 p-ms-4 text-ms-sm">
      <header>
        <h1 className="text-ms-lg font-bold">Tap Target Audit</h1>
        <p className="text-ms-xs text-muted-foreground">
          Semua tombol di halaman ini harus ≥44px tinggi di HP (≥44px lebar untuk icon).
          Baris <code>[data-action-row]</code> harus punya gap ≥8px.
        </p>
      </header>

      <section aria-label="matrix">
        <h2 className="mb-2 text-ms-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Matriks variant × size
        </h2>
        <div className="space-ms-2">
          {VARIANTS.map((v) => (
            <div key={v} data-action-row className="flex flex-wrap items-center gap-ms-2">
              {SIZES.map((s) => (
                <Button
                  key={s}
                  variant={v}
                  size={s}
                  data-tap-target
                  data-tap-target-kind={s === "icon" ? "icon" : "text"}
                  aria-label={s === "icon" ? `${v} icon` : undefined}
                >
                  {s === "icon" ? <Trash2 /> : `${v}/${s}`}
                </Button>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section aria-label="action-row-2col">
        <h2 className="mb-2 text-ms-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Baris aksi 2 kolom (Batal / Simpan)
        </h2>
        {/*
          Catatan: pola aslinya `[&>*]:min-h-11 sm:[&>*]:min-h-9` bekerja
          di root font-size 16px, tapi TURUN di bawah 44px saat
          `--app-font-scale` < 1 (mis. `html.compact` 92% → 40.5px).
          Gunakan `min-h-[44px]` absolut supaya aman apapun skala teks.
        */}
        <div
          data-action-row
          className="grid grid-cols-1 gap-ms-2.5 sm:grid-cols-2 sm:gap-ms-2 [&>*]:min-h-[44px] sm:[&>*]:min-h-9"
        >
          <Button variant="outline" size="sm" data-tap-target data-tap-target-kind="text">
            Batal
          </Button>
          <Button size="sm" data-tap-target data-tap-target-kind="text">
            <Send className="mr-1 h-3 w-3" /> Kirim
          </Button>
        </div>
      </section>

      <section aria-label="icon-chip-row">
        <h2 className="mb-2 text-ms-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Chip ikon kartu (ecer / catatan)
        </h2>
        <div data-action-row className="flex items-center gap-ms-2">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            data-tap-target
            data-tap-target-kind="icon"
            aria-label="Salin"
          >
            <Copy className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            data-tap-target
            data-tap-target-kind="icon"
            aria-label="Edit"
          >
            <Edit3 className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            data-tap-target
            data-tap-target-kind="icon"
            aria-label="Bagikan"
          >
            <Share2 className="h-3 w-3" />
          </Button>
        </div>
      </section>

      <section aria-label="single-column-footer">
        <h2 className="mb-2 text-ms-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Footer dialog 1 kolom
        </h2>
        <div data-action-row className="flex flex-col gap-ms-2">
          <Button data-tap-target data-tap-target-kind="text">Simpan perubahan</Button>
          <Button variant="outline" data-tap-target data-tap-target-kind="text">
            Batal
          </Button>
        </div>
      </section>
    </main>
  );
}