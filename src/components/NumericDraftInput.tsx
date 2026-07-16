import { useEffect, useRef, useState } from "react";
import { formatDecimalID, formatIntegerID } from "@/lib/formatNumberID";

/**
 * Input angka SSOT: menampilkan & menerima format id-ID
 * (titik ribuan + koma desimal) secara live saat user mengetik.
 *
 * Value parent tetap `number` murni (tanpa separator). Draft string
 * lokal boleh kosong sementara sehingga angka bawaan bisa dihapus tanpa
 * "nge-snap" ke min. Commit hanya kalau parse valid & di dalam [min,max].
 *
 * Format live dilakukan tiap keystroke dengan preservasi caret berbasis
 * jumlah karakter signifikan (digit + koma) sebelum caret.
 *
 * Decimal mode ditentukan otomatis dari `step`: step ≥ 1 & bulat → integer.
 * Boleh di-override lewat prop `decimal` & `maxDecimals`.
 */

type FormatState = {
  formatted: string;
  num: number | null;
  /** posisi caret ideal setelah re-format (dalam string formatted) */
  caret: number;
};

function reformat(
  input: string,
  caret: number,
  decimal: boolean,
  maxDecimals: number,
): FormatState {
  // Hitung significant chars sebelum caret (digit + separator desimal)
  let sigBefore = 0;
  for (let i = 0; i < Math.min(caret, input.length); i++) {
    const ch = input[i]!;
    if ((ch >= "0" && ch <= "9") || ch === "," || ch === ".") sigBefore++;
  }
  // Ekstraksi digit + max 1 pemisah desimal (koma/titik, koma jadi kanonik)
  let intD = "";
  let decD = "";
  let sawSep = false;
  for (const ch of input) {
    if (ch >= "0" && ch <= "9") {
      if (sawSep) {
        if (decD.length < maxDecimals) decD += ch;
      } else intD += ch;
    } else if (decimal && !sawSep && (ch === "," || ch === ".")) {
      sawSep = true;
    }
  }
  // Strip leading zeros pada integer (biarkan "0" tunggal)
  const intClean = intD.replace(/^0+(?=\d)/, "");
  const intForFmt = intClean === "" ? (sawSep ? "0" : "") : intClean;
  const grouped =
    intForFmt === "" ? "" : formatIntegerID(Number(intForFmt));
  const formatted = sawSep ? grouped + "," + decD : grouped;
  // Hitung caret baru: cari indeks setelah karakter signifikan ke-sigBefore
  let newCaret = formatted.length;
  let seen = 0;
  if (sigBefore <= 0) {
    newCaret = 0;
  } else {
    for (let i = 0; i < formatted.length; i++) {
      const ch = formatted[i]!;
      if ((ch >= "0" && ch <= "9") || ch === ",") {
        seen++;
        if (seen >= sigBefore) {
          newCaret = i + 1;
          break;
        }
      }
    }
  }
  // Parse jadi number
  let num: number | null = null;
  if (formatted !== "") {
    const numStr = (intForFmt || "0") + (sawSep ? "." + (decD || "0") : "");
    const parsed = Number(numStr);
    num = Number.isFinite(parsed) ? parsed : null;
  }
  return { formatted, num, caret: newCaret };
}

