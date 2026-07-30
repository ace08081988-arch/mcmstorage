/**
 * SSOT template & format caption WhatsApp/Chat.
 *
 * Dipakai oleh alur Ecer (`SendEcerPrepsDialog`) dan Request
 * (`SendPrepToCustomerDialog`). Owner bisa menyesuaikan urutan baris,
 * label, dan penutup dari halaman `/pengaturan-pesan-wa`.
 *
 * Blok pembayaran & lokasi tetap dirakit lewat `buildPaymentMessageLines`
 * di `payment-summary.ts` — template hanya mengatur pembungkusnya
 * (label, urutan, catatan tambahan).
 */
import {
  buildPaymentMessageLines,
  formatPaymentRupiah,
  type PaymentBreakdown,
} from "./payment-summary";

export type WaTemplateItem = {
  label: string;   // "Kacang tanah"
  qty: number;     // 500
  unit: string;    // "g"
};

export type WaTemplateData = {
  title: string;
  items: WaTemplateItem[];
  payment: PaymentBreakdown;
  locationUrl?: string | null;
  note?: string | null;
  customerName?: string | null;
  /** ISO date string; default `now`. */
  date?: string;
};

export type WaTemplateOptions = {
  /** Emoji sebelum judul (misal "⭐ ", "📦 "). Kosong = tanpa emoji. */
  headerEmoji: string;
  /** Label baris di body */
  labelIsi: string;         // "Isi paket"
  labelKotak: string;       // "kotak"
  labelTotal: string;       // "Total"
  labelUntuk: string;       // "Untuk"
  labelCatatan: string;     // "Catatan"
  /** Kalau true → satu baris ringkas "Isi: N kotak". Kalau false → per-kotak. */
  compactItems: boolean;
  /** Baris penutup (kosong = tanpa penutup). */
  closing: string;
};

export const DEFAULT_TEMPLATE = [
  "{header}{judul}",
  "",
  "{items_block}",
  "",
  "{total_line}",
  "{pembayaran}",
  "{untuk_line}",
  "{catatan_block}",
  "{penutup_block}",
].join("\n");

export const DEFAULT_OPTIONS: WaTemplateOptions = {
  headerEmoji: "",
  labelIsi: "Isi paket",
  labelKotak: "kotak",
  labelTotal: "Total",
  labelUntuk: "Untuk",
  labelCatatan: "Catatan",
  compactItems: false,
  closing: "Terima kasih 🙏",
};

export const AVAILABLE_TOKENS = [
  { token: "{header}", label: "Emoji header" },
  { token: "{judul}", label: "Nama paket" },
  { token: "{items_block}", label: "Blok isi paket (judul + list)" },
  { token: "{total_line}", label: "Baris total harga" },
  { token: "{pembayaran}", label: "Blok pembayaran + lokasi (SSOT)" },
  { token: "{untuk_line}", label: "Baris 'Untuk: <nama pembeli>'" },
  { token: "{catatan_block}", label: "Blok catatan (kalau ada)" },
  { token: "{penutup_block}", label: "Baris penutup (Terima kasih)" },
  { token: "{tanggal}", label: "Tanggal id-ID" },
] as const;

function fmtDateID(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(d);
}

function buildItemsBlock(data: WaTemplateData, opts: WaTemplateOptions): string {
  if (data.items.length === 0) return "";
  const header = `${opts.labelIsi} (${data.items.length} ${opts.labelKotak}):`;
  if (opts.compactItems) {
    const totalQty = data.items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
    const unit = data.items[0]?.unit ?? "";
    return `${header}\n• Total ${totalQty} ${unit}`.trimEnd();
  }
  const lines = data.items.map((it, i) => {
    const label = it.label ? ` ${it.label}` : "";
    return `• #${i + 1}${label} — ${it.qty} ${it.unit}`.replace(/\s+—/, " —").trim();
  });
  return [header, ...lines].join("\n");
}

function buildPembayaranBlock(data: WaTemplateData): string {
  const lines = buildPaymentMessageLines(data.payment, {
    locationUrl: data.locationUrl ?? "",
  });
  return lines.join("\n");
}

/** Buang tanda kurung kurawal literal: `\{judul}` → `{judul}` verbatim. */
function escapeLiteralBraces(s: string): string {
  return s.replace(/\\\{/g, "\u0000LB\u0000").replace(/\\\}/g, "\u0000RB\u0000");
}
function unescapeLiteralBraces(s: string): string {
  return s.replace(/\u0000LB\u0000/g, "{").replace(/\u0000RB\u0000/g, "}");
}

/**
 * Rakit caption WA final dari template + data.
 * - Baris yang habis jadi kosong (mis. `{catatan_block}` tanpa catatan)
 *   dihapus, lalu run of >2 blank line dipendek jadi 1 blank.
 */
export function renderWaCaption(
  template: string,
  options: WaTemplateOptions,
  data: WaTemplateData,
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const untuk = data.customerName?.trim()
    ? `${opts.labelUntuk}: ${data.customerName.trim()}`
    : "";
  const catatan = data.note?.trim()
    ? `${opts.labelCatatan}: ${data.note.trim()}`
    : "";
  const penutup = opts.closing.trim();

  const replacements: Record<string, string> = {
    "{header}": opts.headerEmoji || "",
    "{judul}": `*${data.title}*`,
    "{items_block}": buildItemsBlock(data, opts),
    "{total_line}": `${opts.labelTotal}: *${formatPaymentRupiah(data.payment.total)}*`,
    "{pembayaran}": buildPembayaranBlock(data),
    "{untuk_line}": untuk,
    "{catatan_block}": catatan,
    "{penutup_block}": penutup,
    "{tanggal}": fmtDateID(data.date),
  };

  const escaped = escapeLiteralBraces(template);
  let out = escaped;
  for (const [k, v] of Object.entries(replacements)) {
    out = out.split(k).join(v);
  }
  out = unescapeLiteralBraces(out);

  // Buang baris yang habis jadi kosong akibat token kosong, lalu kompres
  // run of blank line berlebih jadi maksimum 1 baris kosong.
  const collapsed = out
    .split("\n")
    .map((l) => l.replace(/\s+$/g, ""))
    .reduce<string[]>((acc, line) => {
      const prev = acc[acc.length - 1];
      if (line === "" && prev === "") return acc;
      acc.push(line);
      return acc;
    }, []);
  // Trim leading/trailing blank lines.
  while (collapsed.length && collapsed[0] === "") collapsed.shift();
  while (collapsed.length && collapsed[collapsed.length - 1] === "") collapsed.pop();
  return collapsed.join("\n");
}

/** Data contoh untuk live-preview di halaman pengaturan. */
export function sampleData(
  scenario: "kas" | "hutang" | "partial",
  withLocation: boolean,
): WaTemplateData {
  const total = 125_000;
  const payment: PaymentBreakdown =
    scenario === "kas"
      ? { method: "kas", label: "Lunas", total, paid: total, remaining: 0, partialValid: true }
      : scenario === "hutang"
        ? { method: "hutang", label: "Hutang", total, paid: 0, remaining: total, partialValid: true }
        : { method: "partial", label: "Bayar sebagian", total, paid: 50_000, remaining: 75_000, partialValid: true };
  return {
    title: "Kacang tanah 500g",
    items: [
      { label: "Kacang", qty: 500, unit: "g" },
      { label: "Kacang", qty: 500, unit: "g" },
    ],
    payment,
    locationUrl: withLocation ? "https://maps.app.goo.gl/contoh" : "",
    note: "Tolong hubungi sebelum ambil ya",
    customerName: "Budi",
  };
}
