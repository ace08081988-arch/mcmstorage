import { useEffect, useState } from "react";
import { FileText, Download, MapPin, Phone, MessageCircle, Package, Navigation } from "lucide-react";
import { signedChatUrl } from "@/lib/chat-attachments";
import { decodeCard, type Card } from "@/lib/chat-cards";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { StickerView } from "@/components/chat/StickerView";
import { VoiceNotePlayer } from "@/components/chat/VoiceNotePlayer";

function bytes(n: number | null | undefined): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function useSignedUrl(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    signedChatUrl(path, 3600).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [path]);
  return url;
}

export function MessageAttachment(props: {
  path: string;
  mime: string | null;
  name: string | null;
  size: number | null;
  mine: boolean;
}) {
  const url = useSignedUrl(props.path);
  const mime = props.mime ?? "";
  if (mime.startsWith("image/")) {
    return url ? (
      <a href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg">
        <img src={url} alt={props.name ?? "foto"} className="max-h-72 w-full max-w-xs object-cover" loading="lazy" />
      </a>
    ) : (
      <div className="grid h-32 w-48 animate-pulse place-items-center rounded-lg bg-muted/60 text-[10px] text-muted-foreground">Memuat foto…</div>
    );
  }
  if (mime.startsWith("video/")) {
    return url ? (
      <video src={url} controls preload="metadata" className="max-h-72 w-full max-w-xs rounded-lg bg-black" />
    ) : (
      <div className="grid h-32 w-48 animate-pulse place-items-center rounded-lg bg-muted/60 text-[10px] text-muted-foreground">Memuat video…</div>
    );
  }
  if (mime.startsWith("audio/")) {
    return url ? (
      <VoiceNotePlayer url={url} mine={props.mine} />
    ) : (
      <div className="grid h-10 w-52 animate-pulse place-items-center rounded-full bg-muted/60 text-[10px] text-muted-foreground">
        Memuat voice note…
      </div>
    );
  }
  return (
    <a
      href={url ?? "#"}
      target="_blank"
      rel="noreferrer"
      className={`flex items-center gap-2 rounded-lg border px-2 py-2 text-xs ${props.mine ? "border-primary-foreground/30 bg-primary-foreground/10" : "border-border bg-background/70"}`}
    >
      <FileText className="h-5 w-5 shrink-0 opacity-70" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{props.name ?? "Berkas"}</div>
        <div className="text-[10px] opacity-70">{mime || "berkas"} {props.size ? `· ${bytes(props.size)}` : ""}</div>
      </div>
      <Download className="h-4 w-4 opacity-70" />
    </a>
  );
}

export function CardBlock({ card, mine }: { card: Card; mine: boolean }) {
  if (card.type === "location") {
    const liveActive = card.live_until && new Date(card.live_until).getTime() > Date.now();
    const map = `https://www.google.com/maps/search/?api=1&query=${card.lat},${card.lng}`;
    const embed = `https://www.openstreetmap.org/export/embed.html?bbox=${card.lng - 0.005},${card.lat - 0.004},${card.lng + 0.005},${card.lat + 0.004}&layer=mapnik&marker=${card.lat},${card.lng}`;
    return (
      <div className={`overflow-hidden rounded-lg border text-xs ${mine ? "border-primary-foreground/30 bg-primary-foreground/10" : "border-border bg-background/70"}`}>
        <iframe title="peta" src={embed} className="h-32 w-full max-w-xs" />
        <div className="px-2 py-1.5">
          <div className="flex items-center gap-1 font-semibold">
            {liveActive ? <Navigation className="h-3.5 w-3.5 animate-pulse text-primary" /> : <MapPin className="h-3.5 w-3.5" />}
            {liveActive ? "Live location" : (card.label || "Lokasi")}
          </div>
          {liveActive ? (
            <div className="opacity-70">Berakhir {new Date(card.live_until!).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</div>
          ) : null}
          <div className="opacity-70">{card.lat.toFixed(5)}, {card.lng.toFixed(5)}</div>
          <a href={map} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-primary underline">
            Buka di Maps
          </a>
        </div>
      </div>
    );
  }
  if (card.type === "contact") {
    const waPhone = card.phone.replace(/[^0-9]/g, "");
    return (
      <div className={`rounded-lg border px-2 py-2 text-xs ${mine ? "border-primary-foreground/30 bg-primary-foreground/10" : "border-border bg-background/70"}`}>
        <div className="font-semibold">👤 {card.name}</div>
        <div className="opacity-80">{card.phone}</div>
        {card.note ? <div className="opacity-70">{card.note}</div> : null}
        <div className="mt-1 flex gap-2">
          <a href={`tel:${card.phone}`} className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 hover:bg-accent">
            <Phone className="h-3 w-3" /> Telepon
          </a>
          <a href={`https://wa.me/${waPhone}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 hover:bg-accent">
            <MessageCircle className="h-3 w-3" /> Chat
          </a>
        </div>
      </div>
    );
  }
  if (card.type === "product") {
    return (
      <div className={`rounded-lg border px-2 py-2 text-xs ${mine ? "border-primary-foreground/30 bg-primary-foreground/10" : "border-border bg-background/70"}`}>
        <div className="flex items-center gap-1 font-semibold">
          <Package className="h-3.5 w-3.5" /> {card.name}
        </div>
        {card.package ? <div className="opacity-80">{card.package}</div> : null}
        {card.category ? <div className="opacity-70">{card.category}</div> : null}
        <Link to="/ecer" search={{ item: undefined, title: undefined, highlight: undefined }} className="mt-1 inline-flex items-center gap-1 text-primary underline">
          Buka produk
        </Link>
      </div>
    );
  }
  if (card.type === "sticker") {
    return <StickerView card={card} mine={mine} />;
  }
  return null;
}

export { decodeCard };