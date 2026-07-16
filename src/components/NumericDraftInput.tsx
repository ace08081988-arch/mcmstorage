import { useEffect, useState } from "react";

/**
 * Input angka yang MENGIZINKAN kondisi kosong sementara saat user sedang
 * mengetik / menghapus. Value parent tetap `number`, tapi tampilan input
 * dikendalikan oleh draft string lokal. Nilai baru hanya di-commit ke
 * parent bila hasil parse angka valid & di dalam [min,max]. Saat blur,
 * kalau draft kosong/invalid, kita fallback ke `value` sekarang (bukan
 * memaksa ke `min`) — jadi user tidak "terjebak" pada nilai default.
 *
 * Bug asal: `value={p.jumlah ?? b.min}` + `Math.max(b.min, Number(e.target.value)||0)`
 * membuat backspace/clear langsung nge-snap ke `min` (mis. 0,01) sehingga
 * angka bawaan tidak bisa dihapus/diedit dari nol.
 *
 * Komponen ini adalah SSOT untuk semua input angka form data bisnis
 * (harga, jumlah, stok, berat, hutang/piutang, pengaturan numerik).
 * Jangan fork ulang di route/komponen lain — import dari sini.
 */
export function NumericDraftInput({
  value,
  min,
  max,
  step,
  onCommit,
  onFocus,
  onBlur,
  className,
  placeholder,
  ariaLabel,
  inputMode = "decimal",
  emptyCommitsTo,
  disabled,
  id,
  name,
  autoFocus,
  onKeyDown,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (n: number) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  inputMode?: "decimal" | "numeric";
  /** Kalau di-set, blur dengan draft kosong akan commit angka ini alih-alih fallback ke `value`. */
  emptyCommitsTo?: number;
  disabled?: boolean;
  id?: string;
  name?: string;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const [raw, setRaw] = useState<string>(() =>
    Number.isFinite(value) ? String(value) : "",
  );
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (focused) return;
    const asNum = Number(raw);
    if (raw !== "" && Number.isFinite(asNum) && asNum === value) return;
    setRaw(Number.isFinite(value) ? String(value) : "");
  }, [value, focused, raw]);
  return (
    <input
      id={id}
      name={name}
      type="text"
      inputMode={inputMode}
      value={raw}
      disabled={disabled}
      autoFocus={autoFocus}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onKeyDown={onKeyDown}
      onChange={(e) => {
        const next = e.target.value;
        setRaw(next);
        if (next.trim() === "") return;
        const normalized = next.replace(",", ".");
        const n = Number(normalized);
        if (!Number.isFinite(n)) return;
        if (n < min || n > max) return;
        onCommit(n);
      }}
      onBlur={() => {
        setFocused(false);
        const trimmed = raw.trim();
        if (trimmed === "") {
          if (typeof emptyCommitsTo === "number") {
            const c = Math.min(max, Math.max(min, emptyCommitsTo));
            onCommit(c);
            setRaw(String(c));
          } else {
            setRaw(Number.isFinite(value) ? String(value) : "");
          }
          onBlur?.();
          return;
        }
        const normalized = trimmed.replace(",", ".");
        const n = Number(normalized);
        if (!Number.isFinite(n)) {
          setRaw(String(value));
          onBlur?.();
          return;
        }
        const clamped = Math.min(max, Math.max(min, n));
        onCommit(clamped);
        setRaw(String(clamped));
        onBlur?.();
      }}
      step={step}
      className={className}
      placeholder={placeholder}
      aria-label={ariaLabel}
    />
  );
}