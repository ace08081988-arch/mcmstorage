import { useState, useEffect, useMemo } from "react";
import { parseWeightToGrams, formatGramsSmart } from "@/lib/weight-parse";

type Props = {
  /** Nilai kanonik dalam gram (string agar sinkron dengan form controlled). */
  value: string;
  /** Panggilan balik saat nilai gram valid berubah. Terima string kosong bila user hapus. */
  onChange: (nextGramsString: string) => void;
  /** Base unit item; jika bukan "g", komponen jatuh kembali ke input angka biasa. */
  baseUnit: "g" | "pcs";
  placeholder?: string;
  className?: string;
  required?: boolean;
  min?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Tampilkan preview "= 1,5 kg" di bawah field. */
  showHint?: boolean;
  ariaLabel?: string;
};

/**
 * Input kuantitas yang menerima teks bebas seperti "1 kg", "500 gr", "2 ons", "500 mg".
 * Nilai dikonversi ke gram (base unit) saat blur atau saat pola dikenali penuh.
 * Jika baseUnit === "pcs", komponen berperilaku seperti input number biasa.
 */
export function SmartWeightInput({
  value,
  onChange,
  baseUnit,
  placeholder,
  className,
  required,
  min,
  disabled,
  autoFocus,
  showHint = true,
  ariaLabel,
}: Props) {
  const [raw, setRaw] = useState<string>(value ?? "");

  // Sinkron ulang saat parent mereset value (mis. setelah submit).
  useEffect(() => {
    if ((value ?? "") !== raw) {
      // Kalau raw sedang mengandung satuan (ada huruf), jangan overwrite in-flight ketik.
      if (/[a-zA-Z]/.test(raw)) return;
      setRaw(value ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  if (baseUnit !== "g") {
    // Fallback plain number untuk pcs — perilaku sama seperti input number.
    return (
      <input
        type="number"
        step="0.01"
        min={min ?? 0}
        className={className}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
      />
    );
  }

  const parsed = useMemo(() => parseWeightToGrams(raw), [raw]);
  const hasUnit = /[a-zA-Z]/.test(raw);
  const showPreview =
    showHint && parsed != null && parsed > 0 && (hasUnit || parsed >= 1000 || parsed < 1);

  return (
    <div>
      <input
        type="text"
        inputMode="decimal"
        className={className}
        value={raw}
        onChange={(e) => {
          const next = e.target.value;
          setRaw(next);
          // Kalau tanpa satuan (angka murni) langsung teruskan sebagai gram.
          if (!/[a-zA-Z]/.test(next)) {
            onChange(next);
          } else {
            // Ada satuan → jika bisa diparse, teruskan hasil gramnya; jika belum, jangan
            // overwrite state parent (biarkan user selesai mengetik).
            const g = parseWeightToGrams(next);
            if (g != null) onChange(String(g));
          }
        }}
        onBlur={() => {
          // Saat blur, kanonisasi tampilan ke gram numerik.
          const g = parseWeightToGrams(raw);
          if (g != null) {
            setRaw(String(g));
            onChange(String(g));
          }
        }}
        placeholder={placeholder ?? "cth: 1 kg, 500 gr, 2 ons, 250 mg"}
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
      />
      {showPreview && (
        <div className="mt-0.5 text-[10px] text-muted-foreground">
          = {formatGramsSmart(parsed!)}
        </div>
      )}
    </div>
  );
}