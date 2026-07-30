import { useState } from "react";
import { AlertTriangle, RotateCcw, RefreshCw, ChevronDown } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { DomRaceFallbackInfo } from "@/components/DomRaceBoundary";

/**
 * Fallback pemulihan untuk `DomRaceBoundary`.
 *
 * Tujuannya satu: ketika auto-retry boundary sudah habis, pengguna tetap
 * punya jalan keluar yang MURAH — remount komponen saja (state form/draft
 * tersimpan tetap dipulihkan oleh useFormDraft) — bukan reload halaman penuh
 * yang di Android WebView memakan beberapa detik dan memutus antrean kerja.
 *
 * Urutan tombol sengaja dari yang paling ringan ke paling berat:
 *   1. Pulihkan komponen        → remount subtree, tanpa reload, tanpa refetch
 *   2. Pulihkan + segarkan data → remount + buang cache query halaman ini
 *   3. Muat ulang halaman       → upaya terakhir
 */
export function DomRaceRecoveryPanel(props: {
  error: Error;
  reset: () => void;
  info: DomRaceFallbackInfo;
  title?: string;
}) {
  const qc = useQueryClient();
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div className="mx-auto my-6 max-w-md space-y-3 rounded-xl border bg-card p-5 text-center shadow-sm">
      <AlertTriangle className="mx-auto h-7 w-7 text-amber-500" aria-hidden />
      <div className="space-y-1">
        <h2 className="text-base font-semibold">
          {props.title ?? "Tampilan sempat gagal dimuat"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {props.info.exhausted
            ? "Pemulihan otomatis sudah dicoba beberapa kali dan belum berhasil. Pulihkan komponen ini tanpa memuat ulang seluruh halaman."
            : "Sedang mencoba memulihkan sendiri…"}
        </p>
        <p className="text-[0.6875rem] text-muted-foreground">
          Percobaan otomatis: {props.info.attempt}× · data yang sudah diketik tetap tersimpan
        </p>
      </div>

      <div className="space-y-2">
        <button
          type="button"
          onClick={props.reset}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          <RotateCcw className="h-4 w-4" aria-hidden /> Pulihkan komponen
        </button>
        <button
          type="button"
          onClick={() => {
            // Buang cache query agar data yang mungkin korup ikut diambil ulang,
            // tetap tanpa reload dokumen.
            void qc.resetQueries();
            props.reset();
          }}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          <RefreshCw className="h-4 w-4" aria-hidden /> Pulihkan + segarkan data
        </button>
        <button
          type="button"
          onClick={() => {
            if (typeof window !== "undefined") window.location.reload();
          }}
          className="w-full rounded-md px-4 py-1.5 text-ms-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Muat ulang halaman (upaya terakhir)
        </button>
      </div>

      <div className="text-left">
        <button
          type="button"
          onClick={() => setShowDetail((v) => !v)}
          className="inline-flex items-center gap-1 text-[0.6875rem] text-muted-foreground hover:text-foreground"
          aria-expanded={showDetail}
        >
          <ChevronDown
            className={`h-3 w-3 transition-transform ${showDetail ? "rotate-180" : ""}`}
            aria-hidden
          />
          Detail teknis
        </button>
        {showDetail ? (
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 p-2 text-[0.625rem] leading-relaxed">
            {props.error?.name}: {props.error?.message}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

export default DomRaceRecoveryPanel;
