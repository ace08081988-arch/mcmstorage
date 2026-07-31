/**
 * Harness publik (no-auth) untuk uji manual/e2e komponen PhotoEditor.
 * Sumber foto adalah data: URL PNG solid biru 800x600 yang di-generate
 * di sisi klien — tidak butuh jaringan, tidak butuh Supabase, tidak
 * mengirim apa pun ke onSave (hanya menyimpan blob terakhir ke state
 * agar tes bisa membacanya via data-testid).
 *
 * URL: /lovable/visual/photo-editor
 * Robots: noindex,nofollow.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PhotoEditor } from "@/components/PhotoEditor";
import { PhotoEditorV2 } from "@/components/photo-editor/PhotoEditorV2";

export const Route = createFileRoute("/lovable/visual/photo-editor")({
  head: () => ({
    meta: [
      { title: "Harness · Photo Editor" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: Harness,
});

function makeTestPngDataUrl(): string {
  const c = document.createElement("canvas");
  c.width = 800;
  c.height = 600;
  const ctx = c.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 800, 600);
  grad.addColorStop(0, "#1e3a8a");
  grad.addColorStop(1, "#0f172a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 800, 600);
  ctx.fillStyle = "#fbbf24";
  ctx.font = "bold 64px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("TEST", 400, 300);
  return c.toDataURL("image/png");
}

function Harness() {
  const [src, setSrc] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ bytes: number; dataUrlLen: number } | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const useV2 = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("v") === "2";

  useEffect(() => {
    // Generate secara sinkron setelah mount agar canvas siap dipakai.
    setSrc(makeTestPngDataUrl());
  }, []);

  // Sembunyikan overlay development (build badge, dsb.) supaya tidak
  // mengintersep klik toolbar saat harness dipakai untuk uji Playwright.
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `
      [data-tsd-source*="BuildVersionBadge"],
      [data-testid="build-version-badge"],
      .fixed.bottom-2.left-2.z-\\[9999\\] { display: none !important; }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  const status = useMemo(() => {
    if (!src) return "loading";
    if (cancelled) return "cancelled";
    if (saved) return "saved";
    return "open";
  }, [src, saved, cancelled]);

  return (
    <div className="min-h-screen">
      <div
        data-testid="harness-status"
        data-status={status}
        data-saved-bytes={saved?.bytes ?? ""}
        className="sr-only"
      >
        {status}
      </div>
      {src && !saved && !cancelled && (
        useV2 ? (
          <PhotoEditorV2
            src={src}
            onCancel={() => setCancelled(true)}
            onSave={(blob, dataUrl) =>
              setSaved({ bytes: blob.size, dataUrlLen: dataUrl.length })
            }
            autosaveKey="harness-v2"
          />
        ) : (
          <PhotoEditor
            src={src}
            onCancel={() => setCancelled(true)}
            onSave={(blob, dataUrl) =>
              setSaved({ bytes: blob.size, dataUrlLen: dataUrl.length })
            }
          />
        )
      )}
      {(saved || cancelled) && (
        <div className="p-ms-6 text-ms-sm">
          {saved ? (
            <div data-testid="harness-saved">
              Tersimpan: {saved.bytes} byte, dataUrl {saved.dataUrlLen} char
            </div>
          ) : (
            <div data-testid="harness-cancelled">Dibatalkan</div>
          )}
          <button
            className="mt-3 inline-flex h-9 items-center rounded-md border bg-background px-ms-3 text-ms-sm"
            onClick={() => {
              setSaved(null);
              setCancelled(false);
              setSrc(makeTestPngDataUrl());
            }}
          >
            Buka lagi
          </button>
        </div>
      )}
    </div>
  );
}