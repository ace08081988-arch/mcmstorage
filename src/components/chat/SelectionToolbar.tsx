import { X, Reply, Info, Trash2, Copy, Share2, MoreVertical, Star, Pin, ShieldCheck, NotebookPen, MessageSquarePlus, Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Props = {
  count: number;
  oneSelected: boolean;
  allMine: boolean;
  onClose: () => void;
  onReply: () => void;
  onInfo: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onForward: () => void;
  onSecurityCode: () => void;
  onStar: () => void;
  onPin: () => void;
  onSaveNote: () => void;
  onSaveQuickReply: () => void;
  onTranslate: () => void;
};

export function SelectionToolbar(p: Props) {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-1 border-b bg-primary text-primary-foreground px-2 py-2 shadow-sm">
      <Button variant="ghost" size="icon" onClick={p.onClose} aria-label="Keluar mode pilih" className="text-primary-foreground hover:bg-primary-foreground/15">
        <X className="h-5 w-5" />
      </Button>
      <span className="min-w-6 text-sm font-semibold tabular-nums">{p.count}</span>
      <div className="ml-auto flex items-center gap-0.5">
        <Button variant="ghost" size="icon" disabled={!p.oneSelected} onClick={p.onReply} aria-label="Balas" className="text-primary-foreground hover:bg-primary-foreground/15 disabled:opacity-40">
          <Reply className="h-5 w-5" />
        </Button>
        <Button variant="ghost" size="icon" disabled={!p.oneSelected} onClick={p.onInfo} aria-label="Info" className="text-primary-foreground hover:bg-primary-foreground/15 disabled:opacity-40">
          <Info className="h-5 w-5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={p.onDelete} aria-label="Hapus" className="text-primary-foreground hover:bg-primary-foreground/15">
          <Trash2 className="h-5 w-5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={p.onCopy} aria-label="Salin" className="text-primary-foreground hover:bg-primary-foreground/15">
          <Copy className="h-5 w-5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={p.onForward} aria-label="Teruskan" className="text-primary-foreground hover:bg-primary-foreground/15">
          <Share2 className="h-5 w-5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Opsi lain" className="text-primary-foreground hover:bg-primary-foreground/15">
              <MoreVertical className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onSelect={p.onSecurityCode}>
              <ShieldCheck className="mr-2 h-4 w-4" /> Verifikasi kode keamanan
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={p.onStar}>
              <Star className="mr-2 h-4 w-4" /> Beri bintang
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={p.onPin} disabled={!p.oneSelected}>
              <Pin className="mr-2 h-4 w-4" /> Sematkan
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={p.onSaveNote} disabled={!p.oneSelected}>
              <NotebookPen className="mr-2 h-4 w-4" /> Tambah ke Catatan
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={p.onSaveQuickReply} disabled={!p.oneSelected}>
              <MessageSquarePlus className="mr-2 h-4 w-4" /> Tambah balas cepat
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={p.onTranslate} disabled={!p.oneSelected}>
              <Languages className="mr-2 h-4 w-4" /> Terjemahkan
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}