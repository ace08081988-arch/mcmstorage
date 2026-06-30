import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useSavePeerAlias, type PeerKey } from "@/lib/contact-alias";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  peerKey: PeerKey;
  /** Nama awal yang ditampilkan (dari alias / profil / phone / email). */
  initialName: string;
  /** Apakah saat ini nama berasal dari alias address_book. */
  fromAlias?: boolean;
  onSaved?: (name: string) => void;
};

export function EditContactNameDialog({ open, onOpenChange, peerKey, initialName, fromAlias, onSaved }: Props) {
  const [name, setName] = useState(initialName);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const lastSavedRef = useRef<string>(initialName);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = useSavePeerAlias(peerKey);

  // Reset saat dibuka.
  useEffect(() => {
    if (open) {
      setName(initialName);
      lastSavedRef.current = initialName;
      setStatus("idle");
      setErrorMsg(null);
    }
  }, [open, initialName]);

  // Debounced auto-save.
  useEffect(() => {
    if (!open) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    const trimmed = name.trim();
    if (!trimmed) {
      setStatus("idle");
      return;
    }
    if (trimmed === lastSavedRef.current.trim()) {
      setStatus("idle");
      return;
    }
    if (trimmed.length > 100) {
      setStatus("error");
      setErrorMsg("Nama maksimum 100 karakter.");
      return;
    }
    setStatus("saving");
    setErrorMsg(null);
    timerRef.current = setTimeout(async () => {
      try {
        const row = await save.mutateAsync(trimmed);
        lastSavedRef.current = trimmed;
        setStatus("saved");
        onSaved?.(row.name ?? trimmed);
      } catch (e) {
        setStatus("error");
        setErrorMsg(e instanceof Error ? e.message : "Gagal menyimpan.");
      }
    }, 600);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, open]);

  async function saveNow() {
    const trimmed = name.trim();
    if (!trimmed) { toast.error("Nama tidak boleh kosong."); return; }
    if (trimmed === lastSavedRef.current.trim() && status !== "error") {
      onOpenChange(false);
      return;
    }
    try {
      setStatus("saving");
      const row = await save.mutateAsync(trimmed);
      lastSavedRef.current = trimmed;
      setStatus("saved");
      onSaved?.(row.name ?? trimmed);
      toast.success("Nama kontak tersimpan dan tersinkron ke Buku Alamat.");
      onOpenChange(false);
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "Gagal menyimpan.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!save.isPending) onOpenChange(v); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit nama kontak</DialogTitle>
          <DialogDescription>
            Otomatis tersimpan saat Anda mengetik dan tersinkron ke Buku Alamat.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="contact-alias-name" className="text-xs uppercase text-muted-foreground">Nama tampilan</Label>
          <Input
            id="contact-alias-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Contoh: Toko Budi"
            maxLength={100}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void saveNow(); } }}
          />
          <div className="flex h-5 items-center gap-1 text-[11px]">
            {status === "saving" ? (
              <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Menyimpan…</span>
            ) : status === "saved" ? (
              <span className="flex items-center gap-1 text-emerald-600"><Check className="h-3 w-3" /> Tersimpan & tersinkron</span>
            ) : status === "error" ? (
              <span className="flex items-center gap-1 text-destructive"><AlertCircle className="h-3 w-3" /> {errorMsg ?? "Gagal menyimpan"}</span>
            ) : (
              <span className="text-muted-foreground">
                {fromAlias ? "Nama saat ini diambil dari Buku Alamat." : "Nama saat ini diambil dari profil / nomor."}
              </span>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={save.isPending}>Tutup</Button>
          <Button onClick={saveNow} disabled={save.isPending || !name.trim()}>
            {save.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}