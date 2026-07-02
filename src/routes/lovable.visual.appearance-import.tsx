/**
 * Harness publik (no-auth, no-network) untuk menguji migrator
 * `mcm.appearance-settings` end-to-end di browser.
 *
 * URL: /lovable/visual/appearance-import
 *
 * Alur:
 *   1. Test menempelkan payload JSON ke <textarea data-testid="ai-json">.
 *   2. Test menekan <button data-testid="ai-run">.
 *   3. Harness memanggil `migrateImportedAppearance` — sumber kebenaran
 *      yang sama dengan `/pengaturan-tampilan` — dan merender hasilnya
 *      ke DOM (status, fromVersion, forward, tiap field patch, plus
 *      area pratinjau yang menerapkan patch ke gaya inline).
 *
 * Karena harness memakai simbol yang sama persis dengan halaman asli,
 * lolos di sini = kontrak backward compat tetap utuh untuk UI produksi.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  migrateImportedAppearance,
  EXPORT_SCHEMA_VERSION,
  type MigrateResult,
  type ImportedPatch,
} from "@/lib/appearance-migrator";
import { CURRENT_DEFAULT } from "@/lib/appearance-migrator.fixtures";
import { logAppearanceMigration } from "@/lib/appearance-migrator.telemetry";

export const Route = createFileRoute("/lovable/visual/appearance-import")({
  head: () => ({
    meta: [
      { title: "Harness · Appearance migrator" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AppearanceImportHarness,
});

function AppearanceImportHarness() {
  const [json, setJson] = useState("");
  const [result, setResult] = useState<MigrateResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const run = () => {
    setParseError(null);
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "parse error");
      const invalid = { ok: false, reason: "invalid" as const };
      logAppearanceMigration("paste", invalid);
      setResult(invalid);
      return;
    }
    const res = migrateImportedAppearance(raw, CURRENT_DEFAULT);
    logAppearanceMigration("paste", res);
    setResult(res);
  };

  const patch: ImportedPatch | null = result && result.ok ? result.patch : null;

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Appearance import migrator</h1>
      <p className="text-sm text-muted-foreground">
        Skema aktif: v{EXPORT_SCHEMA_VERSION}. Tempelkan payload JSON dan
        tekan Run.
      </p>

      <textarea
        data-testid="ai-json"
        value={json}
        onChange={(e) => setJson(e.target.value)}
        rows={10}
        className="w-full rounded border p-2 font-mono text-xs"
        placeholder='{"__type":"mcm.appearance-settings",...}'
      />
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="ai-run"
          className="rounded bg-primary px-3 py-1.5 text-primary-foreground"
          onClick={run}
        >
          Run migrator
        </button>
        <button
          type="button"
          data-testid="ai-reset"
          className="rounded border px-3 py-1.5"
          onClick={() => {
            setJson("");
            setResult(null);
            setParseError(null);
          }}
        >
          Reset
        </button>
      </div>

      <section
        data-testid="ai-output"
        className="space-y-1 rounded border p-3 text-sm"
      >
        <div>
          <span>status: </span>
          <span data-testid="ai-status">
            {result == null
              ? "idle"
              : result.ok
                ? "ok"
                : result.reason}
          </span>
        </div>
        <div>
          <span>parseError: </span>
          <span data-testid="ai-parse-error">{parseError ?? ""}</span>
        </div>
        <div>
          <span>fromVersion: </span>
          <span data-testid="ai-from-version">
            {result && result.ok ? String(result.fromVersion) : ""}
          </span>
        </div>
        <div>
          <span>forward: </span>
          <span data-testid="ai-forward">
            {result && result.ok ? String(result.forward) : ""}
          </span>
        </div>

        {patch && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-2">
            <PatchRow label="theme" value={patch.theme} />
            <PatchRow label="font" value={patch.font} />
            <PatchRow label="size" value={patch.size} />
            <PatchRow label="accent" value={patch.accent} />
            <PatchRow label="radius" value={patch.radius} />
            <PatchRow label="bgImage" value={patch.bgImage} />
            <PatchRow label="bgOverlay" value={patch.bgOverlay} />
            <PatchRow label="bgBlur" value={patch.bgBlur} />
            <PatchRow label="compact" value={patch.compact} />
            <PatchRow label="fontScale" value={patch.fontScale} />
            <PatchRow label="highContrast" value={patch.highContrast} />
            <PatchRow label="reduceMotion" value={patch.reduceMotion} />
          </div>
        )}

        <pre
          data-testid="ai-patch-json"
          className="mt-2 overflow-auto rounded bg-muted p-2 text-xs"
        >
          {patch ? JSON.stringify(patch, null, 2) : ""}
        </pre>
      </section>

      {/* Pratinjau: membuktikan patch benar-benar diterapkan ke UI. */}
      <section
        data-testid="ai-preview"
        className="rounded border p-4"
        style={
          patch
            ? {
                borderRadius: `${patch.radius}rem`,
                fontSize: `${patch.fontScale}rem`,
                filter: patch.highContrast ? "contrast(1.4)" : undefined,
                transitionProperty: patch.reduceMotion ? "none" : undefined,
              }
            : undefined
        }
      >
        <div data-testid="ai-preview-theme">{patch?.theme ?? "—"}</div>
        <div data-testid="ai-preview-accent">{patch?.accent ?? "—"}</div>
      </section>
    </main>
  );
}

function PatchRow({
  label,
  value,
}: {
  label: keyof ImportedPatch;
  value: string | number | boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span data-testid={`ai-patch-${label}`} className="font-mono text-xs">
        {String(value)}
      </span>
    </div>
  );
}