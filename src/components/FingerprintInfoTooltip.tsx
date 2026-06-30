import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { SendPayloadSummary } from "@/lib/idempotency";

/**
 * Tooltip kecil yang menjelaskan apa itu "sidik jari payload" dan komponen
 * apa saja yang membentuk hash itu, plus perbandingan hex hash sebelumnya
 * vs sekarang. Membantu operator memahami mengapa tombol "Kirim ulang
 * (paksa)" aktif/nonaktif tanpa membuka log atau diff penuh.
 *
 * Komponen yang membentuk fingerprint (lihat share-wa.ts / share-chat.ts):
 *   - channel ("wa" | "chat")
 *   - destination (nomor / judul chat)
 *   - caption (teks pesan, persis seperti akan dikirim)
 *   - photoCount (jumlah foto yang berhasil disiapkan)
 *   - locationUrl (link Maps, atau null)
 * Field-field tersebut di-stableStringify (kunci tersortir) lalu di-hash
 * FNV-1a 32-bit menjadi 8 karakter hex.
 */
export function FingerprintInfoTooltip({
  matches,
  previousFp,
  currentFp,
  previous,
  current,
}: {
  matches: boolean;
  previousFp?: string;
  currentFp?: string;
  previous?: SendPayloadSummary;
  current?: SendPayloadSummary;
}) {
  const fmt = (s?: string) => (s && s.length ? s : "—");
  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Penjelasan sidik jari payload"
            className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-current/70 hover:text-current focus:outline-none focus-visible:ring-1 focus-visible:ring-current"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px] space-y-1.5 text-[11px] leading-relaxed">
          <div className="font-semibold">
            Sidik jari payload {matches ? "cocok" : "tidak cocok"}
          </div>
          <p className="opacity-90">
            Hash FNV-1a 32-bit dari ringkasan payload, dipakai untuk memastikan
            "Kirim ulang (paksa)" hanya mengirim konten yang persis sama
            dengan kiriman sebelumnya pada idempotency key yang sama.
          </p>
          <div className="grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5">
            <span className="opacity-70">Sebelumnya</span>
            <span className="font-mono">{fmt(previousFp)}</span>
            <span className="opacity-70">Sekarang</span>
            <span className="font-mono">{fmt(currentFp)}</span>
          </div>
          <div className="border-t border-current/15 pt-1.5">
            <div className="mb-0.5 font-medium opacity-90">Komponen fingerprint</div>
            <ul className="space-y-0.5 opacity-90">
              <li>• Channel: <span className="font-mono">{fmt(current?.channel ?? previous?.channel)}</span></li>
              <li>• Tujuan: <span className="font-mono">{fmt(current?.destination ?? previous?.destination)}</span></li>
              <li>• Caption: {current?.caption?.length ?? previous?.caption?.length ?? 0} karakter</li>
              <li>• Foto: {current?.photoCount ?? previous?.photoCount ?? 0}</li>
              <li>• Link lokasi: {(current?.locationUrl ?? previous?.locationUrl) ? "ada" : "tidak ada"}</li>
            </ul>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}