function displayFromValue(
  value: number,
  decimal: boolean,
  maxDecimals: number,
): string {
  if (!Number.isFinite(value)) return "";
  if (!decimal) return formatIntegerID(value);
  return formatDecimalID(value, maxDecimals, true);
}

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
  inputMode,
  emptyCommitsTo,
  disabled,
  id,
  name,
  autoFocus,
  onKeyDown,
  decimal: decimalProp,
  maxDecimals: maxDecimalsProp,
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
  emptyCommitsTo?: number;
  disabled?: boolean;
  id?: string;
  name?: string;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Override auto-detect: true = boleh desimal (koma), false = integer only. */
  decimal?: boolean;
  /** Max digit desimal (default: dari step, atau 2). */
  maxDecimals?: number;
}) {
  const decimal =
    decimalProp ?? !(Number.isInteger(step) && step >= 1);
  const maxDecimals = maxDecimalsProp ?? (() => {
    if (!decimal) return 0;
    const s = String(step);
    const dot = s.indexOf(".");
    if (dot < 0) return 2;
    return Math.min(6, s.length - dot - 1) || 2;
  })();
  const resolvedInputMode = inputMode ?? (decimal ? "decimal" : "numeric");

  const inputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const [raw, setRaw] = useState<string>(() =>
    displayFromValue(value, decimal, maxDecimals),
  );
  const [focused, setFocused] = useState(false);
  const pendingCaret = useRef<number | null>(null);

  // Sinkron dari parent value hanya saat tidak fokus (hindari menimpa ketikan).
  useEffect(() => {
    if (focused) return;
    setRaw(displayFromValue(value, decimal, maxDecimals));
  }, [value, focused, decimal, maxDecimals]);

  // Restore caret setelah render kalau ada pendingCaret.
  useEffect(() => {
    if (pendingCaret.current !== null && inputRef.current && focused) {
      const pos = pendingCaret.current;
      pendingCaret.current = null;
      const el = inputRef.current;
      // requestAnimationFrame supaya browser sudah men-commit nilai baru.
      requestAnimationFrame(() => {
        try {
          el.setSelectionRange(pos, pos);
        } catch {
          /* ignore */
        }
      });
    }
  });

  return (
    <input
      ref={inputRef}
      id={id}
      name={name}
      type="text"
      inputMode={resolvedInputMode}
      autoComplete="off"
      value={raw}
      disabled={disabled}
      autoFocus={autoFocus}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onKeyDown={onKeyDown}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={(e) => {
        composingRef.current = false;
        // Trigger reformat manual dengan nilai final IME
        const target = e.currentTarget;
        const caret = target.selectionStart ?? target.value.length;
        const state = reformat(target.value, caret, decimal, maxDecimals);
        setRaw(state.formatted);
        pendingCaret.current = state.caret;
        if (state.num !== null && state.num >= min && state.num <= max) {
          onCommit(state.num);
        }
      }}
      onChange={(e) => {
        const next = e.target.value;
        const caret = e.target.selectionStart ?? next.length;
        if (composingRef.current) {
          setRaw(next);
          return;
        }
        const state = reformat(next, caret, decimal, maxDecimals);
        setRaw(state.formatted);
        pendingCaret.current = state.caret;
        if (state.formatted === "") return;
        if (state.num === null) return;
        if (state.num < min || state.num > max) return;
        onCommit(state.num);
      }}
      onBlur={() => {
        setFocused(false);
        const trimmed = raw.trim();
        if (trimmed === "") {
          if (typeof emptyCommitsTo === "number") {
            const c = Math.min(max, Math.max(min, emptyCommitsTo));
            onCommit(c);
            setRaw(displayFromValue(c, decimal, maxDecimals));
          } else {
            setRaw(displayFromValue(value, decimal, maxDecimals));
          }
          onBlur?.();
          return;
        }
        const state = reformat(trimmed, trimmed.length, decimal, maxDecimals);
        if (state.num === null) {
          setRaw(displayFromValue(value, decimal, maxDecimals));
          onBlur?.();
          return;
        }
        const clamped = Math.min(max, Math.max(min, state.num));
        onCommit(clamped);
        setRaw(displayFromValue(clamped, decimal, maxDecimals));
        onBlur?.();
      }}
      step={step}
      className={className}
      placeholder={placeholder}
      aria-label={ariaLabel}
    />
  );
}

/**
 * Varian string-native untuk form yang menyimpan state sebagai string mentah
 * (mis. `useState("")` yang diedit lewat `e.target.value`). Menampilkan
 * format id-ID live sama seperti NumericDraftInput, tetapi:
 * - `value` masuk & keluar berupa string kanonik ("1500.5" atau "" saat kosong),
 *   supaya kode existing yang lakukan `Number(value)` / kirim ke DB tidak berubah.
 * - Tidak melakukan clamp — parent bertanggung jawab atas min/max saat submit.
 *
 * Pakai ini untuk swap mekanis field `<input type="text" inputMode="..."
 * value={x} onChange={e => setX(e.target.value)}>`.
 */
