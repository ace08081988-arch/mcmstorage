import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles, RotateCw, Eraser, Plus, Star, Trash2, ArrowLeft, Bookmark } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  encodeCard, type StickerCard, type StickerArrowDir, decodeCard,
} from "@/lib/chat-cards";
import { uploadChatFile } from "@/lib/chat-attachments";
import { StickerView } from "@/components/chat/StickerView";
import { sendMessage } from "@/lib/chat.functions";
import { generateAiSticker } from "@/lib/sticker-ai.functions";
import {
  useStickerLibrary, saveSticker, removeSaved, toggleFav, pushRecent, type SavedSticker,
} from "@/lib/sticker-library";

const ARROW_DIRS: StickerArrowDir[] = [
  "up-left", "up", "up-right",
  "left", "right",
  "down-left", "down", "down-right",
];

const COLOR_PRESETS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#a855f7", "#0f172a", "#fafafa"];
const BG_PRESETS = ["transparent", "#fef3c7", "#dcfce7", "#dbeafe", "#fce7f3", "#0f172a"];

type Mode =
  | { kind: "create" }
  | { kind: "edit"; messageId: string; onCommit: (newBody: string) => Promise<void> | void };

export function StickerPickerDialog({
  conversationId, open, onOpenChange, onSent, initial, mode = { kind: "create" },
}: {
  conversationId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSent?: () => void;
  initial?: StickerCard | null;
  mode?: Mode;
}) {
  const [card, setCard] = useState<StickerCard>(initial ?? defaultArrow());
  const [tab, setTab] = useState<string>(initial?.kind ?? "arrow");
  const [busy, setBusy] = useState(false);
  // "library" = panel grid (tap kirim), "editor" = bentuk lama untuk bikin/edit.
  const [view, setView] = useState<"library" | "editor">(
    mode.kind === "edit" || initial ? "editor" : "library",
  );
  const [saveOnSend, setSaveOnSend] = useState(true);
  const lib = useStickerLibrary();

  useEffect(() => {
    if (!open) return;
    setCard(initial ?? defaultArrow());
    setTab(initial?.kind ?? "arrow");
    setView(mode.kind === "edit" || initial ? "editor" : "library");
    setSaveOnSend(true);
  }, [open, initial]);

  function switchTab(nextKind: string) {
    setTab(nextKind);
    if (nextKind === card.kind) return;
    if (nextKind === "arrow") setCard(defaultArrow());
    else if (nextKind === "bank") setCard(defaultBank());
    else if (nextKind === "text") setCard(defaultText());
    else if (nextKind === "ai") {
      // keep image_path empty until generated
      setCard({ type: "sticker", kind: "ai", image_path: "", prompt: "", caption: "", rotation: 0, scale: 1 });
    }
  }

  async function commit() {
    if (busy) return;
    if (card.kind === "bank") {
      if (!card.bank.trim() || !card.account_number.trim() || !card.account_name.trim()) {
        toast.error("Lengkapi bank, no rekening, dan atas nama"); return;
      }
    }
    if (card.kind === "text" && !card.text.trim()) { toast.error("Teks stiker kosong"); return; }
    if (card.kind === "ai" && !card.image_path) { toast.error("Buat stiker AI dulu"); return; }
    setBusy(true);
    try {
      const body = encodeCard(card);
      if (mode.kind === "edit") {
        await mode.onCommit(body);
      } else {
        await sendMessage({ data: { conversationId, body } });
        pushRecent(card);
        if (saveOnSend) saveSticker(card);
      }
      onSent?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan stiker");
    } finally {
      setBusy(false);
    }
  }

  /** Kirim langsung dari grid (one-tap). */
  async function sendFromLibrary(s: SavedSticker) {
    if (busy) return;
    setBusy(true);
    try {
      await sendMessage({ data: { conversationId, body: encodeCard(s.card) } });
      pushRecent(s.card);
      onSent?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengirim stiker");
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {view === "editor" && mode.kind !== "edit" ? (
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => setView("library")}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            ) : null}
            {mode.kind === "edit" ? "Edit stiker" : view === "library" ? "Stiker" : "Buat stiker"}
          </DialogTitle>
        </DialogHeader>

        {view === "library" ? (
          <StickerLibraryPanel
            saved={lib.saved}
            recents={lib.recents}
            fav={lib.fav}
            busy={busy}
            onSend={sendFromLibrary}
            onToggleFav={(id) => toggleFav(id)}
            onRemove={(id) => removeSaved(id)}
            onNew={() => { setCard(defaultArrow()); setTab("arrow"); setView("editor"); }}
          />
        ) : (
        <>
        <Tabs value={tab} onValueChange={switchTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="arrow">Panah</TabsTrigger>
            <TabsTrigger value="bank">Rekening</TabsTrigger>
            <TabsTrigger value="text">Teks</TabsTrigger>
            <TabsTrigger value="ai"><Sparkles className="mr-1 h-3 w-3" />AI</TabsTrigger>
          </TabsList>

          <TabsContent value="arrow" className="space-y-2">
            <ArrowPanel card={asArrow(card)} onChange={setCard} />
          </TabsContent>
          <TabsContent value="bank" className="space-y-2">
            <BankPanel card={asBank(card)} onChange={setCard} />
          </TabsContent>
          <TabsContent value="text" className="space-y-2">
            <TextPanel card={asText(card)} onChange={setCard} />
          </TabsContent>
          <TabsContent value="ai" className="space-y-2">
            <AiPanel card={asAi(card)} conversationId={conversationId} onChange={setCard} />
          </TabsContent>
        </Tabs>

        <CommonControls card={card} onChange={setCard} />

        <div className="rounded-lg border bg-muted/30 p-2">
          <div className="mb-1 text-[10px] uppercase text-muted-foreground">Pratinjau</div>
          <div className="flex justify-center">
            <StickerView card={card} mine />
          </div>
        </div>

        {mode.kind !== "edit" ? (
          <label className="flex items-center justify-between rounded-md border px-2 py-1.5 text-xs">
            <span className="flex items-center gap-1.5"><Bookmark className="h-3.5 w-3.5" /> Simpan ke koleksi setelah kirim</span>
            <Switch checked={saveOnSend} onCheckedChange={setSaveOnSend} />
          </label>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Batal</Button>
          <Button onClick={commit} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {mode.kind === "edit" ? "Simpan perubahan" : "Kirim"}
          </Button>
        </DialogFooter>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Grid stiker tersimpan ala WA: Buat + Favorit + Tersimpan + Terbaru. */
function StickerLibraryPanel({
  saved, recents, fav, busy, onSend, onToggleFav, onRemove, onNew,
}: {
  saved: SavedSticker[]; recents: SavedSticker[]; fav: Set<string>; busy: boolean;
  onSend: (s: SavedSticker) => void;
  onToggleFav: (id: string) => void;
  onRemove: (id: string) => void;
  onNew: () => void;
}) {
  const favs = useMemo(() => saved.filter((s) => fav.has(s.id)), [saved, fav]);
  const rest = useMemo(() => saved.filter((s) => !fav.has(s.id)), [saved, fav]);
  const empty = saved.length === 0 && recents.length === 0;
  return (
    <div className="space-y-3">
      <Section title="Buat baru">
        <div className="grid grid-cols-4 gap-2">
          <button type="button" onClick={onNew}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed text-xs hover:bg-accent">
            <Plus className="h-5 w-5 text-primary" />
            <span>Buat</span>
          </button>
        </div>
      </Section>
      {favs.length ? (
        <Section title="Favorit">
          <Grid items={favs} fav={fav} busy={busy} onSend={onSend} onToggleFav={onToggleFav} onRemove={onRemove} />
        </Section>
      ) : null}
      {rest.length ? (
        <Section title="Tersimpan">
          <Grid items={rest} fav={fav} busy={busy} onSend={onSend} onToggleFav={onToggleFav} onRemove={onRemove} />
        </Section>
      ) : null}
      {recents.length ? (
        <Section title="Terbaru">
          <Grid items={recents} fav={fav} busy={busy} onSend={onSend} onToggleFav={onToggleFav} onRemove={onRemove} compact />
        </Section>
      ) : null}
      {empty ? (
        <p className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
          Belum ada stiker. Tekan <span className="font-medium">Buat</span> untuk membuat stiker pertama. Setelah dikirim, stiker otomatis tersimpan di sini.
        </p>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function Grid({
  items, fav, busy, onSend, onToggleFav, onRemove, compact,
}: {
  items: SavedSticker[]; fav: Set<string>; busy: boolean;
  onSend: (s: SavedSticker) => void; onToggleFav: (id: string) => void; onRemove: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {items.map((s) => {
        const isFav = fav.has(s.id);
        return (
          <div key={s.id} className="group relative">
            <button type="button" disabled={busy}
              onClick={() => onSend(s)}
              className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border bg-muted/30 p-1 transition active:scale-95 disabled:opacity-50">
              <div className="pointer-events-none scale-[0.55] origin-center">
                <StickerView card={s.card} mine />
              </div>
            </button>
            {!compact ? (
              <>
                <button type="button" aria-label="Favorit"
                  onClick={(e) => { e.stopPropagation(); onToggleFav(s.id); }}
                  className="absolute left-0.5 top-0.5 rounded-full bg-background/80 p-0.5 backdrop-blur">
                  <Star className={`h-3 w-3 ${isFav ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                </button>
                <button type="button" aria-label="Hapus"
                  onClick={(e) => { e.stopPropagation(); onRemove(s.id); }}
                  className="absolute right-0.5 top-0.5 rounded-full bg-background/80 p-0.5 opacity-0 backdrop-blur group-hover:opacity-100">
                  <Trash2 className="h-3 w-3 text-rose-500" />
                </button>
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// --- Default factories ---
function defaultArrow(): StickerCard { return { type: "sticker", kind: "arrow", direction: "right", color: "#ef4444", bg: "transparent", rotation: 0, scale: 1, caption: "" }; }
function defaultBank(): StickerCard { return { type: "sticker", kind: "bank", bank: "BCA", account_number: "", account_name: "", color: "#fafafa", bg: "#0f172a", rotation: 0, scale: 1, caption: "" }; }
function defaultText(): StickerCard { return { type: "sticker", kind: "text", text: "PROMO!", color: "#fefce8", bg: "#dc2626", rotation: 0, scale: 1, caption: "" }; }

// --- Narrowing helpers (always return a sticker of the right kind) ---
function asArrow(c: StickerCard): Extract<StickerCard, { kind: "arrow" }> {
  return c.kind === "arrow" ? c : defaultArrow() as Extract<StickerCard, { kind: "arrow" }>;
}
function asBank(c: StickerCard): Extract<StickerCard, { kind: "bank" }> {
  return c.kind === "bank" ? c : defaultBank() as Extract<StickerCard, { kind: "bank" }>;
}
function asText(c: StickerCard): Extract<StickerCard, { kind: "text" }> {
  return c.kind === "text" ? c : defaultText() as Extract<StickerCard, { kind: "text" }>;
}
function asAi(c: StickerCard): Extract<StickerCard, { kind: "ai" }> {
  return c.kind === "ai" ? c : ({ type: "sticker", kind: "ai", image_path: "", prompt: "", caption: "", rotation: 0, scale: 1 } as Extract<StickerCard, { kind: "ai" }>);
}

// --- Common controls (caption, rotation, scale) ---
function CommonControls({ card, onChange }: { card: StickerCard; onChange: (c: StickerCard) => void }) {
  return (
    <div className="space-y-2 rounded-lg border p-2">
      <div className="space-y-1">
        <Label className="text-[11px] uppercase text-muted-foreground">Caption (opsional)</Label>
        <Input
          value={card.caption ?? ""}
          maxLength={80}
          placeholder="Mis. Ke arah gudang"
          onChange={(e) => onChange({ ...card, caption: e.target.value } as StickerCard)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[11px] uppercase text-muted-foreground">Rotasi {card.rotation ?? 0}°</Label>
          <Slider min={-180} max={180} step={5}
            value={[card.rotation ?? 0]}
            onValueChange={(v) => onChange({ ...card, rotation: v[0] } as StickerCard)}
          />
        </div>
        <div>
          <Label className="text-[11px] uppercase text-muted-foreground">Skala {(card.scale ?? 1).toFixed(2)}×</Label>
          <Slider min={0.6} max={1.8} step={0.05}
            value={[card.scale ?? 1]}
            onValueChange={(v) => onChange({ ...card, scale: v[0] } as StickerCard)}
          />
        </div>
      </div>
      <div className="flex gap-1">
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs"
          onClick={() => onChange({ ...card, rotation: 0, scale: 1 } as StickerCard)}>
          <RotateCw className="mr-1 h-3 w-3" /> Reset transformasi
        </Button>
      </div>
    </div>
  );
}

// --- Arrow panel ---
function ArrowPanel({
  card, onChange,
}: { card: Extract<StickerCard, { kind: "arrow" }>; onChange: (c: StickerCard) => void }) {
  return (
    <div className="space-y-2">
      <Label className="text-[11px] uppercase text-muted-foreground">Arah</Label>
      <div className="grid grid-cols-3 gap-1">
        {ARROW_DIRS.map((d, i) => {
          // empty middle cell
          if (i === 4) return <div key="mid" />;
          const idx = i >= 4 ? i - 1 : i;
          const dir = ARROW_DIRS[idx];
          const active = card.direction === dir;
          return (
            <button key={dir} type="button"
              onClick={() => onChange({ ...card, direction: dir })}
              className={`flex h-12 items-center justify-center rounded border text-xs ${active ? "border-primary bg-primary/10" : "border-border hover:bg-accent"}`}
              aria-label={`Arah ${dir}`}
            >
              <ArrowGlyph dir={dir} />
            </button>
          );
        })}
      </div>
      <ColorRow label="Warna panah" value={card.color ?? "#ef4444"} onChange={(c) => onChange({ ...card, color: c })} presets={COLOR_PRESETS} />
      <ColorRow label="Latar" value={card.bg ?? "transparent"} onChange={(c) => onChange({ ...card, bg: c })} presets={BG_PRESETS} allowTransparent />
    </div>
  );
}

function ArrowGlyph({ dir }: { dir: StickerArrowDir }) {
  const ARROW_ROT: Record<StickerArrowDir, number> = {
    right: 0, "down-right": 45, down: 90, "down-left": 135,
    left: 180, "up-left": 225, up: 270, "up-right": 315,
  };
  return (
    <span className="inline-block" style={{ transform: `rotate(${ARROW_ROT[dir]}deg)` }}>→</span>
  );
}

// --- Bank panel (with optional saved-accounts list) ---
function BankPanel({
  card, onChange,
}: { card: Extract<StickerCard, { kind: "bank" }>; onChange: (c: StickerCard) => void }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Bank</Label>
          <Input value={card.bank} placeholder="BCA / Mandiri" onChange={(e) => onChange({ ...card, bank: e.target.value })} />
        </div>
        <div>
          <Label>Nomor rekening</Label>
          <Input inputMode="numeric" value={card.account_number} placeholder="1234567890"
            onChange={(e) => onChange({ ...card, account_number: e.target.value.replace(/[^0-9]/g, "") })} />
        </div>
      </div>
      <div>
        <Label>Atas nama</Label>
        <Input value={card.account_name} onChange={(e) => onChange({ ...card, account_name: e.target.value })} />
      </div>
      <ColorRow label="Warna teks" value={card.color ?? "#fafafa"} onChange={(c) => onChange({ ...card, color: c })} presets={COLOR_PRESETS} />
      <ColorRow label="Latar kartu" value={card.bg ?? "#0f172a"} onChange={(c) => onChange({ ...card, bg: c })} presets={BG_PRESETS} />
    </div>
  );
}

// --- Text panel ---
function TextPanel({
  card, onChange,
}: { card: Extract<StickerCard, { kind: "text" }>; onChange: (c: StickerCard) => void }) {
  return (
    <div className="space-y-2">
      <div>
        <Label>Teks stiker</Label>
        <Input maxLength={40} value={card.text} onChange={(e) => onChange({ ...card, text: e.target.value })} />
      </div>
      <ColorRow label="Warna teks" value={card.color ?? "#fefce8"} onChange={(c) => onChange({ ...card, color: c })} presets={COLOR_PRESETS} />
      <ColorRow label="Latar" value={card.bg ?? "#dc2626"} onChange={(c) => onChange({ ...card, bg: c })} presets={COLOR_PRESETS} />
    </div>
  );
}

// --- AI panel ---
function AiPanel({
  card, conversationId, onChange,
}: { card: Extract<StickerCard, { kind: "ai" }>; conversationId: string; onChange: (c: StickerCard) => void }) {
  const [prompt, setPrompt] = useState(card.prompt ?? "");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  // If editing an existing AI sticker with a stored path, leave preview to StickerView.
  const hasStored = useMemo(() => !!card.image_path, [card.image_path]);

  async function generate() {
    if (!prompt.trim()) { toast.error("Tulis deskripsi stiker dulu"); return; }
    setGenerating(true);
    try {
      const { b64_json } = await generateAiSticker({ data: { prompt: prompt.trim() } });
      // turn base64 -> Blob -> upload
      const bin = atob(b64_json);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "image/png" });
      const up = await uploadChatFile({
        conversationId,
        file: blob,
        filename: `sticker_${Date.now()}.png`,
        mime: "image/png",
      });
      const dataUrl = `data:image/png;base64,${b64_json}`;
      setPreviewUrl(dataUrl);
      onChange({ ...card, image_path: up.path, prompt: prompt.trim() });
      toast.success("Stiker AI siap. Atur caption / rotasi lalu Kirim.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membuat stiker AI");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label>Deskripsi stiker</Label>
      <Textarea
        rows={2}
        value={prompt}
        placeholder="Mis. kucing oranye lucu memegang kardus"
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className="flex gap-2">
        <Button type="button" onClick={generate} disabled={generating} className="flex-1">
          {generating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
          {hasStored ? "Buat ulang" : "Buat stiker"}
        </Button>
        {hasStored ? (
          <Button type="button" variant="outline" onClick={() => { onChange({ ...card, image_path: "" }); setPreviewUrl(null); }}>
            <Eraser className="mr-1 h-3 w-3" />Hapus
          </Button>
        ) : null}
      </div>
      {previewUrl && !hasStored ? (
        <img src={previewUrl} alt="pratinjau" className="mx-auto h-32 w-32 rounded-lg" />
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        Stiker dibuat oleh Lovable AI. Caption, rotasi, dan skala bisa diedit lagi setelahnya.
      </p>
    </div>
  );
}

// --- Color picker row ---
function ColorRow({ label, value, onChange, presets, allowTransparent }: {
  label: string; value: string; onChange: (c: string) => void; presets: string[]; allowTransparent?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] uppercase text-muted-foreground">{label}</Label>
      <div className="flex flex-wrap items-center gap-1">
        {presets.map((p) => (
          <button key={p} type="button"
            onClick={() => onChange(p)}
            className={`h-6 w-6 rounded-full border ${value === p ? "ring-2 ring-primary ring-offset-1" : ""}`}
            style={{ background: p === "transparent" ? "repeating-conic-gradient(#cbd5e1 0 25%, #fff 0 50%) 50%/8px 8px" : p }}
            aria-label={p}
          />
        ))}
        {allowTransparent ? (
          <button type="button" onClick={() => onChange("transparent")}
            className="rounded border px-1.5 text-[10px]">Tanpa latar</button>
        ) : null}
        <input
          type="color"
          value={value === "transparent" ? "#ffffff" : value}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 w-8 cursor-pointer rounded border bg-transparent"
        />
      </div>
    </div>
  );
}

/**
 * Helper: parse pesan jadi StickerCard kalau memang stiker.
 * Dipakai menu konteks pesan untuk membuka editor dengan nilai prefilled.
 */
export function parseStickerFromBody(body: string | null | undefined): StickerCard | null {
  const c = decodeCard(body ?? null);
  if (!c || c.type !== "sticker") return null;
  return c;
}
