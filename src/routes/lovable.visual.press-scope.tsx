/**
 * Harness publik (no-auth) untuk memverifikasi bahwa elemen dengan
 * `data-no-press` — termasuk trigger/content Radix Dialog dan sortable
 * handle — tidak terkena animasi press meski berada di dalam root
 * `data-press-scope="on"`.
 *
 * URL: /lovable/visual/press-scope
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

export const Route = createFileRoute("/lovable/visual/press-scope")({
  head: () => ({
    meta: [
      { title: "Harness · press-scope opt-out" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PressScopeHarness,
});

function PressScopeHarness() {
  const [open, setOpen] = useState(false);
  return (
    <main
      data-press-scope="on"
      className="min-h-[100dvh] space-y-6 bg-background p-6 text-foreground"
    >
      <h1 className="text-lg font-semibold">Press scope opt-out harness</h1>

      {/* Baseline — HARUS ikut animasi (kontrol positif). */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Baseline (opt-in scope)</h2>
        <button data-testid="press-yes" className="rounded bg-primary px-3 py-2 text-primary-foreground">
          Ikut animasi
        </button>
      </section>

      {/* Opt-out sederhana. */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Opt-out via data-no-press</h2>
        <button
          data-testid="press-no"
          data-no-press
          className="rounded bg-primary px-3 py-2 text-primary-foreground"
        >
          Tidak ikut
        </button>
      </section>

      {/* Sortable handle imitasi. */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Sortable handle</h2>
        <button
          data-testid="press-sortable-handle"
          data-no-press
          aria-label="Drag handle"
          className="rounded border px-3 py-2"
        >
          ⋮⋮ Handle
        </button>
      </section>

      {/* Radix Dialog: Trigger, Overlay, Content, Close semuanya opt-out. */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Radix Dialog</h2>
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger asChild>
            <button
              data-testid="press-dialog-trigger"
              data-no-press
              className="rounded bg-primary px-3 py-2 text-primary-foreground"
            >
              Buka dialog
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay
              data-testid="press-dialog-overlay"
              data-no-press
              className="fixed inset-0 z-50 bg-black/50"
            />
            <Dialog.Content
              data-testid="press-dialog-content"
              data-no-press
              className="fixed left-1/2 top-1/2 z-50 w-80 -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-4 shadow-lg"
            >
              <Dialog.Title className="text-sm font-semibold">Dialog</Dialog.Title>
              <p className="mt-1 text-xs text-muted-foreground">
                Trigger/overlay/content bebas dari animasi press.
              </p>
              <div className="mt-3 flex justify-end">
                <Dialog.Close asChild>
                  <button
                    data-testid="press-dialog-close"
                    data-no-press
                    className="rounded border px-3 py-1.5 text-sm"
                  >
                    Tutup
                  </button>
                </Dialog.Close>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </section>
    </main>
  );
}