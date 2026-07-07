import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guardrail: seluruh jalur "Kirim ke pembeli" dari beranda WAJIB
 * mengantarkan owner ke /ecer dengan flag `send=1`, dan halaman /ecer
 * WAJIB mengonsumsi flag itu untuk otomatis membuka dialog verifikasi
 * pembayaran. Tanpa test ini, tombol lama "Kirim WA" bisa masuk lagi
 * lewat back-door dan menerobos verifikasi.
 */
const readSrc = (rel: string) =>
  readFileSync(resolve(process.cwd(), rel), "utf8");

/** Ambil blok source Link "Kirim ke pembeli" — dari `<Link` sampai `</Link>` terdekat yg mengandung teksnya. */
function extractKirimLinkBlock(src: string): string | null {
  const idx = src.indexOf("Kirim ke pembeli");
  if (idx < 0) return null;
  // Backtrack ke `<Link` sebelum idx.
  const start = src.lastIndexOf("<Link", idx);
  const end = src.indexOf("</Link>", idx);
  if (start < 0 || end < 0) return null;
  return src.slice(start, end + "</Link>".length);
}

describe("Beranda → /ecer?send=1 wajib memicu dialog pembayaran", () => {
  it("ReadyEcerSection: tombol 'Kirim ke pembeli' → <Link to=/ecer …> dengan send:\"1\"", () => {
    const src = readSrc("src/components/ReadyEcerSection.tsx");
    const block = extractKirimLinkBlock(src);
    expect(block, "Link 'Kirim ke pembeli' tidak ditemukan").not.toBeNull();
    expect(block!).toMatch(/to=["']\/ecer["']/);
    expect(block!).toMatch(/search=\{\{[\s\S]*?send:\s*["']1["'][\s\S]*?\}\}/);
    // Tidak ada tombol WA cepat yang menerobos verifikasi di dashboard row.
    expect(src).not.toMatch(/Kirim ke pembeli via WA/);
  });

  it("ReadyEcerSection: Link tombol memutus gestur long-press & onClickCapture kartu induk", () => {
    const src = readSrc("src/components/ReadyEcerSection.tsx");
    const block = extractKirimLinkBlock(src);
    expect(block, "Link 'Kirim ke pembeli' tidak ditemukan").not.toBeNull();
    // Butuh keduanya: onClick + onPointerDown stopPropagation supaya
    // long-press card & onClickCapture card tidak membatalkan navigasi.
    expect(block!).toMatch(/onPointerDown=\{\s*\(e\)\s*=>\s*e\.stopPropagation\(\)\s*\}/);
    expect(block!).toMatch(/onClick=\{\s*\(e\)\s*=>\s*e\.stopPropagation\(\)\s*\}/);
  });

  it("/ecer: validateSearch mengenali `send` sebagai string opsional", () => {
    const src = readSrc("src/routes/_authenticated.ecer.tsx");
    expect(src).toMatch(
      /send:\s*typeof\s+s\.send\s*===\s*["']string["']\s*\?\s*s\.send\s*:\s*undefined/,
    );
  });

  it("/ecer: send=1 dikonsumsi jadi pendingAutoSend → diteruskan ke TitleDetailView", () => {
    const src = readSrc("src/routes/_authenticated.ecer.tsx");
    expect(src).toMatch(
      /const\s+\[pendingAutoSend,\s*setPendingAutoSend\]\s*=\s*useState\(\s*search\.send\s*===\s*["']1["']\s*\)/,
    );
    expect(src).toMatch(/autoSend=\{pendingAutoSend\}/);
    expect(src).toMatch(
      /onAutoSendConsumed=\{\s*\(\s*\)\s*=>\s*setPendingAutoSend\(\s*false\s*\)\s*\}/,
    );
  });

  it("/ecer TitleDetailView: autoSend memilih kotak aktif & menyerahkan ke modal konfirmasi", () => {
    const src = readSrc("src/routes/_authenticated.ecer.tsx");
    // Cari blok useEffect autoSend. Non-tautological: cek helper resmi
    // filterActivePreps (bukan literal !p.sold_at) dan bahwa efek
    // menyerahkan daftar aktif ke modal konfirmasi (setAutoSendConfirm).
    const m = src.match(
      /if\s*\(\s*!\s*autoSend[\s\S]{0,4000}?onAutoSendConsumed\?\.\(\)\s*;?\s*\}/,
    );
    expect(m, "Blok useEffect auto-send tidak ditemukan").not.toBeNull();
    const block = m![0];
    expect(block).toMatch(/filterActivePreps\(preps\)/);
    expect(block).toMatch(/setSelectionMode\(true\)/);
    expect(block).toMatch(/setSelected\(\s*new Set\(/);
    expect(block).toMatch(/setAutoSendConfirm\(/);
    expect(src).toMatch(/const\s+autoSendFiredRef\s*=\s*useRef\(false\)/);
    expect(block).toMatch(/autoSendFiredRef\.current\s*=\s*true/);
    // Modal konfirmasi harus terpasang di JSX dan onConfirm-nya yang
    // membuka dialog pembayaran — bukan efek.
    expect(src).toMatch(/<AutoSendConfirmDialog/);
    expect(src).toMatch(/onConfirm=\{\(\)\s*=>\s*\{[\s\S]*?setSendOpen\(true\)/);
    // Daftar kotak dapat diperluas (Collapsible) dengan trigger yang dites.
    expect(src).toMatch(/data-testid=["']auto-send-toggle-list["']/);
    expect(src).toMatch(/data-testid=["']auto-send-list-item["']/);
  });

  it("/ecer autoSend: pilih HANYA kotak untuk title_id + warehouse_item_id yg cocok", () => {
    const src = readSrc("src/routes/_authenticated.ecer.tsx");
    // Blok efek harus menyaring ulang di klien terhadap title.id DAN item.id
    // (sabuk pengaman berlapis di atas query server-side). Ini melarang
    // regressi ke `setSelected(new Set(filterActivePreps(preps)…))` tanpa
    // filter title/item.
    const m = src.match(
      /if\s*\(\s*!\s*autoSend[\s\S]{0,3000}?onAutoSendConsumed\?\.\(\)\s*;?\s*\}\s*\)/,
    );
    // Fallback: ambil sampai closing brace terakhir dari efek jika regex
    // di atas gagal (comment/format shift).
    const block = (m?.[0] ?? src.slice(src.indexOf("if (!autoSend"), src.indexOf("}, [autoSend"))) as string;
    expect(block).toMatch(/p\.title_id\s*===\s*title\.id/);
    expect(block).toMatch(/p\.warehouse_item_id[\s\S]{0,80}?item\.id/);
    // Anomali lintas judul/produk WAJIB membatalkan auto-send, bukan diam.
    expect(block).toMatch(/mismatched/);
    expect(block).toMatch(/toast\.error\(/);
    // Toast error WAJIB menyebut kotak spesifik (ID pendek) + alasan
    // (judul lain / produk lain) supaya owner bisa menelusuri.
    expect(block).toMatch(/p\.id/);
    expect(block).toMatch(/judul lain/);
    expect(block).toMatch(/produk lain/);
    expect(block).toMatch(/description:/);
    // Auto-send TIDAK boleh langsung membuka dialog pembayaran: efek
    // harus mengoper `activeNow` ke modal konfirmasi (AutoSendConfirmDialog)
    // yang menampilkan daftar kotak. Dialog pembayaran hanya dibuka lewat
    // handler onConfirm modal itu, bukan dari dalam efek.
    expect(block).toMatch(/setAutoSendConfirm\(\s*\{\s*preps:\s*activeNow\s*\}\s*\)/);
    // Blok efek TIDAK boleh memanggil setSendOpen(true) langsung —
    // itu tugas onConfirm modal konfirmasi.
    expect(block).not.toMatch(/setSendOpen\(\s*true\s*\)/);
    // Dependency effect ikut menyertakan title.id & item.id supaya efek
    // dieksekusi ulang saat judul/produk berganti.
    expect(src).toMatch(/\},\s*\[\s*autoSend,\s*loading,\s*preps,\s*title\.id,\s*item\.id,\s*onAutoSendConsumed\s*\]/);
  });
});
