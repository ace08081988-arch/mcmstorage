import { describe, it, expect } from "vitest";
import { encodeCard, decodeCard, isCardBody, previewText } from "./chat-cards";

// Kunci kontrak: reply-preview harus SELALU menampilkan teks ringkas
// untuk card (lokasi / keranjang / stiker / kontak / produk), tidak
// pernah JSON mentah — apa pun orientasi layar.
describe("chat-cards previewText", () => {
  it("lokasi biasa → '📍 Lokasi dibagikan'", () => {
    const body = encodeCard({ type: "location", lat: -7.6, lng: 111.5 });
    expect(previewText(body)).toBe("📍 Lokasi dibagikan");
  });

  it("lokasi live → '📍 Berbagi live location'", () => {
    const body = encodeCard({
      type: "location",
      lat: -7.6,
      lng: 111.5,
      live_until: "2099-01-01T00:00:00Z",
    });
    expect(previewText(body)).toBe("📍 Berbagi live location");
  });

  it("keranjang → '🛒 Keranjang · N item'", () => {
    const body = encodeCard({
      type: "cart",
      cart_group_id: "g1",
      lines: [
        { name: "kristal 1g", qty: 1, price: 850000 },
        { name: "botol", qty: 2 },
      ],
    });
    expect(previewText(body)).toBe("🛒 Keranjang · 2 item");
  });

  it("stiker teks → '🏷️ <text>'", () => {
    const body = encodeCard({ type: "sticker", kind: "text", text: "SALE" });
    expect(previewText(body)).toBe("🏷️ SALE");
  });

  it("sentinel di baris kedua tetap terdeteksi (tanpa JSON mentah)", () => {
    const inner = JSON.stringify({ type: "location", lat: -7.6, lng: 111.5 });
    const body = `caption di atas\n[mcm-card:v1]\n${inner}`;
    expect(isCardBody(body)).toBe(true);
    expect(decodeCard(body)?.type).toBe("location");
    expect(previewText(body)).toBe("📍 Lokasi dibagikan");
    // Tidak boleh membocorkan JSON mentah.
    expect(previewText(body)).not.toContain("[mcm-card:v1]");
    expect(previewText(body)).not.toContain("\"type\"");
  });

  it("payload rusak tetap kembali fallback '📎 Kartu chat', bukan JSON", () => {
    const body = `[mcm-card:v1]\n{not json`;
    expect(isCardBody(body)).toBe(true);
    expect(previewText(body)).toBe("📎 Kartu chat");
  });

  it("pesan biasa (tanpa sentinel) diteruskan apa adanya", () => {
    expect(previewText("halo dunia")).toBe("halo dunia");
  });
});