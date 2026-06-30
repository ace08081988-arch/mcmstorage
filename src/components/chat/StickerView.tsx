import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import type { StickerCard, StickerArrowDir } from "@/lib/chat-cards";
import { signedChatUrl } from "@/lib/chat-attachments";

const ARROW_ROTATIONS: Record<StickerArrowDir, number> = {
  right: 0, "down-right": 45, down: 90, "down-left": 135,
  left: 180, "up-left": 225, up: 270, "up-right": 315,
};

/** Stiker dirender inline di gelembung chat. Wrapper menerapkan rotation
 *  dan scale sehingga semua jenis stiker konsisten visualnya. */
export function StickerView({ card, mine }: { card: StickerCard; mine: boolean }) {
  const rotation = card.rotation ?? 0;
  const scale = Math.min(2, Math.max(0.5, card.scale ?? 1));
  const wrapperStyle: React.CSSProperties = {
    transform: `rotate(${rotation}deg) scale(${scale})`,
    transformOrigin: "center",
  };
  return (
    <div className="inline-block max-w-[260px]">
      <div className="flex flex-col items-center gap-1 py-1" style={wrapperStyle}>
        {card.kind === "arrow" ? <ArrowSticker c={card} /> : null}
        {card.kind === "bank" ? <BankSticker c={card} mine={mine} /> : null}
        {card.kind === "text" ? <TextSticker c={card} /> : null}
        {card.kind === "ai" ? <AISticker c={card} /> : null}
      </div>
      {card.caption ? (
        <div className="mt-1 text-center text-[11px] opacity-80">{card.caption}</div>
      ) : null}
    </div>
  );
}

function ArrowSticker({ c }: { c: Extract<StickerCard, { kind: "arrow" }> }) {
  const color = c.color ?? "#ef4444";
  const bg = c.bg ?? "transparent";
  const deg = ARROW_ROTATIONS[c.direction];
  return (
    <div
      className="flex h-24 w-24 items-center justify-center rounded-2xl"
      style={{ background: bg }}
    >
      <svg viewBox="0 0 100 100" className="h-20 w-20" style={{ transform: `rotate(${deg}deg)` }}>
        <defs>
          <filter id="arrShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.35" />
          </filter>
        </defs>
        <path
          d="M5 40 H58 V20 L95 50 L58 80 V60 H5 Z"
          fill={color} stroke="rgba(0,0,0,0.25)" strokeWidth="2"
          filter="url(#arrShadow)" strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function BankSticker({ c, mine }: { c: Extract<StickerCard, { kind: "bank" }>; mine: boolean }) {
  const bg = c.bg ?? "#0f172a";
  const color = c.color ?? "#fafafa";
  const formatted = c.account_number.replace(/(\d{4})(?=\d)/g, "$1 ");
  async function copy() {
    try {
      await navigator.clipboard.writeText(c.account_number);
      toast.success("Nomor rekening disalin");
    } catch { toast.error("Gagal menyalin"); }
  }
  return (
    <div
      className="w-[240px] rounded-xl px-3 py-2 shadow-md"
      style={{ background: bg, color }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-widest opacity-70">Rekening</div>
        <button
          type="button"
          onClick={copy}
          className="rounded-md border border-current/20 px-1.5 py-0.5 text-[10px] opacity-80 hover:opacity-100"
          aria-label="Salin nomor rekening"
        >
          <Copy className="inline h-3 w-3" /> Salin
        </button>
      </div>
      <div className="mt-0.5 text-base font-bold leading-tight">{c.bank}</div>
      <div className="mt-1 font-mono text-lg tracking-wider tabular-nums">{formatted}</div>
      <div className="mt-0.5 text-[11px] opacity-80">a.n. {c.account_name}</div>
      {/* mine indicator avoids unused-prop lint */}
      <div className="sr-only">{mine ? "milik saya" : "lawan"}</div>
    </div>
  );
}

function TextSticker({ c }: { c: Extract<StickerCard, { kind: "text" }> }) {
  const color = c.color ?? "#fefce8";
  const bg = c.bg ?? "#dc2626";
  return (
    <div
      className="max-w-[220px] rounded-xl px-3 py-2 text-center text-base font-bold shadow-md"
      style={{ background: bg, color }}
    >
      {c.text}
    </div>
  );
}

function AISticker({ c }: { c: Extract<StickerCard, { kind: "ai" }> }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    signedChatUrl(c.image_path, 3600).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [c.image_path]);
  return url ? (
    <img src={url} alt={c.prompt ?? "Stiker AI"} className="h-32 w-32 rounded-xl object-contain" />
  ) : (
    <div className="grid h-32 w-32 animate-pulse place-items-center rounded-xl bg-muted/60 text-[10px] text-muted-foreground">
      Memuat stiker…
    </div>
  );
}
