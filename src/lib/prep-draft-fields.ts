// Draft field non-foto untuk portal pegawai `/t/:token`.
//
// Foto disimpan di IndexedDB (`prep-draft-store.ts`), tetapi catatan, link
// lokasi, koordinat GPS, dan jumlah per produk sebelumnya hilang begitu
// Android WebView me-recreate halaman (balik dari kamera/galeri/share) atau
// pegawai refresh. Nilainya kecil dan hanya relevan selama sesi tab, jadi
// sessionStorage sudah cukup dan tidak menumpuk sampah lintas hari.

export type PrepDraftFields = {
  note?: string;
  locUrl?: string;
  gps?: { lat: number; lng: number; accuracy?: number | null } | null;
  /** Jumlah per baris produk (index → nilai input mentah). */
  quantities?: Record<string, string>;
};

export function draftFieldsKey(draftKey: string): string {
  return `prep-draft-fields:${draftKey}`;
}

function store(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function loadDraftFields(draftKey: string): PrepDraftFields {
  const s = store();
  if (!s) return {};
  try {
    const raw = s.getItem(draftFieldsKey(draftKey));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const v = parsed as PrepDraftFields;
    const out: PrepDraftFields = {};
    if (typeof v.note === "string") out.note = v.note;
    if (typeof v.locUrl === "string") out.locUrl = v.locUrl;
    if (
      v.gps &&
      typeof v.gps === "object" &&
      Number.isFinite(v.gps.lat) &&
      Number.isFinite(v.gps.lng)
    ) {
      out.gps = {
        lat: v.gps.lat,
        lng: v.gps.lng,
        accuracy: typeof v.gps.accuracy === "number" ? v.gps.accuracy : null,
      };
    }
    if (v.quantities && typeof v.quantities === "object") {
      const q: Record<string, string> = {};
      for (const [k, val] of Object.entries(v.quantities)) {
        if (typeof val === "string") q[k] = val;
      }
      if (Object.keys(q).length > 0) out.quantities = q;
    }
    return out;
  } catch {
    return {};
  }
}

function isEmpty(f: PrepDraftFields): boolean {
  return (
    !f.note?.trim() &&
    !f.locUrl?.trim() &&
    !f.gps &&
    Object.values(f.quantities ?? {}).every((v) => !String(v).trim())
  );
}

export function saveDraftFields(draftKey: string, fields: PrepDraftFields): void {
  const s = store();
  if (!s) return;
  try {
    if (isEmpty(fields)) {
      s.removeItem(draftFieldsKey(draftKey));
      return;
    }
    s.setItem(draftFieldsKey(draftKey), JSON.stringify(fields));
  } catch {
    /* kuota penuh / private mode: draft field bukan data kritis */
  }
}

export function clearDraftFields(draftKey: string): void {
  const s = store();
  if (!s) return;
  try {
    s.removeItem(draftFieldsKey(draftKey));
  } catch {
    /* abaikan */
  }
}
