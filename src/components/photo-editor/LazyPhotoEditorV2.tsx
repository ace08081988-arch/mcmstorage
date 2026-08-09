import { lazy, Suspense, type ComponentProps } from "react";
import type { PhotoEditorV2 as PhotoEditorV2Type } from "@/components/photo-editor/PhotoEditorV2";

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

export function PhotoEditorV2(props: Props) {
  return (
    <Suspense fallback={<EditorFallback />}>
      <PhotoEditorV2Lazy {...props} />
    </Suspense>
  );
}
