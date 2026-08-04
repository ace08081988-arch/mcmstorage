/**
 * Harness publik: penutupan BERANTAI layer portal bertumpuk.
 * URL: /lovable/visual/focus-portal-stack — noindex, tanpa auth.
 *
 * Skenario yang diuji Playwright (tests/e2e/focus-portal-stack.spec.ts):
 *  - Dialog → Popover (isi LAZY-LOAD 120ms) → Select (isi lazy-load juga).
 *  - Kedua layer RE-RENDER setelah terbuka (label item berubah), jadi node
 *    pemicu bisa ter-unmount saat layer masih hidup.
 *  - Saat ditutup berantai (select → popover), fokus harus mendarat kembali
 *    ke pemicu masing-masing sesuai urutan, bukan melompat ke <body> atau ke
 *    awal dialog.
 *
 * Harness memakai hook produksi `usePortalFocusStack` yang sama dengan dialog
 * pratinjau WA — bukan salinan logika — supaya uji ini non-tautologis.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePortalFocusStack } from "@/lib/use-portal-focus-stack";
import { installFocusDebug, setFocusDebugEnabled } from "@/lib/focus-debug";

export const Route = createFileRoute("/lovable/visual/focus-portal-stack")({
  head: () => ({
    meta: [
      { title: "Harness · Focus portal stack" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: FocusPortalStackHarness,
});

/** Isi yang baru muncul setelah delay — meniru lazy-load daftar kontak. */
function useLazy(open: boolean, delay = 120) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!open) { setReady(false); return; }
    const id = window.setTimeout(() => setReady(true), delay);
    return () => window.clearTimeout(id);
  }, [open, delay]);
  return ready;
}

function FocusPortalStackHarness() {
  const [open, setOpen] = useState(false);
  const [popOpen, setPopOpen] = useState(false);
  const [selOpen, setSelOpen] = useState(false);
  const [value, setValue] = useState<string>("");
  const contentRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
  const layerTriggerRef = useRef<HTMLElement | null>(null);
  const layerTriggerAnchorRef = useRef<{
    selector: string | null;
    parent: HTMLElement | null;
    index: number;
  } | null>(null);

  usePortalFocusStack({ open, contentEl, contentRef, scrollRef, layerTriggerRef, layerTriggerAnchorRef });

  useEffect(() => {
    installFocusDebug();
    setFocusDebugEnabled(true);
  }, []);

  const popReady = useLazy(popOpen);
  const selReady = useLazy(selOpen);

  return (
    <div
      data-testid="harness-root"
      data-open={open ? "1" : "0"}
      className="mx-auto flex max-w-md flex-col gap-ms-3 px-ms-4 py-ms-6"
    >
      <h1 className="text-ms-lg font-semibold">Harness: portal bertumpuk</h1>
      <Button data-testid="base-trigger" variant="outline" onClick={() => setOpen(true)}>
        Buka dialog
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!v) setOpen(false); }}>
        <DialogContent
          data-testid="stack-dialog"
          ref={(node: HTMLDivElement | null) => { contentRef.current = node; setContentEl(node); }}
          onOpenAutoFocus={(e) => { e.preventDefault(); scrollRef.current?.focus(); }}
        >
          <DialogHeader>
            <DialogTitle>Layer bertumpuk</DialogTitle>
            <DialogDescription>Popover dan select yang lazy-load lalu re-render.</DialogDescription>
          </DialogHeader>
          <div ref={scrollRef} tabIndex={-1} className="flex flex-col gap-ms-3 focus:outline-none">
            <Button data-testid="dlg-first" variant="ghost">Tombol pertama</Button>

            <Popover open={popOpen} onOpenChange={setPopOpen}>
              <PopoverTrigger asChild>
                <Button data-testid="pop-trigger" variant="outline">Pilih kontak</Button>
              </PopoverTrigger>
              <PopoverContent data-testid="pop-content" className="flex flex-col gap-ms-2">
                {!popReady ? (
                  <span data-testid="pop-loading" className="text-ms-xs">Memuat…</span>
                ) : (
                  <>
                    {/* Item ini SENGAJA berubah label setelah lazy-load (re-render). */}
                    <Button data-testid="pop-item-1" variant="ghost">Kontak A (siap)</Button>
                    <Select
                      open={selOpen}
                      onOpenChange={setSelOpen}
                      value={value || undefined}
                      onValueChange={setValue}
                    >
                      <SelectTrigger data-testid="sel-trigger" className="w-full">
                        <SelectValue placeholder="Pilih paket" />
                      </SelectTrigger>
                      <SelectContent data-testid="sel-content">
                        {!selReady ? (
                          <SelectItem value="loading" data-testid="sel-loading">Memuat…</SelectItem>
                        ) : (
                          <>
                            <SelectItem value="a" data-testid="sel-item-a">Paket A</SelectItem>
                            <SelectItem value="b" data-testid="sel-item-b">Paket B</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  </>
                )}
              </PopoverContent>
            </Popover>

            <Button data-testid="dlg-last" variant="outline" onClick={() => setOpen(false)}>
              Tutup
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