export function NumericTextField({
  value,
  onValueChange,
  step,
  decimal: decimalProp,
  maxDecimals: maxDecimalsProp,
  inputMode,
  className,
  placeholder,
  ariaLabel,
  disabled,
  id,
  name,
  required,
  autoFocus,
  onFocus,
  onBlur,
  onKeyDown,
}: {
  value: string;
  onValueChange: (canonical: string) => void;
  step?: number | string;
  decimal?: boolean;
  maxDecimals?: number;
  inputMode?: "decimal" | "numeric";
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  required?: boolean;
  autoFocus?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const effectiveStep: number =
    typeof step === "string" ? Number(step) || 0.01 : step ?? 0.01;
  const decimal =
    decimalProp ?? !(Number.isInteger(effectiveStep) && effectiveStep >= 1);
  const maxDecimals = maxDecimalsProp ?? (() => {
    if (!decimal) return 0;
    const s = String(effectiveStep);
    const dot = s.indexOf(".");
    if (dot < 0) return 2;
    return Math.min(6, s.length - dot - 1) || 2;
  })();
  const resolvedInputMode = inputMode ?? (decimal ? "decimal" : "numeric");

  const inputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const [focused, setFocused] = useState(false);
  const pendingCaret = useRef<number | null>(null);

  // Konversi value (string kanonik "1500.5") jadi formatted display id-ID.
  const displayFromCanonical = (v: string): string => {
    if (v === "" || v === null || v === undefined) return "";
    const n = Number(v);
    if (!Number.isFinite(n)) return "";
    if (!decimal) return formatIntegerID(n);
    return formatDecimalID(n, maxDecimals, true);
  };

  const [raw, setRaw] = useState<string>(() => displayFromCanonical(value));

  useEffect(() => {
    if (focused) return;
    setRaw(displayFromCanonical(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused, decimal, maxDecimals]);

  useEffect(() => {
    if (pendingCaret.current !== null && inputRef.current && focused) {
      const pos = pendingCaret.current;
      pendingCaret.current = null;
      const el = inputRef.current;
      requestAnimationFrame(() => {
        try {
          el.setSelectionRange(pos, pos);
        } catch {
          /* ignore */
        }
      });
    }
  });

  return (
    <input
      ref={inputRef}
      id={id}
      name={name}
      type="text"
      inputMode={resolvedInputMode}
      autoComplete="off"
      required={required}
      value={raw}
      disabled={disabled}
      autoFocus={autoFocus}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onKeyDown={onKeyDown}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={(e) => {
        composingRef.current = false;
        const target = e.currentTarget;
        const caret = target.selectionStart ?? target.value.length;
        const state = reformat(target.value, caret, decimal, maxDecimals);
        setRaw(state.formatted);
        pendingCaret.current = state.caret;
        onValueChange(
          state.formatted === "" || state.num === null ? "" : String(state.num),
        );
      }}
      onChange={(e) => {
        const next = e.target.value;
        const caret = e.target.selectionStart ?? next.length;
        if (composingRef.current) {
          setRaw(next);
          return;
        }
        const state = reformat(next, caret, decimal, maxDecimals);
        setRaw(state.formatted);
        pendingCaret.current = state.caret;
        onValueChange(
          state.formatted === "" || state.num === null ? "" : String(state.num),
        );
      }}
      onBlur={() => {
        setFocused(false);
        const trimmed = raw.trim();
        if (trimmed === "") {
          onValueChange("");
          setRaw("");
          onBlur?.();
          return;
        }
        const state = reformat(trimmed, trimmed.length, decimal, maxDecimals);
        if (state.num === null) {
          setRaw(displayFromCanonical(value));
          onBlur?.();
          return;
        }
        onValueChange(String(state.num));
        setRaw(displayFromCanonical(String(state.num)));
        onBlur?.();
      }}
      step={effectiveStep}
      className={className}
      placeholder={placeholder}
      aria-label={ariaLabel}
    />
  );
}