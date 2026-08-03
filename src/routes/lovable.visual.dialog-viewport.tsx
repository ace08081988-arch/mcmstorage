/**
 * Harness publik untuk uji otomatis posisi dialog (komponen `ui/dialog`)
 * di kondisi WebView Android: layout viewport lebih tinggi daripada area
 * yang benar-benar terlihat (toolbar browser / soft-keyboard / bilah
 * sistem). URL: /lovable/visual/dialog-viewport — noindex, tanpa auth.
 * Dipakai oleh `tests/e2e/dialog-webview-viewport.spec.ts`.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/lovable/visual/dialog-viewport")({
  head: () => ({
    meta: [
      { title: "Harness · Dialog viewport WebView" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: DialogViewportHarness,
});

function DialogViewportHarness() {
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(true);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-ms-3 px-ms-4 py-ms-6">
      <h1 className="text-ms-lg font-semibold">Harness: dialog di WebView</h1>
      <Button data-testid="btn-open-long" onClick={() => { setLong(true); setOpen(true); }}>
        Buka dialog (isi panjang)
      </Button>
      <Button
        variant="outline"
        data-testid="btn-open-short"
        onClick={() => { setLong(false); setOpen(true); }}
      >
        Buka dialog (isi pendek)
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="hv-dialog">
          <DialogHeader>
            <DialogTitle data-testid="hv-title">Judul Request Baru</DialogTitle>
            <DialogDescription>
              Periksa posisi kartu ini saat toolbar atau keyboard muncul.
            </DialogDescription>
          </DialogHeader>
          <div data-testid="hv-body" className="space-y-ms-2 text-ms-sm">
            {Array.from({ length: long ? 24 : 2 }, (_, i) => (
              <p key={i}>
                Baris catatan nomor {i + 1} — teks contoh untuk menguji area
                gulir dan pemotongan kartu dialog di layar kecil.
              </p>
            ))}
          </div>
          <DialogFooter data-testid="hv-footer">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button data-testid="hv-save" onClick={() => setOpen(false)}>
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
