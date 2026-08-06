import { useEffect, useState } from "react";
import { FileText, Download, MapPin, Phone, MessageCircle, Package, Navigation, ShoppingCart, AlertTriangle, ImageOff } from "lucide-react";
import { signedChatUrl } from "@/lib/chat-attachments";
import { decodeCard, type Card } from "@/lib/chat-cards";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { StickerView } from "@/components/chat/StickerView";
import { VoiceNotePlayer } from "@/components/chat/VoiceNotePlayer";

/**
 * Fallback yang ditampilkan saat body pesan berisi payload card Ace tapi
 * decodeCard gagal (payload rusak / versi baru yang belum dikenali).
 * Wajib dipakai agar JSON mentah tidak pernah bocor ke UI chat.
 */
export function UnknownCardBlock({ mine }: { mine: boolean }) {
  return (
    <div
      className={`flex items-center gap-ms-2 rounded-lg border px-ms-2 py-ms-2 text-ms-xs ${
        mine
          ? "border-primary-foreground/30 bg-primary-foreground/10"
          : "border-border bg-background/70"
      }`}
      role="note"
      aria-label="Pesan spesial tidak dapat ditampilkan"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 opacity-70" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">Pesan spesial</div>
        <div className="opacity-70">
          Format tidak dikenali. Perbarui aplikasi untuk melihat kartu ini.
        </div>
      </div>
    </div>
  );
}

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
    const TTL_SEC = 3600;
    // H16: refresh signed URL sebelum kadaluarsa (TTL 1 jam, refresh ~50 mnt)
    // supaya tab yang lama terbuka tidak menampilkan gambar 403.
    const refresh = () => {
      signedChatUrl(path, TTL_SEC).then((u) => { if (alive) setUrl(u); }).catch(() => {});
    };
    refresh();
    const iv = setInterval(refresh, (TTL_SEC - 600) * 1000);
    return () => { alive = false; clearInterval(iv); };
  }, [path]);
  return url;
}

/**
 * Ukuran media di dalam bubble chat dikunci pada satu kotak yang sama
 * (skeleton, gambar, video, dan state error) supaya tinggi bubble tidak
 * "melompat" saat signed URL selesai dimuat — inilah yang selama ini
 * mengganggu alur scroll percakapan.
 */
const MEDIA_BOX = "w-[min(72vw,15rem)] sm:w-[18rem]";
const MEDIA_RATIO = "aspect-[4/5] sm:aspect-[4/3]";

function MediaFrame({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`${MEDIA_BOX} ${MEDIA_RATIO} overflow-hidden rounded-lg bg-muted/40 ${className}`}>
      {children}
    </div>
  );
}

function MediaSkeleton({ label }: { label: string }) {
  return (
    <MediaFrame className="animate-pulse">
      <div className="grid h-full w-full place-items-center text-ms-2xs text-muted-foreground">{label}</div>
    </MediaFrame>
  );
}

