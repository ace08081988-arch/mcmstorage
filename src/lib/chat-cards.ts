// Special "card" payloads embedded in message.body as JSON.
// Kept inside body so we don't need a schema change.
// Format: line 1 = "[mcm-card:v1]" sentinel, line 2+ = JSON.

export type LocationCard = {
  type: "location";
  lat: number;
  lng: number;
  label?: string;
  accuracy?: number;
  live_until?: string; // ISO; if present and in future = live location
};
export type ContactCard = {
  type: "contact";
  name: string;
  phone: string;
  note?: string;
};
export type ProductCard = {
  type: "product";
  id: string;
  name: string;
  package?: string; // e.g. "0.2 gram" / "1 botol"
  category?: string | null;
  href?: string;
};

/**
 * Stiker yang dirender langsung di gelembung chat. Semua field
 * kosmetik (warna, rotasi, skala, caption) bisa diedit ulang oleh
 * pengirim via menu "Edit stiker" → dialog stiker dibuka pre-filled.
 */
export type StickerArrowDir =
  | "up" | "down" | "left" | "right"
  | "up-left" | "up-right" | "down-left" | "down-right";
export type StickerCard =
  | {
      type: "sticker"; kind: "arrow"; direction: StickerArrowDir;
      color?: string; bg?: string; rotation?: number; scale?: number; caption?: string;
    }
  | {
      type: "sticker"; kind: "bank";
      bank: string; account_number: string; account_name: string;
      color?: string; bg?: string; rotation?: number; scale?: number; caption?: string;
    }
  | {
      type: "sticker"; kind: "text"; text: string;
      color?: string; bg?: string; rotation?: number; scale?: number; caption?: string;
    }
  | {
      type: "sticker"; kind: "ai"; image_path: string; prompt?: string;
      rotation?: number; scale?: number; caption?: string;
    };

export type Card = LocationCard | ContactCard | ProductCard | StickerCard;

const SENTINEL = "[mcm-card:v1]";

export function encodeCard(card: Card, fallbackText?: string): string {
  return `${SENTINEL}\n${JSON.stringify(card)}${fallbackText ? `\n${fallbackText}` : ""}`;
}

export function decodeCard(body: string | null | undefined): Card | null {
  if (!body) return null;
  if (!body.startsWith(SENTINEL)) return null;
  const nl = body.indexOf("\n");
  if (nl < 0) return null;
  const rest = body.slice(nl + 1);
  const end = rest.indexOf("\n");
  const json = end < 0 ? rest : rest.slice(0, end);
  try {
    const parsed = JSON.parse(json) as Card;
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function previewText(body: string | null | undefined): string | null {
  if (!body) return null;
  const c = decodeCard(body);
  if (!c) return body;
  if (c.type === "location") return c.live_until ? "📍 Berbagi live location" : "📍 Lokasi dibagikan";
  if (c.type === "contact") return `👤 Kontak: ${c.name}`;
  if (c.type === "product") return `🛒 Produk: ${c.name}`;
  if (c.type === "sticker") {
    if (c.kind === "arrow") return `🧭 Stiker panah${c.caption ? ` · ${c.caption}` : ""}`;
    if (c.kind === "bank") return `🏦 Rekening ${c.bank} · ${c.account_number}`;
    if (c.kind === "text") return `🏷️ ${c.text.slice(0, 60)}`;
    if (c.kind === "ai") return `✨ Stiker AI${c.caption ? ` · ${c.caption}` : ""}`;
  }
  return body;
}