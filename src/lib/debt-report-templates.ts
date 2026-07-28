/**
 * Template teks laporan hutang/piutang.
 *
 * Pemilik toko sering menyunting teks laporan di dialog pratinjau (menambah
 * salam, catatan tempo bayar, dsb). Modul ini menyimpan hasil suntingan itu
 * sebagai template bernama supaya bisa dipakai lagi di percakapan lain.
 *
 * Angka TIDAK dibekukan: saat disimpan, nilai dinamis (nama lawan bicara,
 * nominal hutang/piutang/saldo, tanggal) diganti placeholder; saat dipakai
 * ulang, placeholder diisi kembali dari angka SSOT terbaru. Jadi template
 * hanya mengunci GAYA, bukan angkanya.
 */
import { rupiah } from "@/lib/stock-format";
import { peekUserIdSync, scopedKey } from "@/lib/user-scoped-storage";

export type DebtReportTemplate = {
  id: string;
  name: string;
  /** Body dengan placeholder {nama} {hutang} {piutang} {saldo} {tanggal}. */
  body: string;
  updatedAt: string;
};

export type DebtReportContext = {
  peerName: string;
  hutang: number;
  piutang: number;
};

const BASE = "mcm:debtReport:templates";

function key() {
  return scopedKey(BASE, peekUserIdSync());
}

function todayId() {
  return new Date().toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceAll(text: string, needle: string, token: string) {
  if (!needle || needle.trim() === "") return text;
  return text.replace(new RegExp(escapeRe(needle), "g"), token);
}

function netOf(ctx: DebtReportContext) {
  return Math.max(0, ctx.piutang) - Math.max(0, ctx.hutang);
}

/** Ubah teks konkret jadi template ber-placeholder. */
export function tokenizeReport(body: string, ctx: DebtReportContext): string {
  let out = body;
  // Urutan penting: nominal terpanjang dulu supaya tidak saling menimpa.
  const pairs: [string, string][] = [
    [rupiah(Math.abs(netOf(ctx))), "{saldo}"],
    [rupiah(Math.max(0, ctx.piutang)), "{piutang}"],
    [rupiah(Math.max(0, ctx.hutang)), "{hutang}"],
    [todayId(), "{tanggal}"],
    [ctx.peerName, "{nama}"],
  ].sort((a, b) => b[0].length - a[0].length) as [string, string][];
  for (const [needle, token] of pairs) out = replaceAll(out, needle, token);
  return out;
}

/** Isi placeholder template dengan angka SSOT terbaru. */
export function renderTemplate(body: string, ctx: DebtReportContext): string {
  return body
    .replace(/\{nama\}/g, ctx.peerName)
    .replace(/\{hutang\}/g, rupiah(Math.max(0, ctx.hutang)))
    .replace(/\{piutang\}/g, rupiah(Math.max(0, ctx.piutang)))
    .replace(/\{saldo\}/g, rupiah(Math.abs(netOf(ctx))))
    .replace(/\{tanggal\}/g, todayId());
}

export function listReportTemplates(): DebtReportTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key());
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is DebtReportTemplate =>
        !!t &&
        typeof t === "object" &&
        typeof (t as DebtReportTemplate).id === "string" &&
        typeof (t as DebtReportTemplate).name === "string" &&
        typeof (t as DebtReportTemplate).body === "string",
    );
  } catch {
    return [];
  }
}

function persist(list: DebtReportTemplate[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(), JSON.stringify(list.slice(0, 30)));
  } catch {
    /* kuota penuh / private mode — abaikan */
  }
}

/**
 * Simpan (atau timpa bila nama sama) template dari teks yang sedang diedit.
 * Mengembalikan daftar terbaru.
 */
export function saveReportTemplate(
  name: string,
  body: string,
  ctx: DebtReportContext,
): DebtReportTemplate[] {
  const clean = name.trim();
  if (!clean || !body.trim()) return listReportTemplates();
  const tpl: DebtReportTemplate = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: clean,
    body: tokenizeReport(body, ctx),
    updatedAt: new Date().toISOString(),
  };
  const rest = listReportTemplates().filter(
    (t) => t.name.toLowerCase() !== clean.toLowerCase(),
  );
  const next = [tpl, ...rest];
  persist(next);
  return next;
}

export function deleteReportTemplate(id: string): DebtReportTemplate[] {
  const next = listReportTemplates().filter((t) => t.id !== id);
  persist(next);
  return next;
}