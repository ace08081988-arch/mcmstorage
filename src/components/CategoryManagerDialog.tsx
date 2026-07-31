import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X } from "lucide-react";

export type CategoryUsage = { name: string; count: number };

export type CategoryManagerDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  categories: string[];
  /** Jumlah produk per kategori (termasuk kategori yatim). */
  usage: CategoryUsage[];
  /** Kategori yang dipakai produk tapi tidak ada di daftar kategori. */
  orphans: CategoryUsage[];
  onAdd: (name: string) => void;
  onRename: (from: string, to: string) => void;
  onDelete: (name: string) => void;
  onReorder: (name: string, dir: -1 | 1) => void;
  /** Daftarkan ulang kategori yatim supaya produknya tidak "hilang". */
  onAdoptOrphans: (names: string[]) => void;
  onSelect?: (name: string) => void;
  saveState?: "idle" | "saving" | "saved" | "error";
  lastSavedAt?: number | null;
};

function saveLabel(state: CategoryManagerDialogProps["saveState"], at?: number | null) {
  if (state === "saving") return "Menyimpan…";
  if (state === "error") return "Gagal menyimpan";
  if (state === "saved" && at)
    return `Tersimpan ${new Date(at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`;
  return "Tersinkron";
}

export function CategoryManagerDialog({
  open,
  onOpenChange,
  categories,
  usage,
  orphans,
  onAdd,
  onRename,
  onDelete,
  onReorder,
  onAdoptOrphans,
  onSelect,
  saveState = "idle",
  lastSavedAt = null,
}: CategoryManagerDialogProps) {
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const countOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of usage) m.set(u.name, u.count);
    return m;
  }, [usage]);

  const commitRename = (from: string) => {
    const to = draft.trim();
    if (!to) {
      toast.error("Nama kategori tidak boleh kosong");
      return;
    }
    if (to !== from && categories.includes(to)) {
      toast.error("Nama kategori sudah dipakai");
      return;
    }
    if (to !== from) onRename(from, to);
    setEditing(null);
    setDraft("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Kelola kategori</DialogTitle>
          <DialogDescription>
            Ubah nama, urutkan, atau hapus kategori penyimpanan. Perubahan otomatis
            tersimpan ke akunmu.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-[11px]">
          <span className="text-muted-foreground">
            {categories.length} kategori · {usage.reduce((s, u) => s + u.count, 0)} produk
          </span>
          <span
            className={
              saveState === "error"
                ? "font-medium text-destructive"
                : "font-medium text-muted-foreground"
            }
          >
            {saveLabel(saveState, lastSavedAt)}
          </span>
        </div>

        {orphans.length > 0 && (
          <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="text-xs font-semibold">
              {orphans.length} kategori produk belum terdaftar
            </p>
            <p className="text-[11px] text-muted-foreground">
              Produk berikut memakai kategori yang hilang dari daftar:{" "}
              {orphans.map((o) => `${o.name} (${o.count})`).join(", ")}. Daftarkan
              ulang supaya tidak terlewat.
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="h-7 text-[11px]"
              onClick={() => onAdoptOrphans(orphans.map((o) => o.name))}
            >
              Daftarkan ulang semua
            </Button>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = newName.trim();
            if (!v) return;
            onAdd(v);
            setNewName("");
          }}
          className="flex gap-2"
        >
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nama kategori baru"
            className="h-9 text-sm"
          />
          <Button type="submit" size="sm" className="h-9 shrink-0">
            <Plus className="mr-1 h-3.5 w-3.5" /> Tambah
          </Button>
        </form>

        <ul className="space-y-1.5">
          {categories.length === 0 && (
            <li className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
              Belum ada kategori.
            </li>
          )}
          {categories.map((c, idx) => {
            const isEditing = editing === c;
            return (
              <li
                key={c}
                className="flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-2"
              >
                {isEditing ? (
                  <>
                    <Input
                      value={draft}
                      autoFocus
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(c);
                        if (e.key === "Escape") setEditing(null);
                      }}
                      className="h-8 flex-1 text-sm"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      aria-label="Simpan nama kategori"
                      onClick={() => commitRename(c)}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      aria-label="Batal ubah nama"
                      onClick={() => setEditing(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => onSelect?.(c)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-sm font-medium">{c}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {countOf.get(c) ?? 0} produk
                      </span>
                    </button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      aria-label={`Naikkan urutan ${c}`}
                      disabled={idx === 0}
                      onClick={() => onReorder(c, -1)}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      aria-label={`Turunkan urutan ${c}`}
                      disabled={idx === categories.length - 1}
                      onClick={() => onReorder(c, 1)}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      aria-label={`Ubah nama kategori ${c}`}
                      onClick={() => {
                        setEditing(c);
                        setDraft(c);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive hover:bg-destructive/10"
                      aria-label={`Hapus kategori ${c}`}
                      onClick={() => onDelete(c)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export default CategoryManagerDialog;
