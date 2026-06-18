import { useCallback, useRef, useState } from "react";

type Props = {
  size?: number;
  onChange?: (seq: number[]) => void;
  onComplete?: (seq: number[]) => void;
  disabled?: boolean;
  resetKey?: number;
};

/**
 * 3x3 dot pattern pad. Captures sequence of dot indices (0..8).
 * Works with mouse + touch.
 */
export function PatternPad({ onChange, onComplete, disabled, resetKey }: Props) {
  const [seq, setSeq] = useState<number[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const drawing = useRef(false);
  const seqRef = useRef<number[]>([]);

  const reset = useCallback(() => {
    setSeq([]);
    seqRef.current = [];
  }, []);

  // Reset when parent bumps resetKey
  const lastReset = useRef(resetKey);
  if (lastReset.current !== resetKey) {
    lastReset.current = resetKey;
    if (seqRef.current.length) reset();
  }

  const pointFor = (clientX: number, clientY: number): number | null => {
    const el = containerRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    const cell = r.width / 3;
    const col = Math.floor(x / cell);
    const row = Math.floor(y / cell);
    if (col < 0 || col > 2 || row < 0 || row > 2) return null;
    // hit zone within ~50% of cell
    const cx = cell * col + cell / 2;
    const cy = cell * row + cell / 2;
    if (Math.hypot(x - cx, y - cy) > cell * 0.45) return null;
    return row * 3 + col;
  };

  const addPoint = (idx: number) => {
    if (seqRef.current.includes(idx)) return;
    const next = [...seqRef.current, idx];
    seqRef.current = next;
    setSeq(next);
    onChange?.(next);
  };

  const start = (x: number, y: number) => {
    if (disabled) return;
    drawing.current = true;
    seqRef.current = [];
    setSeq([]);
    const p = pointFor(x, y);
    if (p !== null) addPoint(p);
  };
  const move = (x: number, y: number) => {
    if (!drawing.current) return;
    const p = pointFor(x, y);
    if (p !== null) addPoint(p);
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (seqRef.current.length > 0) onComplete?.(seqRef.current);
  };

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div
        ref={containerRef}
        className="relative grid aspect-square w-64 grid-cols-3 grid-rows-3 touch-none rounded-xl border bg-card p-3"
        onMouseDown={(e) => start(e.clientX, e.clientY)}
        onMouseMove={(e) => move(e.clientX, e.clientY)}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={(e) => {
          const t = e.touches[0];
          if (t) start(t.clientX, t.clientY);
        }}
        onTouchMove={(e) => {
          const t = e.touches[0];
          if (t) move(t.clientX, t.clientY);
        }}
        onTouchEnd={end}
      >
        {Array.from({ length: 9 }).map((_, i) => {
          const active = seq.includes(i);
          const order = seq.indexOf(i);
          return (
            <div key={i} className="flex items-center justify-center">
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-full border-2 transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/30 bg-background"
                }`}
              >
                {active && (
                  <span className="text-[10px] font-semibold">{order + 1}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[11px] text-muted-foreground">
        {seq.length === 0
          ? "Geser jari untuk membuat pola"
          : `${seq.length} titik tersambung`}
      </div>
    </div>
  );
}

export function patternToString(seq: number[]): string {
  return seq.join("-");
}