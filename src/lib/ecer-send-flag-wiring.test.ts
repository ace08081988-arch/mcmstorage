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

const compact = (s: string) => s.replace(/\s+/g, " ");

describe("Beranda → /ecer?send=1 wajib memicu dialog pembayaran", () => {
  it("ReadyEcerSection: tombol 'Kirim ke pembeli' → <Link to=/ecer …> dengan send:\"1\"", () => {
    const src = compact(readSrc("src/components/ReadyEcerSection.tsx"));
    // Tombol harus berupa Link ke /ecer yang membawa send: "1" di search.
    expect(src).toMatch(
      /<Link[^>]*to=["']\/ecer["'][^>]*search=\{\{[^}]*send:\s*["']1["'][^}]*\}\}[^>]*>\s*<Send[^>]*\/>\s*Kirim ke pembeli/,
    );
    // Tidak boleh ada tombol WA/Chat lama di baris kartu yang menerobos verifikasi.
    // (Share ke pegawai internal tetap boleh, tapi bukan "Kirim ke pembeli via WA cepat".)
    expect(src).not.toMatch(/Kirim ke pembeli via WA/);
  });

  it("ReadyEcerSection: Link tombol tidak tertangkap gestur kartu induk", () => {
    // Setelah fix: Link punya onPointerDown stopPropagation supaya long-press
    // / onClickCapture kartu tidak membatalkan klik.
    const src = readSrc("src/components/ReadyEcerSection.tsx");
    const m = src.match(
      /<Link[\s\S]{0,600}?Kirim ke pembeli[\s\S]{0,80}?<\/Link>/,
    );
    expect(m, "Link 'Kirim ke pembeli' tidak ditemukan").not.toBeNull();
    expect(m![0]).toMatch(/onPointerDown=\{\(e\)\s*=>\s*e\.stopPropagation\(\)\}/);
    expect(m![0]).toMatch(/onClick=\{\(e\)\s*=>\s*e\.stopPropagation\(\)\}/);
  });

  it("/ecer: validateSearch mengenali `send` sebagai string opsional", () => {
    const src = compact(readSrc("src/routes/_authenticated.ecer.tsx"));
    expect(src).toMatch(
      /validateSearch:[\s\S]{0,300}?send:\s*typeof\s+s\.send\s*===\s*["']string["']\s*\?\s*s\.send\s*:\s*undefined/,
    );
  });

  it("/ecer: send=1 dikonsumsi jadi pendingAutoSend → diteruskan ke TitleDetailView", () => {
    const src = readSrc("src/routes/_authenticated.ecer.tsx");
    // State ambil dari search sekali (agar URL bisa dibersihkan setelahnya).
    expect(src).toMatch(
      /const\s+\[pendingAutoSend,\s*setPendingAutoSend\]\s*=\s*useState\(\s*search\.send\s*===\s*["']1["']\s*\)/,
    );
    // Diteruskan sebagai prop `autoSend` ke TitleDetailView, dengan callback
    // konsumsi supaya flag hanya menyala sekali.
    expect(src).toMatch(/autoSend=\{pendingAutoSend\}/);
    expect(src).toMatch(
      /onAutoSendConsumed=\{\s*\(\s*\)\s*=>\s*setPendingAutoSend\(\s*false\s*\)\s*\}/,
    );
  });

  it("/ecer TitleDetailView: autoSend memilih semua kotak aktif dan membuka dialog", () => {
    const src = readSrc("src/routes/_authenticated.ecer.tsx");
    // Kontrak efek auto-send: pilih SEMUA kotak AKTIF (helper resmi), lalu
    // buka dialog verifikasi pembayaran (setSendOpen(true)), lalu consume flag.
    const m = src.match(
      /if\s*\(!autoSend[\s\S]{0,1200}?onAutoSendConsumed\?\.\(\)\s*;?\s*\}/,
    );
    expect(m, "Blok useEffect auto-send tidak ditemukan").not.toBeNull();
    const block = m![0];
    expect(block).toMatch(/filterActivePreps\(preps\)/);
    expect(block).toMatch(/setSelectionMode\(true\)/);
    expect(block).toMatch(/setSelected\(new Set\([\s\S]{0,80}?\.map\(/);
    expect(block).toMatch(/setSendOpen\(true\)/);
    // Idempoten: hanya jalan sekali via ref.
    expect(src).toMatch(/const\s+autoSendFiredRef\s*=\s*useRef\(false\)/);
    expect(block).toMatch(/autoSendFiredRef\.current\s*=\s*true/);
  });
});
