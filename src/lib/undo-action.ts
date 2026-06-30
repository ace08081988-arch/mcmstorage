/**
 * Execute a destructive action immediately. The previous implementation showed
 * a "Batalkan" undo banner; per product decision the banner is removed and the
 * commit runs synchronously. The API shape is preserved so call sites do not
 * need to change.
 */
export function scheduleUndo(opts: {
  label?: string;
  description?: string;
  delayMs?: number;
  onCommit: () => void | Promise<void>;
  onCancel?: () => void;
}) {
  void opts.label;
  void opts.description;
  void opts.delayMs;
  void opts.onCancel;
  try {
    void opts.onCommit();
  } catch {
    // commit errors are surfaced by call sites' own error handlers
  }
  return () => {};
}