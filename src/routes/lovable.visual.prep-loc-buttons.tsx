/**
 * Deterministic visual harness untuk baris tombol Lokasi
 * (input Link Maps + GPS otomatis + Tempel) pada halaman worker
 * `/t/$token`. Menyalin persis kelas + wrapper dari
 * src/routes/t.$token.tsx supaya regresi clipping/overflow di
 * lebar Android sempit (390 & 411) langsung terdeteksi.
 *
 * Dikonsumsi oleh tests/visual/prep-loc-buttons.public.spec.ts.
 *
 * Query params:
 *   variant = "prep" | "request"   (default: "prep")
 *   state   = "idle" | "loading" | "filled"  (default: "idle")
 *
 * Tidak ada network/auth/waktu dinamis — byte-stable antar mesin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, ClipboardPaste, Loader2, MapPin } from "lucide-react";

type Variant = "prep" | "request";
type State = "idle" | "loading" | "filled";

export const Route = createFileRoute("/lovable/visual/prep-loc-buttons")({
  component: VisualHarness,
  validateSearch: (s: Record<string, unknown>): { variant: Variant; state: State } => {
    const v = (s.variant as Variant) ?? "prep";
    const st = (s.state as State) ?? "idle";
    const variants: Variant[] = ["prep", "request"];
    const states: State[] = ["idle", "loading", "filled"];
    return {
      variant: variants.includes(v) ? v : "prep",
      state: states.includes(st) ? st : "idle",
    };
  },
  head: () => ({
    meta: [
      { title: "Visual harness — tombol lokasi worker" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

function LocRow({ variant, state }: { variant: Variant; state: State }) {
  const filled = state === "filled";
  const loading = state === "loading";
  const locUrl = filled ? "https://www.google.com/maps?q=-6.914744,107.609810" : "";

  // Label sengaja identik dengan cabang aslinya di src/routes/t.$token.tsx:
  //   - prep    → "GPS otomatis" / "Mengambil lokasi…" / "Lokasi terisi"
  //   - request → "GPS"           / "Mengambil…"        / "Terisi"
  const gpsLabel =
    variant === "prep"
      ? loading
        ? "Mengambil lokasi…"
        : filled
          ? "Lokasi terisi"
          : "GPS otomatis"
      : loading
        ? "Mengambil…"
        : filled
          ? "Terisi"
          : "GPS";

  return (
    <div className="mt-3 grid grid-cols-1 gap-ms-2">
      <input
        readOnly
        value={locUrl}
        placeholder="Link Google Maps (opsional)"
        className="h-10 w-full rounded-lg border bg-background px-ms-3 text-ms-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        data-visual-loc-input
      />
      <div className="grid grid-cols-2 gap-ms-2">
        <button
          type="button"
          disabled={loading}
          aria-busy={loading}
          data-visual-gps-btn
          className="inline-flex h-10 w-full items-center justify-center gap-ms-1 rounded-lg border bg-background px-ms-3 text-ms-xs font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              <span className="truncate">{gpsLabel}</span>
            </>
          ) : filled ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
              <span className="truncate">{gpsLabel}</span>
            </>
          ) : (
            <>
              <MapPin className="h-4 w-4" aria-hidden /> {gpsLabel}
            </>
          )}
        </button>
        <button
          type="button"
          data-visual-paste-btn
          className="inline-flex h-10 w-full items-center justify-center gap-ms-1 rounded-lg border bg-background px-ms-3 text-ms-xs font-medium transition hover:bg-muted"
        >
          <ClipboardPaste className="h-4 w-4" aria-hidden /> Tempel
        </button>
      </div>
    </div>
  );
}

function VisualHarness() {
  const { variant, state } = Route.useSearch();
  return (
    <div
      className="min-h-screen bg-background text-foreground"
      data-press-scope="on"
    >
      {/* Meniru PageContainer p-ms-4 + Card p-ms-4 di route worker */}
      <div className="mx-auto max-w-md p-ms-4">
        <div className="rounded-2xl border bg-card p-ms-4 elev-sm">
          <section
            data-visual-part="loc-row"
            data-visual-variant={variant}
            data-visual-state={state}
          >
            <LocRow variant={variant} state={state} />
          </section>
        </div>
      </div>
    </div>
  );
}