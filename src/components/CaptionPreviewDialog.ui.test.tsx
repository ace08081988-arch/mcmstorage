// @vitest-environment happy-dom
/**
 * UI/screenshot-style verification for CaptionPreviewDialog.
 *
 * Goal: sebelum owner menekan "Kirim WA sekarang", pastikan teks caption
 * — termasuk ikon 📍 dan link Google Maps — benar-benar TERTULIS di DOM
 * yang dirender ke layar. Test lama hanya memverifikasi output builder
 * (`buildPaymentMessageLines`); test ini memverifikasi jalur render
 * modal preview sehingga regresi "caption ada di data tapi tidak muncul
 * di preview" (mis. dialog memfilter emoji, terpotong overflow, gagal
 * mount karena Radix Portal) langsung ketahuan CI.
 *
 * Environment happy-dom + @testing-library/react.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within, fireEvent } from "@testing-library/react";
import { CaptionPreviewDialog } from "./CaptionPreviewDialog";
import {
  buildPaymentMessageLines,
  getPaymentBreakdown,
  LOCATION_MISSING_PLACEHOLDER,
} from "@/lib/payment-summary";

// Radix Dialog membaca matchMedia; stub minimal supaya tidak throw di happy-dom.
if (!window.matchMedia) {
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
// scrollIntoView dipakai Radix untuk fokus; happy-dom belum implement.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}

function buildCaption(
  method: "kas" | "hutang" | "partial",
  locationUrl: string | null | undefined,
  paid = 0,
): string {
  const total = 150_000;
  const breakdown = getPaymentBreakdown(method, total, paid);
  const lines = ["Paket #A1", "1 kotak × Rp 150.000", `Total: Rp ${total.toLocaleString("id-ID")}`];
  lines.push(...buildPaymentMessageLines(breakdown, { locationUrl }));
  return lines.join("\n");
}

afterEach(() => cleanup());

describe("CaptionPreviewDialog — verifikasi tampilan caption", () => {
  it("📍 dan link Google Maps benar-benar TERTULIS di preview (kas + lokasi)", () => {
    const caption = buildCaption("kas", "https://maps.google.com/?q=-6.2,106.8");
    render(
      <CaptionPreviewDialog
        open
        onOpenChange={() => {}}
        caption={caption}
        onConfirm={() => {}}
      />,
    );
    const pre = screen.getByTestId("caption-preview-text");
    expect(pre.textContent).toContain("📍 Lokasi ambil:");
    expect(pre.textContent).toContain("https://maps.google.com/?q=-6.2,106.8");
    // Tombol kirim aktif (caption non-kosong) → owner boleh lanjut.
    expect(screen.getByTestId("caption-preview-confirm")).not.toBeDisabled();
    // Tidak ada banner peringatan lokasi.
    expect(screen.queryByTestId("caption-preview-loc-warning")).toBeNull();
  });

  it("Metode Hutang: baris Sisa hutang + 📍 lokasi muncul di layar", () => {
    const caption = buildCaption("hutang", "https://maps.app.goo.gl/xyz");
    render(<CaptionPreviewDialog open onOpenChange={() => {}} caption={caption} onConfirm={() => {}} />);
    const pre = screen.getByTestId("caption-preview-text");
    expect(pre.textContent).toContain("Sisa hutang: Rp 150.000");
    expect(pre.textContent).toContain("📍 Lokasi ambil:");
    expect(pre.textContent).toContain("https://maps.app.goo.gl/xyz");
  });

  it("Bayar sebagian: baris Dibayar + Sisa + 📍 muncul, urutannya benar", () => {
    const caption = buildCaption("partial", "https://goo.gl/maps/abc", 100_000);
    render(<CaptionPreviewDialog open onOpenChange={() => {}} caption={caption} onConfirm={() => {}} />);
    const text = screen.getByTestId("caption-preview-text").textContent ?? "";
    const iDibayar = text.indexOf("Dibayar:");
    const iSisa = text.indexOf("Sisa hutang:");
    const iPin = text.indexOf("📍");
    expect(iDibayar).toBeGreaterThan(-1);
    expect(iSisa).toBeGreaterThan(iDibayar);
    expect(iPin).toBeGreaterThan(iSisa);
  });

  it("Lokasi kosong: placeholder tertulis di caption DAN banner peringatan tampil", () => {
    const caption = buildCaption("kas", "");
    render(
      <CaptionPreviewDialog
        open
        onOpenChange={() => {}}
        caption={caption}
        onConfirm={() => {}}
        locationMissing
      />,
    );
    const pre = screen.getByTestId("caption-preview-text");
    expect(pre.textContent).toContain(LOCATION_MISSING_PLACEHOLDER);
    const warn = screen.getByTestId("caption-preview-loc-warning");
    expect(within(warn).getByText(/Lokasi belum diisi/i)).toBeTruthy();
    expect(within(warn).getByText(/📍 tidak akan ikut terkirim/)).toBeTruthy();
  });

  it("Lokasi hanya whitespace/ZWSP: dianggap kosong — placeholder muncul, bukan URL", () => {
    const caption = buildCaption("hutang", "   \u200B\u200C  ");
    render(
      <CaptionPreviewDialog open onOpenChange={() => {}} caption={caption} onConfirm={() => {}} locationMissing />,
    );
    const text = screen.getByTestId("caption-preview-text").textContent ?? "";
    expect(text).toContain(LOCATION_MISSING_PLACEHOLDER);
    expect(text).not.toContain("📍 Lokasi ambil:");
  });

  it("Owner boleh mengisi lokasi inline → onSaveLocation dipanggil dengan URL bersih", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const caption = buildCaption("kas", "");
    render(
      <CaptionPreviewDialog
        open
        onOpenChange={() => {}}
        caption={caption}
        onConfirm={() => {}}
        locationMissing
        onSaveLocation={onSave}
      />,
    );
    const input = screen.getByTestId("caption-preview-loc-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  https://maps.google.com/?q=1,2  " } });
    fireEvent.click(screen.getByTestId("caption-preview-loc-save"));
    // Menunggu microtask promise.
    await Promise.resolve();
    expect(onSave).toHaveBeenCalledWith("https://maps.google.com/?q=1,2");
  });

  it("Caption kosong: tombol Kirim disabled — owner tidak bisa kirim pesan tanpa isi", () => {
    render(<CaptionPreviewDialog open onOpenChange={() => {}} caption="" onConfirm={() => {}} />);
    expect(screen.getByTestId("caption-preview-confirm")).toBeDisabled();
    expect(screen.getByTestId("caption-preview-text").textContent).toContain("(caption kosong)");
  });
});