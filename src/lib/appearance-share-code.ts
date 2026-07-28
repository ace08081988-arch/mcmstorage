// ============================================================================
// Kode preset tampilan — cara ringkas berbagi setting antar perangkat.
// Format: "MCMTAMPILAN1:<base64url(JSON payload)>"
// Payload-nya identik dengan file ekspor (skema mcm.appearance-settings),
// sehingga jalur impor tetap satu: teks di-decode di sini lalu diserahkan ke
// `migrateImportedAppearance`. Foto latar (data URL) sengaja dibuang dari kode
// karena bisa megabyte-an dan tidak muat dikirim lewat chat.
// ============================================================================

export const SHARE_CODE_PREFIX = "MCMTAMPILAN1:";

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Buat kode preset dari payload ekspor. Foto latar besar dilepas. */
export function encodePresetCode(payload: Record<string, unknown>): {
  code: string;
  droppedBackground: boolean;
} {
  const clone = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  const ap = clone.appearance as Record<string, unknown> | undefined;
  let droppedBackground = false;
  if (ap && typeof ap.bgImage === "string" && ap.bgImage.startsWith("data:")) {
    ap.bgImage = "";
    droppedBackground = true;
  }
  return { code: SHARE_CODE_PREFIX + toBase64Url(JSON.stringify(clone)), droppedBackground };
}

/**
 * Kembalikan JSON mentah dari sebuah teks: kode preset di-decode, JSON biasa
 * dilewatkan apa adanya. `null` jika kode rusak.
 */
export function decodeShareText(text: string): string | null {
  const t = text.trim();
  if (!t.startsWith(SHARE_CODE_PREFIX)) return t;
  try {
    const json = fromBase64Url(t.slice(SHARE_CODE_PREFIX.length).trim());
    JSON.parse(json);
    return json;
  } catch {
    return null;
  }
}