export function MessageAttachment(props: {
  path: string;
  mime: string | null;
  name: string | null;
  size: number | null;
  mine: boolean;
  /** attachment_duration_sec dari row pesan; wajib diteruskan agar VoiceNotePlayer konsisten saat remount. */
  durationSec?: number | null;
}) {
  const url = useSignedUrl(props.path);
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setBroken(false); setLoaded(false); }, [props.path]);
  const mime = props.mime ?? "";
  if (mime.startsWith("image/")) {
    if (!url) return <MediaSkeleton label="Memuat foto…" />;
    if (broken) {
      return (
        <MediaFrame>
          <div className="grid h-full w-full place-items-center gap-ms-1 text-center text-ms-2xs text-muted-foreground">
            <ImageOff className="mx-auto h-5 w-5 opacity-60" />
            Foto gagal dimuat
          </div>
        </MediaFrame>
      );
    }
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <MediaFrame className={loaded ? "" : "animate-pulse"}>
          <img
            src={url}
            alt={props.name ?? "foto"}
            className={`h-full w-full object-cover transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setBroken(true)}
          />
        </MediaFrame>
      </a>
    );
  }
  if (mime.startsWith("video/")) {
    return url ? (
      <MediaFrame className="bg-black">
        <video src={url} controls preload="metadata" className="h-full w-full object-contain" />
      </MediaFrame>
    ) : (
      <MediaSkeleton label="Memuat video…" />
    );
  }
  if (mime.startsWith("audio/")) {
    return url ? (
      <VoiceNotePlayer url={url} mine={props.mine} durationSec={props.durationSec ?? null} />
    ) : (
      <div className="grid h-10 w-[min(72vw,13rem)] animate-pulse place-items-center rounded-full bg-muted/60 text-ms-2xs text-muted-foreground">
        Memuat voice note…
      </div>
    );
  }
  return (
    <a
      href={url ?? "#"}
      target="_blank"
      rel="noreferrer"
      aria-disabled={!url}
      className={`flex w-[min(72vw,15rem)] items-center gap-ms-2 rounded-lg border px-ms-2 py-ms-2 text-ms-xs sm:w-[18rem] ${props.mine ? "border-primary-foreground/30 bg-primary-foreground/10" : "border-border bg-background/70"} ${url ? "" : "pointer-events-none opacity-70"}`}
    >
      <FileText className="h-5 w-5 shrink-0 opacity-70" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{props.name ?? "Berkas"}</div>
        <div className="text-ms-2xs opacity-70">{mime || "berkas"} {props.size ? `· ${bytes(props.size)}` : ""}</div>
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
      <div className={`max-w-full overflow-hidden rounded-lg border text-ms-xs ${mine ? "border-primary-foreground/30 bg-primary-foreground/10" : "border-border bg-background/70"}`}>
        <iframe title="peta" src={embed} className="h-32 w-full max-w-full sm:max-w-xs" />
        <div className="px-ms-2 py-1.5">
          <div className="flex items-center gap-ms-1 font-semibold">
            {liveActive ? <Navigation className="h-3.5 w-3.5 animate-pulse text-primary" /> : <MapPin className="h-3.5 w-3.5" />}
            {liveActive ? "Live location" : (card.label || "Lokasi")}
          </div>
          {liveActive ? (
            <div className="opacity-70">Berakhir {new Date(card.live_until!).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</div>
          ) : null}
          <div className="truncate opacity-70">{card.lat.toFixed(5)}, {card.lng.toFixed(5)}</div>
          <a href={map} target="_blank" rel="noreferrer" className="mt-1 inline-flex max-w-full items-center gap-ms-1 truncate text-primary underline">
            Buka di Maps
          </a>
        </div>
      </div>
    );
  }
  if (card.type === "contact") {
    const waPhone = card.phone.replace(/[^0-9]/g, "");
    return (
      <div className={`rounded-lg border px-ms-2 py-ms-2 text-ms-xs ${mine ? "border-primary-foreground/30 bg-primary-foreground/10" : "border-border bg-background/70"}`}>
        <div className="font-semibold">👤 {card.name}</div>
        <div className="opacity-80">WA: {card.phone}</div>
        {card.pin ? <div className="font-mono text-primary">PIN chat Ace: {card.pin}</div> : null}
        {card.note ? <div className="opacity-70">{card.note}</div> : null}
        <div className="mt-1 flex gap-ms-2">
          <a href={`tel:${card.phone}`} className="inline-flex items-center gap-ms-1 rounded-md border px-ms-2 py-0.5 hover:bg-accent">
            <Phone className="h-3 w-3" /> Telepon
          </a>
          <a href={`https://wa.me/${waPhone}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-ms-1 rounded-md border px-ms-2 py-0.5 hover:bg-accent">
            <MessageCircle className="h-3 w-3" /> WA
          </a>
        </div>
      </div>
    );
  }
  if (card.type === "product") {
    return (
      <div className={`rounded-lg border px-ms-2 py-ms-2 text-ms-xs ${mine ? "border-primary-foreground/30 bg-primary-foreground/10" : "border-border bg-background/70"}`}>
        <div className="flex items-center gap-ms-1 font-semibold">
          <Package className="h-3.5 w-3.5" /> {card.name}
        </div>
        {card.package ? <div className="opacity-80">{card.package}</div> : null}
        {card.category ? <div className="opacity-70">{card.category}</div> : null}
        {/*
         * M1: kartu produk yang di-share via chat harus membuka /ecer dan
         * langsung menyorot item yang dimaksud. Sebelumnya seluruh search
         * di-set `undefined` sehingga link hanya membuka halaman umum tanpa
         * konteks — operator harus scroll manual untuk menemukan produk.
         * `card.id` = warehouse item id (lihat AttachMenu produk),
         * cocok dengan search param `item` yang di-parse oleh route Ecer.
         */}
        <Link
          to="/ecer"
          search={{ item: card.id, title: undefined, highlight: undefined, send: undefined }}
          className="mt-1 inline-flex items-center gap-ms-1 text-primary underline"
        >
          Buka produk
        </Link>
      </div>
    );
  }
  if (card.type === "sticker") {
    return <StickerView card={card} mine={mine} />;
  }
  if (card.type === "cart") {
    const currency = card.currency || "Rp";
    const fmt = (n: number) =>
      `${currency} ${new Intl.NumberFormat("id-ID").format(Math.round(n))}`;
    let total = 0;
    let hasPrice = false;
    for (const l of card.lines) {
      if (typeof l.price === "number" && Number.isFinite(l.price)) {
        total += l.price * l.qty;
        hasPrice = true;
      }
    }
    return (
      <div
        className={`min-w-[16rem] max-w-xs rounded-lg border px-ms-2 py-ms-2 text-ms-xs ${
          mine
            ? "border-primary-foreground/30 bg-primary-foreground/10"
            : "border-border bg-background/70"
        }`}
      >
        <div className="mb-1 flex items-center gap-ms-1 font-semibold">
          <ShoppingCart className="h-3.5 w-3.5" /> Keranjang
          <span className="ml-auto opacity-70">
            {card.lines.length} item
          </span>
        </div>
        <ul className="divide-y divide-current/10">
          {card.lines.map((l, i) => (
            <li key={i} className="flex items-start gap-ms-2 py-1">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{l.name}</div>
                <div className="opacity-70">
                  {new Intl.NumberFormat("id-ID").format(l.qty)}
                  {typeof l.price === "number" && Number.isFinite(l.price)
                    ? ` × ${fmt(l.price)}`
                    : ""}
                </div>
              </div>
              {typeof l.price === "number" && Number.isFinite(l.price) ? (
                <div className="shrink-0 tabular-nums">{fmt(l.price * l.qty)}</div>
              ) : null}
            </li>
          ))}
        </ul>
        {hasPrice ? (
          <div className="mt-1 flex items-center justify-between border-t pt-1 font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{fmt(total)}</span>
          </div>
        ) : null}
        {card.note ? (
          <div className="mt-1 whitespace-pre-wrap opacity-80">Catatan: {card.note}</div>
        ) : null}
        <div className="mt-1 text-ms-2xs opacity-60">
          Pesanan otomatis tercatat di daftar pesanan.
        </div>
      </div>
    );
  }
  // C6: fallback aman — jangan pernah return null. Tipe card tak dikenal
  // (payload lama/rusak) di-render sebagai UnknownCardBlock, jadi bubble
  // tidak pernah kosong tanpa penjelasan.
  return <UnknownCardBlock mine={mine} />;
}

export { decodeCard };