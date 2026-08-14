import { Component, lazy, Suspense, useState, type ComponentProps, type ReactNode } from "react";
import type { PhotoEditorV2 as PhotoEditorV2Type } from "@/components/photo-editor/PhotoEditorV2";
import { isChunkLoadError, recoverFromChunkError } from "@/lib/chunk-recovery";

/**
 * Pembungkus lazy untuk PhotoEditorV2.
 *
 * PhotoEditorV2 menarik konva + react-konva (~670 kB raw gabungan). Kalau
 * di-import statis dari route (/ecer, /request, /t/$token), bundel itu ikut
 * terunduh saat route dibuka meski editor belum dipakai. Editor selalu
 * dirender bersyarat (`editorOpen && editorSrc`), jadi aman dimuat on-demand.
 */
const PhotoEditorV2Lazy = lazy(() =>
  import("@/components/photo-editor/PhotoEditorV2").then((m) => ({
    default: m.PhotoEditorV2,
  })),
);

type Props = ComponentProps<typeof PhotoEditorV2Type>;

function EditorFallback() {
  return (
    <div className="fixed inset-0 z-fullscreen flex items-center justify-center bg-background/95">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <p className="text-sm text-muted-foreground">Menyiapkan editor foto…</p>
      </div>
    </div>
  );
}

/**
 * Editor gagal dimuat (chunk konva basi / jaringan putus) tidak boleh berakhir
 * sebagai spinner abadi atau layar kosong: tampilkan pemulihan eksplisit.
 */
function EditorLoadError({
  onRetry,
  onCancel,
}: {
  onRetry: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-fullscreen flex items-center justify-center bg-background/95 p-6">
      <div className="w-full max-w-xs space-y-4 rounded-2xl border border-border bg-card p-5 text-center shadow-lg">
        <div>
          <p className="text-sm font-semibold text-foreground">
            Editor foto gagal dimuat
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Koneksi terputus atau aplikasi baru diperbarui.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="h-11 rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
          >
            Coba lagi
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="h-11 rounded-xl border border-border text-sm font-medium text-foreground"
          >
            Ambil ulang foto
          </button>
        </div>
      </div>
    </div>
  );
}

class EditorBoundary extends Component<
  { children: ReactNode; fallback: (err: unknown) => ReactNode },
  { err: unknown | null }
> {
  state: { err: unknown | null } = { err: null };

  static getDerivedStateFromError(err: unknown) {
    return { err };
  }

  componentDidCatch(err: unknown) {
    // Chunk basi: hard reload (dibatasi anti-loop). Kalau reload tidak
    // dijalankan, UI pemulihan di bawah tetap tampil.
    if (isChunkLoadError(err)) recoverFromChunkError(err);
    else console.error("[photo-editor] gagal dimuat", err);
  }

  render() {
    if (this.state.err !== null) return this.props.fallback(this.state.err);
    return this.props.children;
  }
}

export function PhotoEditorV2(props: Props) {
  const [attempt, setAttempt] = useState(0);
  return (
    <EditorBoundary
      key={attempt}
      fallback={() => (
        <EditorLoadError
          onRetry={() => setAttempt((n) => n + 1)}
          onCancel={props.onCancel}
        />
      )}
    >
      <Suspense fallback={<EditorFallback />}>
        <PhotoEditorV2Lazy {...props} />
      </Suspense>
    </EditorBoundary>
  );
}
