import { createFileRoute } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/dev-dialog-probe")({ component: Probe });

function Probe() {
  return (
    <div className="p-4">
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Judul dialog yang cukup panjang untuk menguji perataan header</DialogTitle>
            <DialogDescription>Deskripsi singkat untuk memeriksa jarak dan perataan.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {Array.from({ length: 40 }).map((_, i) => (
              <p key={i} className="text-sm">Baris konten {i + 1}</p>
            ))}
          </div>
          <DialogFooter><Button>Simpan</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
