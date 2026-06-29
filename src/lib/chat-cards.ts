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
export type Card = LocationCard | ContactCard | ProductCard;

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
  return body;
}