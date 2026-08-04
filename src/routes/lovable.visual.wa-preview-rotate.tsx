/**
 * Harness publik untuk uji otomatis dialog pratinjau WA saat perangkat
 * dirotasi (portrait ↔ landscape). URL: /lovable/visual/wa-preview-rotate
 * — noindex, tanpa auth. Dipakai oleh
 * `tests/e2e/wa-preview-orientation.spec.ts`.
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { confirmWaShare, setWaSkipPreview } from "@/lib/wa-preview";

export const Route = createFileRoute("/lovable/visual/wa-preview-rotate")({
  head: () => ({
    meta: [
      { title: "Harness · Pratinjau WA rotasi" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: WaPreviewRotateHarness,
});

/** PNG 1×1 transparan — cukup untuk merender thumbnail lampiran. */
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function makeFile(name: string): File {
  const bin = atob(PNG_1PX);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: "image/png" });
}

const LONG_TEXT = [
  "Halo Bapak Muhammad Abdurrahman Wijayakusuma, berikut rincian pesanan Anda:",
  "",
  "1. Gula pasir kemasan karung 50kg (kualitas premium) — 12 karung",
  "2. Beras Ramos Super kemasan 25kg — 30 karung",
  "3. Minyak goreng curah drum 200 liter — 2 drum",
  "",
  "Total tagihan: Rp 24.750.000",
  "Sudah dibayar: Rp 10.000.000",
  "Sisa hutang: Rp 14.750.000",
  "",
  "Lokasi ambil barang:",
  "https://maps.app.goo.gl/ContohTautanLokasiYangSangatPanjangSekaliUntukUjiPembungkusanTeks12345",
].join("\n");

function WaPreviewRotateHarness() {
  const [result, setResult] = useState<string>("");

  const open = async (withPhotos: boolean) => {
    setWaSkipPreview(false);
    const r = await confirmWaShare({
      text: LONG_TEXT,
      url: "https://maps.app.goo.gl/ContohTautanLokasiYangSangatPanjangSekaliUntukUjiPembungkusanTeks12345",
      files: withPhotos
        ? [
            makeFile("foto-penyiapan-gula-pasir-karung-50kg-premium.png"),
            makeFile("foto-penyiapan-beras-ramos-super-25kg.png"),
            makeFile("foto-minyak-goreng-curah-drum-200-liter.png"),
          ]
        : [],
      expectedCount: withPhotos ? 4 : 0,
      peer: { name: "Muhammad Abdurrahman Wijayakusuma", phone: "6281234567890" },
    });
    setResult(r.ok ? "kirim" : "batal");
  };

  /**
   * Mode "progresif": dialog dibuka dengan foto belum lengkap sehingga muncul
   * blok peringatan + tombol "Ambil ulang". Saat ditekan, tombol masuk state
   * loading (disabled) beberapa detik, lalu foto ditambahkan bertahap —
   * meniru konten yang berubah saat dialog terbuka. Dipakai oleh
   * `tests/e2e/wa-preview-focus-loading.spec.ts` untuk memastikan focus trap
   * tidak lepas saat loading & konten bertambah.
   */
  const openProgressive = async () => {
    setWaSkipPreview(false);
    let round = 0;
    const r = await confirmWaShare({
      text: LONG_TEXT,
      files: [makeFile("foto-awal-1.png")],
      expectedCount: 4,
      retryMissing: async () => {
        round += 1;
        // Jeda: state loading dirender (tombol retry disabled + spinner).
        await new Promise((res) => setTimeout(res, 900));
        return round === 1
          ? [makeFile("foto-susulan-2.png")]
          : [makeFile("foto-susulan-3.png"), makeFile("foto-susulan-4.png")];
      },
      peer: { name: "Muhammad Abdurrahman Wijayakusuma", phone: "6281234567890" },
    });
    setResult(r.ok ? "kirim" : "batal");
  };

  return (
    <div className="mx-auto flex max-w-md flex-col gap-ms-3 px-ms-4 py-ms-6">
      <h1 className="text-ms-lg font-semibold">Harness: Pratinjau WA (rotasi)</h1>
      <Button data-testid="btn-open-preview" variant="outline" onClick={() => void open(true)}>
        Buka pratinjau (teks + foto)
      </Button>
      <Button data-testid="btn-open-preview-text" variant="outline" onClick={() => void open(false)}>
        Buka pratinjau (teks saja)
      </Button>
      <Button
        data-testid="btn-open-preview-progressive"
        variant="outline"
        onClick={() => void openProgressive()}
      >
        Buka pratinjau (foto menyusul / loading)
      </Button>
      <div data-testid="preview-result" className="text-ms-xs text-muted-foreground">
        {result}
      </div>
    </div>
  );
}