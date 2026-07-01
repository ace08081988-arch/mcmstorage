/**
 * Kumpulan dialog pendukung menu titik-tiga percakapan:
 *  - ConversationSearchDialog: pencarian teks pesan di percakapan aktif.
 *  - MediaLinksDialog: tab Media / Tautan / Dokumen dari pesan yang sudah dimuat.
 *  - MuteDialog: pilih durasi senyap.
 *
 * Semua dialog beroperasi pada daftar pesan yang sudah dimuat di memori
 * supaya tidak menambah round-trip ke server.
 */
import { useMemo, useState } from "react";
import { Search, ImageIcon, Link as LinkIcon, FileText, BellOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MUTE_PRESETS } from "@/lib/conversation-prefs";
import type { MessageRow } from "@/lib/chat";

function extractUrls(text: string): string[] {
  if (!text) return [];
  const re = /https?:\/\/[^\s<>"']+/gi;
  return Array.from(new Set(text.match(re) ?? []));
}
function isImage(url: string) {
  return /\.(png|jpe?g|webp|gif|bmp|avif)(\?|#|$)/i.test(url);
}
function isDoc(url: string) {
  return /\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip|rar|7z)(\?|#|$)/i.test(url);
}

export function ConversationSearchDialog({
  open,
  onOpenChange,
  messages,
  onJump,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  messages: MessageRow[];
  onJump: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [] as MessageRow[];
    return messages
      .filter((m) => !m.deleted_at && (m.body ?? "").toLowerCase().includes(needle))
      .slice(0, 60);
  }, [q, messages]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-4 w-4" /> Cari di percakapan
          </DialogTitle>
          <DialogDescription>Cari kata di pesan yang sudah dimuat.</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ketik kata kunci…"
        />
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {q.trim() && hits.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">
              Tidak ada pesan yang cocok.
            </p>
          ) : (
            hits.map((m) => (
              <button
                key={m.id}
                type="button"
                className="w-full rounded-md border p-2 text-left text-xs hover:bg-accent"
                onClick={() => {
                  onJump(m.id);
                  onOpenChange(false);
                }}
              >
                <div className="line-clamp-2 whitespace-pre-wrap">{m.body}</div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {new Date(m.created_at).toLocaleString("id-ID")}
                </div>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MediaLinksDialog({
  open,
  onOpenChange,
  messages,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  messages: MessageRow[];
}) {
  const { images, links, docs } = useMemo(() => {
    const imgs: Array<{ url: string; at: string }> = [];
    const lnks: Array<{ url: string; at: string; body: string }> = [];
    const dcs: Array<{ url: string; at: string }> = [];
    for (const m of messages) {
      if (m.deleted_at) continue;
      const urls = extractUrls(m.body ?? "");
      for (const u of urls) {
        if (isImage(u)) imgs.push({ url: u, at: m.created_at });
        else if (isDoc(u)) dcs.push({ url: u, at: m.created_at });
        else lnks.push({ url: u, at: m.created_at, body: m.body ?? "" });
      }
    }
    return { images: imgs.reverse(), links: lnks.reverse(), docs: dcs.reverse() };
  }, [messages]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Media, tautan, dan dokumen</DialogTitle>
          <DialogDescription>
            Berkas dan link yang dibagikan di percakapan ini.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="media">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="media">
              <ImageIcon className="mr-1 h-3.5 w-3.5" /> Media ({images.length})
            </TabsTrigger>
            <TabsTrigger value="links">
              <LinkIcon className="mr-1 h-3.5 w-3.5" /> Tautan ({links.length})
            </TabsTrigger>
            <TabsTrigger value="docs">
              <FileText className="mr-1 h-3.5 w-3.5" /> Dok ({docs.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="media" className="max-h-72 overflow-y-auto">
            {images.length === 0 ? (
              <p className="p-6 text-center text-xs text-muted-foreground">Belum ada media.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 p-1">
                {images.map((it, i) => (
                  <a
                    key={`${it.url}-${i}`}
                    href={it.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="aspect-square overflow-hidden rounded-md border bg-muted"
                  >
                    <img src={it.url} alt="" className="h-full w-full object-cover" />
                  </a>
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent value="links" className="max-h-72 space-y-1 overflow-y-auto p-1">
            {links.length === 0 ? (
              <p className="p-6 text-center text-xs text-muted-foreground">Belum ada tautan.</p>
            ) : (
              links.map((l, i) => (
                <a
                  key={`${l.url}-${i}`}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-md border p-2 text-xs hover:bg-accent"
                >
                  <div className="truncate font-medium text-primary">{l.url}</div>
                  <div className="mt-0.5 line-clamp-2 text-muted-foreground">{l.body}</div>
                </a>
              ))
            )}
          </TabsContent>
          <TabsContent value="docs" className="max-h-72 space-y-1 overflow-y-auto p-1">
            {docs.length === 0 ? (
              <p className="p-6 text-center text-xs text-muted-foreground">Belum ada dokumen.</p>
            ) : (
              docs.map((d, i) => (
                <a
                  key={`${d.url}-${i}`}
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-md border p-2 text-xs hover:bg-accent"
                >
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{d.url.split("/").pop() || d.url}</span>
                </a>
              ))
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

export function MuteDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (untilMs: number | null) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BellOff className="h-4 w-4" /> Senyapkan notifikasi
          </DialogTitle>
          <DialogDescription>Pilih durasi. Kamu tetap menerima pesan, tapi tanpa bunyi/notif.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {MUTE_PRESETS.map((p) => (
            <Button
              key={p.label}
              variant="outline"
              onClick={() => {
                onPick(p.ms === "forever" ? Number.MAX_SAFE_INTEGER : Date.now() + p.ms);
                onOpenChange(false);
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
