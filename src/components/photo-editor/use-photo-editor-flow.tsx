import { useCallback, useRef, useState } from "react";
// Satu jalur lazy saja: wrapper ini sudah punya Suspense + error boundary
// pemulihan chunk, jadi jangan membuat `lazy()` kedua di sini.
import { PhotoEditorV2 } from "@/components/photo-editor/LazyPhotoEditorV2";

/**
 * Shared "mandatory edit after choose photo" flow.
 *
 * Pola konsisten (mengikuti /ecer):
 *   user pilih foto → editor terbuka penuh → onSave commit ke draft surface
 *
 * Mendukung queue (beberapa foto sekaligus, dilewati satu-per-satu).
 */

export type EditedPhoto = {
  blob: Blob;
  dataUrl: string;
  file: File;
  index: number;
  total: number;
};

export type PhotoEditorSaveHandler = (r: EditedPhoto) => void | Promise<void>;
export type PhotoEditorDoneHandler = () => void | Promise<void>;

function readAsDataUrl(f: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });
}

export function usePhotoEditorFlow() {
  const [queue, setQueue] = useState<File[]>([]);
  const [idx, setIdx] = useState(0);
  const [src, setSrc] = useState<string | null>(null);
  const saveRef = useRef<PhotoEditorSaveHandler | null>(null);
  const doneRef = useRef<PhotoEditorDoneHandler | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  const showAt = useCallback(async (files: File[], i: number) => {
    const dataUrl = await readAsDataUrl(files[i]);
    setSrc(dataUrl);
  }, []);

  const open = useCallback(
    async (
      files: FileList | File[] | null | undefined,
      onSave: PhotoEditorSaveHandler,
      opts?: { onDone?: PhotoEditorDoneHandler; onCancel?: () => void },
    ) => {
      if (!files) return;
      const arr = Array.from(files as ArrayLike<File>).filter(Boolean);
      if (!arr.length) return;
      saveRef.current = onSave;
      doneRef.current = opts?.onDone ?? null;
      cancelRef.current = opts?.onCancel ?? null;
      setQueue(arr);
      setIdx(0);
      await showAt(arr, 0);
    },
    [showAt],
  );

  const reset = useCallback(() => {
    setSrc(null);
    setQueue([]);
    setIdx(0);
    saveRef.current = null;
    doneRef.current = null;
    cancelRef.current = null;
  }, []);

  const handleSave = useCallback(
    async (blob: Blob, dataUrl: string) => {
      const cur = idx;
      const total = queue.length;
      const file = new File([blob], `foto-${Date.now()}-${cur + 1}.jpg`, {
        type: blob.type || "image/jpeg",
      });
      try {
        await saveRef.current?.({ blob, dataUrl, file, index: cur, total });
      } catch (e) {
        // biarkan pemanggil menampilkan toast; jangan blokir queue
        console.error("[photo-editor-flow] onSave error", e);
      }
      if (cur + 1 < queue.length) {
        const next = cur + 1;
        setIdx(next);
        await showAt(queue, next);
      } else {
        const done = doneRef.current;
        reset();
        await done?.();
      }
    },
    [idx, queue, showAt, reset],
  );

  const handleCancel = useCallback(() => {
    const cancel = cancelRef.current;
    reset();
    cancel?.();
  }, [reset]);

  const element = src ? (
    <PhotoEditorV2 src={src} onSave={handleSave} onCancel={handleCancel} />
  ) : null;

  return {
    element,
    open,
    isOpen: !!src,
    index: idx,
    total: queue.length,
  };
}