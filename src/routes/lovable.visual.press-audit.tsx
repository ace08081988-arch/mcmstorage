/**
 * Harness publik (no-auth) untuk memverifikasi bahwa dev-mode auditor
 * `press-audit` mencetak `console.warn` dengan **selector yang benar**
 * pada komponen interaktif yang belum diberi `data-no-press`.
 *
 * URL: /lovable/visual/press-audit
 *
 * Semua bagian dibungkus root `data-press-scope="on"` supaya rule 1
 * (Radix animated surface) ikut menyala. Empat offender berikut
 * SENGAJA tidak memakai `data-no-press`, masing-masing memicu satu
 * rule audit:
 *
 *   1. `radix-animated-surface`  → `[data-testid="offender-radix"]`
 *   2. `motion-whiletap-wraps-button` → `[data-testid="offender-motion-btn"]`
 *   3. `sortable-handle`         → `[data-testid="offender-sortable"]`
 *   4. `destructive-menuitem`    → `[data-testid="offender-destructive"]`
 *
 * Dua kontrol positif (dengan `data-no-press`) memastikan auditor tidak
 * mem-false-positive.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/lovable/visual/press-audit")({
  head: () => ({
    meta: [
      { title: "Harness · press-audit warnings" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PressAuditHarness,
});

function PressAuditHarness() {
  return (
    <main
      data-press-scope="on"
      className="min-h-[100dvh] space-y-6 bg-background p-6 text-foreground"
    >
      <h1 className="text-lg font-semibold">Press-audit warnings harness</h1>
      <p className="text-xs text-muted-foreground">
        Empat offender di bawah ini sengaja tanpa <code>data-no-press</code>.
      </p>

      {/* Rule 1 — Radix-like animated surface di dalam scope. */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">radix-animated-surface</h2>
        <div
          data-testid="offender-radix"
          role="dialog"
          data-state="open"
          className="rounded border p-3 text-sm"
        >
          Radix content look-alike (inline, tanpa portal) tanpa data-no-press.
        </div>
      </section>

      {/* Rule 2 — motion.* dengan whileTap membungkus <button>. */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">motion-whiletap-wraps-button</h2>
        <div data-whiletap="1">
          <button
            data-testid="offender-motion-btn"
            className="rounded bg-primary px-3 py-2 text-primary-foreground"
          >
            Tombol di dalam whileTap
          </button>
        </div>
      </section>

      {/* Rule 3 — sortable handle. */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">sortable-handle</h2>
        <button
          data-testid="offender-sortable"
          aria-roledescription="sortable"
          aria-label="Drag handle"
          className="rounded border px-3 py-2"
        >
          ⋮⋮ Handle
        </button>
      </section>

      {/* Rule 4 — destructive menuitem. */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">destructive-menuitem</h2>
        <div
          data-testid="offender-destructive"
          role="menuitem"
          className="text-destructive cursor-pointer rounded px-3 py-2"
        >
          Hapus item
        </div>
      </section>

      {/* Kontrol positif — tidak boleh masuk warnings. */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Kontrol positif (opt-out benar)</h2>
        <button
          data-testid="control-ok-sortable"
          data-no-press
          aria-roledescription="sortable"
          className="rounded border px-3 py-2"
        >
          Handle aman
        </button>
        <div data-whiletap="1">
          <button
            data-testid="control-ok-motion-btn"
            data-no-press
            className="rounded bg-primary px-3 py-2 text-primary-foreground"
          >
            Tombol whileTap aman
          </button>
        </div>
      </section>
    </main>
  );
}