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

/** Ambil blok source tombol "Kirim ke pembeli" — dari `<button` sampai `</button>` terdekat yg mengandung teksnya. */
function extractKirimButtonBlock(src: string): string | null {
  const idx = src.indexOf("Kirim ke pembeli");
  if (idx < 0) return null;
  // Backtrack ke `<button` sebelum idx (abaikan tombol lain yg mungkin ada).
  const start = src.lastIndexOf("<button", idx);
  const end = src.indexOf("</button>", idx);
  if (start < 0 || end < 0) return null;
  return src.slice(start, end + "</button>".length);
}

describe("Beranda → /ecer?send=1 wajib memicu dialog pembayaran", () => {
  it("/ecer autoSend: mencatat audit log & menampilkan ringkasan Riwayat", () => {
    const src = readSrc("src/routes/_authenticated.ecer.tsx");
    // Import helper audit.
    expect(src).toMatch(
      /from\s+["']@\/lib\/auto-send-audit["']/,
    );
    expect(src).toMatch(/logAutoSendProposed/);
    expect(src).toMatch(/logAutoSendTerminal/);
    expect(src).toMatch(/finalizeAutoSend/);
    // Terminal outcomes tanpa modal juga dicatat (mismatched + empty).
    expect(src).toMatch(/outcome:\s*["']mismatched["']/);
    expect(src).toMatch(/outcome:\s*["']empty["']/);
    // Modal cancel → cancelled (via reason dialog, auditId dari state).
    expect(src).toMatch(/finalizeAutoSend\(\s*st\.auditId\s*,\s*["']cancelled["']/);
    // onSent → confirmed + summary state di-set.
    expect(src).toMatch(/finalizeAutoSend\(\s*auditId\s*,\s*["']confirmed["']/);
    expect(src).toMatch(/setAutoSendSummary\(/);
    // Banner ringkasan tersedia di JSX Riwayat Terkirim.
    expect(src).toMatch(/data-testid=["']auto-send-summary["']/);
    // Alasan pembatalan direkam: dialog reason + banner cancel + finalize
    // menyertakan note JSON berisi reason & summary supaya audit bisa
    // ditelusuri (bukan hanya token "confirm_modal"/"closed_send_dialog").
    expect(src).toMatch(/<AutoSendCancelReasonDialog/);
    expect(src).toMatch(/data-testid=["']auto-send-cancel-summary["']/);
    expect(src).toMatch(/setAutoSendCancel\(/);
    expect(src).toMatch(/setAutoSendCancelSummary\(/);
    // Testid dialog alasan (radio + textarea + submit) tinggal di modul
    // komponen setelah ekstraksi supaya reusable oleh harness e2e.
    const dialogSrc = readSrc("src/components/ecer/AutoSendDialogs.tsx");
    expect(dialogSrc).toMatch(/data-testid=["']auto-send-cancel-reason["']/);
    expect(dialogSrc).toMatch(/data-testid=["']auto-send-cancel-reason-group["']/);
    expect(dialogSrc).toMatch(/data-testid=["']auto-send-cancel-detail["']/);
    expect(dialogSrc).toMatch(/data-testid=["']auto-send-cancel-submit["']/);
    // Note yang dikirim ke finalizeAutoSend WAJIB JSON berisi reason,
    // source, dan ringkasan seleksi — bukan sekadar string bebas.
    expect(src).toMatch(/JSON\.stringify\(\{[\s\S]{0,200}?reason[\s\S]{0,200}?source[\s\S]{0,200}?summary/);
    // Kedua path cancel (confirm modal & closed_send_dialog) harus lewat
    // dialog alasan, bukan finalize langsung.
    expect(src).toMatch(/source:\s*["']confirm_modal["']/);
    expect(src).toMatch(/source:\s*["']closed_send_dialog["']/);
    // Fallback: kalau owner menutup dialog reason tanpa memilih, tetap
    // finalize dengan alasan "tidak_dijelaskan".
    expect(src).toMatch(/tidak_dijelaskan/);
  });

  it("ReadyEcerSection: tombol 'Kirim ke pembeli' → navigate('/ecer', { send:'1' }) untuk verifikasi bayar", () => {
    const src = readSrc("src/components/ReadyEcerSection.tsx");
    const block = extractKirimButtonBlock(src);
    expect(block, "Tombol 'Kirim ke pembeli' tidak ditemukan").not.toBeNull();
    // Tombol memanggil confirmDialog dulu, baru navigate ke /ecer dengan send=1.
    expect(block!).toMatch(/confirmDialog\(/);
    expect(block!).toMatch(/navigate\(\s*\{[\s\S]*?to:\s*["']\/ecer["'][\s\S]*?\}\s*\)/);
    expect(block!).toMatch(/send:\s*["']1["']/);
    // Tidak ada tombol WA cepat yang menerobos verifikasi di dashboard row.
    expect(src).not.toMatch(/Kirim ke pembeli via WA/);
  });

  it("ReadyEcerSection: tombol memutus gestur long-press & onClickCapture kartu induk", () => {
    const src = readSrc("src/components/ReadyEcerSection.tsx");
    const block = extractKirimButtonBlock(src);
    expect(block, "Tombol 'Kirim ke pembeli' tidak ditemukan").not.toBeNull();
    // Butuh keduanya: onClick + onPointerDown stopPropagation supaya
    // long-press card & onClickCapture card tidak membatalkan navigasi.
    expect(block!).toMatch(/onPointerDown=\{\s*\(e\)\s*=>\s*e\.stopPropagation\(\)\s*\}/);
    expect(block!).toMatch(/onClick=\{\s*\(e\)\s*=>\s*\{[\s\S]*?e\.stopPropagation\(\);[\s\S]*?\}\s*\}/);
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
      /if\s*\(\s*!\s*autoSend[\s\S]{0,6000}?onAutoSendConsumed\?\.\(\)\s*;?\s*\}/,
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
    // Daftar kotak dapat diperluas (Collapsible) — implementasi dipindah
    // ke modul komponen `AutoSendDialogs` supaya bisa dipakai harness e2e.
    const dialogSrc = readSrc("src/components/ecer/AutoSendDialogs.tsx");
    expect(dialogSrc).toMatch(/data-testid=["']auto-send-toggle-list["']/);
    expect(dialogSrc).toMatch(/data-testid=["']auto-send-list-item["']/);
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
