import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  scanPressAuditFindings,
  tracePressAuditDecision,
  formatPressAuditTrace,
  pickWinnerStep,
  type PressAuditTrace,
  type PressAuditTraceStep,
} from "@/lib/press-audit";

export const Route = createFileRoute(
  "/_authenticated/dev/press-audit-demo",
)({
  head: () => ({
    meta: [
      { title: "Demo Press-Audit — Verifikasi Contoh HTML" },
      {
        name: "description",
        content:
          "Halaman demo interaktif yang memverifikasi contoh HTML press-audit secara otomatis dengan toggle data-press-audit / -skip / -allow / -deny.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PressAuditDemoPage,
});

/**
 * Attribute yang bisa di-toggle per contoh.
 * Nilai `null` = atribut tidak dipasang di DOM.
 */
type AttrState = {
  "data-press-audit": "on" | "off" | null;
  "data-press-audit-skip": string | null;
  "data-press-audit-allow": string | null;
  "data-press-audit-deny": string | null;
};

type Example = {
  id: string;
  title: string;
  hint: string;
  /** Kode rule yang seharusnya di-flag JIKA tidak ada opt-out. */
  triggeredCodes: string[];
  /** Preset atribut untuk memverifikasi kombinasi prioritas. */
  presets: Array<{
    label: string;
    attrs: Partial<AttrState>;
    /** Kode yang diharapkan tetap muncul setelah preset dipasang. */
    expected: string[];
  }>;
  /** JSX contoh — harus terbungkus `data-press-scope="on"`. */
  renderInner: () => ReactElement;
};

const EXAMPLES: Example[] = [
  {
    id: "destructive-menuitem",
    title: "PA004 · Destructive menu item",
    hint: 'Menu item destruktif tanpa data-no-press → PA004.',
    triggeredCodes: ["PA004"],
    presets: [
      { label: "Tanpa atribut", attrs: {}, expected: ["PA004"] },
      {
        label: 'audit="off" (mematikan semua)',
        attrs: { "data-press-audit": "off" },
        expected: [],
      },
      {
        label: 'skip="PA004"',
        attrs: { "data-press-audit-skip": "PA004" },
        expected: [],
      },
      {
        label: 'allow="PA001" (whitelist ≠ PA004)',
        attrs: { "data-press-audit-allow": "PA001" },
        expected: [],
      },
      {
        label: 'allow="PA004" + deny="PA004" (deny menang)',
        attrs: {
          "data-press-audit-allow": "PA004",
          "data-press-audit-deny": "PA004",
        },
        expected: [],
      },
      {
        label: 'audit="on" + skip="PA004" (skip tetap menang)',
        attrs: {
          "data-press-audit": "on",
          "data-press-audit-skip": "PA004",
        },
        expected: [],
      },
    ],
    renderInner: () => (
      <div role="menu">
        <div
          role="menuitem"
          className="text-destructive px-3 py-2 rounded border"
        >
          Hapus akun
        </div>
      </div>
    ),
  },
  {
    id: "sortable-handle",
    title: "PA003 · Sortable handle",
    hint: "Handle drag tanpa data-no-press → PA003.",
    triggeredCodes: ["PA003"],
    presets: [
      { label: "Tanpa atribut", attrs: {}, expected: ["PA003"] },
      {
        label: 'skip="PA003,PA004"',
        attrs: { "data-press-audit-skip": "PA003,PA004" },
        expected: [],
      },
      {
        label: 'allow="PA003" (whitelist match)',
        attrs: { "data-press-audit-allow": "PA003" },
        expected: ["PA003"],
      },
    ],
    renderInner: () => (
      <div
        data-dnd-handle
        aria-roledescription="sortable item"
        className="px-3 py-2 rounded border cursor-grab"
      >
        ⋮⋮ Baris draggable
      </div>
    ),
  },
];

function serializeAttrs(a: Partial<AttrState>): Record<string, string> {
  const out: Record<string, string> = {};
  if (a["data-press-audit"]) out["data-press-audit"] = a["data-press-audit"]!;
  if (a["data-press-audit-skip"])
    out["data-press-audit-skip"] = a["data-press-audit-skip"]!;
  if (a["data-press-audit-allow"])
    out["data-press-audit-allow"] = a["data-press-audit-allow"]!;
  if (a["data-press-audit-deny"])
    out["data-press-audit-deny"] = a["data-press-audit-deny"]!;
  return out;
}

type VerifyResult = {
  preset: string;
  expected: string[];
  actual: string[];
  pass: boolean;
};

/** Warna sorotan berdasarkan sifat langkah pemenang. */
function winnerColor(step: PressAuditTraceStep): string {
  if (step.outcome === "block") return "hsl(0 84% 60%)"; // merah
  return "hsl(142 71% 45%)"; // hijau
}

/**
 * Serialize trace untuk ekspor JSON. `hostEl` dibuang (non-serializable);
 * tag pemenang tetap disertakan agar bisa dibaca ulang.
 */
function serializeTracesForExport(
  exampleId: string,
  presetLabel: string,
  presetAttrs: Record<string, string>,
  triggeredCodes: string[],
  traces: PressAuditTrace[],
) {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    example: exampleId,
    preset: { label: presetLabel, attrs: presetAttrs },
    triggeredCodes,
    traces: traces.map((t) => {
      const winner = pickWinnerStep(t);
      return {
        code: t.code,
        rule: t.rule,
        allowed: t.allowed,
        winner: winner
          ? {
              step: winner.step,
              name: winner.name,
              outcome: winner.outcome,
              reason: winner.reason,
              hostTag: winner.hostTag ?? null,
              tokens: winner.tokens ?? [],
            }
          : null,
        steps: t.steps.map((s) => ({
          step: s.step,
          name: s.name,
          outcome: s.outcome,
          reason: s.reason,
          hostTag: s.hostTag ?? null,
          tokens: s.tokens ?? [],
        })),
      };
    }),
  };
}

/**
 * Hitung diff antara hasil efektif yang diharapkan (dari preset) vs
 * hasil aktual (dari `traces`). "Effective" = kode yang tetap dilaporkan.
 */
type DiffRow = {
  code: string;
  expectedKept: boolean;
  actualKept: boolean;
  match: boolean;
  winnerName?: string;
  winnerHost?: string;
};

function computeDiff(
  triggered: string[],
  expectedKept: string[],
  traces: PressAuditTrace[],
): DiffRow[] {
  const expSet = new Set(expectedKept);
  const byCode = new Map(traces.map((t) => [t.code, t] as const));
  return triggered.map((code) => {
    const t = byCode.get(code);
    const actualKept = !!t?.allowed;
    const expected = expSet.has(code);
    const winner = t ? pickWinnerStep(t) : null;
    return {
      code,
      expectedKept: expected,
      actualKept,
      match: expected === actualKept,
      winnerName: winner?.name,
      winnerHost: winner?.hostTag,
    };
  });
}

function ExampleCard({
  example,
  onResults,
}: {
  example: Example;
  onResults?: (res: VerifyResult[] | null) => void;
}) {
  const [presetIdx, setPresetIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [results, setResults] = useState<VerifyResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [traces, setTraces] = useState<PressAuditTrace[] | null>(null);
  const [highlightsOn, setHighlightsOn] = useState(true);
  const activePreset = example.presets[presetIdx];
  const diffRows = useMemo(
    () =>
      traces
        ? computeDiff(example.triggeredCodes, activePreset.expected, traces)
        : null,
    [traces, example.triggeredCodes, activePreset.expected],
  );
  const diffAllMatch = useMemo(
    () => (diffRows ? diffRows.every((r) => r.match) : true),
    [diffRows],
  );
  const highlightedRef = useRef<
    Array<{ el: Element; prevTitle: string | null }>
  >([]);

  const clearHighlights = useCallback(() => {
    for (const { el, prevTitle } of highlightedRef.current) {
      (el as HTMLElement).style.removeProperty("outline");
      (el as HTMLElement).style.removeProperty("outline-offset");
      (el as HTMLElement).style.removeProperty("box-shadow");
      (el as HTMLElement).style.removeProperty("cursor");
      el.removeAttribute("data-pa-winner");
      el.removeAttribute("data-pa-tooltip");
      if (prevTitle === null) el.removeAttribute("title");
      else el.setAttribute("title", prevTitle);
    }
    highlightedRef.current = [];
  }, []);

  useEffect(() => () => clearHighlights(), [clearHighlights]);

  const attrs = serializeAttrs(example.presets[presetIdx].attrs);

  const verifyAll = useCallback(async () => {
    setRunning(true);
    const collected: VerifyResult[] = [];
    for (const preset of example.presets) {
      const el = wrapRef.current;
      if (!el) break;
      // Reset dulu semua atribut audit di wrapper.
      for (const key of [
        "data-press-audit",
        "data-press-audit-skip",
        "data-press-audit-allow",
        "data-press-audit-deny",
      ]) {
        el.removeAttribute(key);
      }
      // Terapkan preset.
      for (const [k, v] of Object.entries(serializeAttrs(preset.attrs))) {
        el.setAttribute(k, v);
      }
      // Beri browser satu frame untuk commit atribut sebelum scan.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const findings = scanPressAuditFindings(el);
      const actual = Array.from(new Set(findings.map((f) => f.code))).sort();
      const expected = [...preset.expected].sort();
      const pass =
        actual.length === expected.length &&
        actual.every((c, i) => c === expected[i]);
      collected.push({ preset: preset.label, expected, actual, pass });
    }
    // Kembalikan ke preset aktif.
    const el = wrapRef.current;
    if (el) {
      for (const key of [
        "data-press-audit",
        "data-press-audit-skip",
        "data-press-audit-allow",
        "data-press-audit-deny",
      ]) {
        el.removeAttribute(key);
      }
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    }
    setResults(collected);
    onResults?.(collected);
    setRunning(false);
  }, [attrs, example.presets, onResults]);

  const allPass = useMemo(
    () => results && results.every((r) => r.pass),
    [results],
  );

  const applyHighlights = useCallback((out: PressAuditTrace[]) => {
    clearHighlights();
    // Sorot elemen ancestor "pemenang" untuk tiap jejak +
    // pasang tooltip yang menjelaskan alasan efektif.
    const applied: Array<{ el: Element; prevTitle: string | null }> = [];
    // Kelompokkan pemenang per elemen sehingga elemen yang sama
    // (mis. wrapper) menampilkan alasan gabungan untuk semua kode.
    const byEl = new Map<
      Element,
      Array<{ trace: PressAuditTrace; step: PressAuditTraceStep }>
    >();
    for (const t of out) {
      const step = pickWinnerStep(t);
      if (!step?.hostEl) continue;
      const list = byEl.get(step.hostEl) ?? [];
      list.push({ trace: t, step });
      byEl.set(step.hostEl, list);
    }
    for (const [winnerEl, entries] of byEl.entries()) {
      // Warna: block > allow (jika campur, tetap merah karena block final).
      const primaryStep =
        entries.find((e) => e.step.outcome === "block")?.step ??
        entries[entries.length - 1].step;
      const color = winnerColor(primaryStep);
      (winnerEl as HTMLElement).style.outline = `2px dashed ${color}`;
      (winnerEl as HTMLElement).style.outlineOffset = "3px";
      (winnerEl as HTMLElement).style.boxShadow = `0 0 0 4px ${color}22`;
      (winnerEl as HTMLElement).style.cursor = "help";
      const tag = (winnerEl.tagName || "").toLowerCase();
      const auditAttrs = [
        "data-press-audit",
        "data-press-audit-skip",
        "data-press-audit-allow",
        "data-press-audit-deny",
        "data-no-press",
        "data-press-scope",
      ]
        .filter((k) => winnerEl.hasAttribute(k))
        .map((k) => `${k}="${winnerEl.getAttribute(k)}"`)
        .join(" ");
      const header = `<${tag}>${auditAttrs ? " " + auditAttrs : ""}`;
      const lines = entries.map(({ trace, step }) => {
        const verdict = trace.allowed ? "ALLOW" : "BLOCK";
        return `• ${trace.code} (${trace.rule}) — ${verdict} via ${step.name}: ${step.reason}`;
      });
      const tooltip = [header, ...lines].join("\n");
      const prevTitle = winnerEl.getAttribute("title");
      winnerEl.setAttribute("title", tooltip);
      winnerEl.setAttribute("data-pa-tooltip", "1");
      // data-pa-winner: gabung semua kode:step:verdict untuk elemen ini.
      winnerEl.setAttribute(
        "data-pa-winner",
        entries
          .map(
            ({ trace, step }) =>
              `${trace.code}:${step.name}:${trace.allowed ? "allow" : "block"}`,
          )
          .join("|"),
      );
      applied.push({ el: winnerEl, prevTitle });
    }
    highlightedRef.current = applied;
  }, [clearHighlights]);

  const showTrace = useCallback(() => {
    const host = wrapRef.current;
    if (!host) return;
    clearHighlights();
    const out: PressAuditTrace[] = [];
    for (const code of example.triggeredCodes) {
      const findings = scanPressAuditFindings(host);
      const match = findings.find((f) => f.code === code);
      const el =
        match?.el ??
        host.querySelector(
          code === "PA003"
            ? "[data-dnd-handle]"
            : code === "PA004"
              ? '[role="menuitem"]'
              : "*",
        ) ??
        host;
      const rule =
        code === "PA003"
          ? "sortable-handle"
          : code === "PA004"
            ? "destructive-menuitem"
            : code;
      out.push(tracePressAuditDecision(el, rule));
    }
    setTraces(out);
    if (highlightsOn) applyHighlights(out);
  }, [example.triggeredCodes, clearHighlights, highlightsOn, applyHighlights]);

  const toggleHighlights = useCallback(() => {
    setHighlightsOn((prev) => {
      const next = !prev;
      if (next) {
        if (traces) applyHighlights(traces);
      } else {
        clearHighlights();
      }
      return next;
    });
  }, [traces, applyHighlights, clearHighlights]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{example.title}</CardTitle>
        <p className="text-xs text-muted-foreground">{example.hint}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {example.presets.map((p, i) => (
            <Button
              key={p.label}
              size="sm"
              variant={i === presetIdx ? "default" : "outline"}
              onClick={() => {
                setPresetIdx(i);
                setResults(null);
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>

        <div
          ref={wrapRef}
          data-press-scope="on"
          data-testid={`pa-demo-${example.id}`}
          {...attrs}
          className="rounded border border-dashed p-3 bg-muted/30"
        >
          {example.renderInner()}
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={verifyAll} disabled={running}>
            {running ? "Menjalankan…" : "Verifikasi semua preset"}
          </Button>
          <Button size="sm" variant="outline" onClick={showTrace}>
            Tampilkan jejak keputusan
          </Button>
          {traces && (
            <Button
              size="sm"
              variant={highlightsOn ? "secondary" : "outline"}
              data-testid={`pa-demo-${example.id}-toggle-highlight`}
              aria-pressed={highlightsOn}
              onClick={toggleHighlights}
            >
              Sorotan ancestor: {highlightsOn ? "ON" : "OFF"}
            </Button>
          )}
          {traces && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                clearHighlights();
                setTraces(null);
              }}
            >
              Bersihkan sorotan
            </Button>
          )}
          {traces && traces.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              data-testid={`pa-demo-${example.id}-export`}
              onClick={() => {
                const payload = serializeTracesForExport(
                  example.id,
                  activePreset.label,
                  attrs,
                  example.triggeredCodes,
                  traces,
                );
                const blob = new Blob(
                  [JSON.stringify(payload, null, 2)],
                  { type: "application/json" },
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                const ts = new Date()
                  .toISOString()
                  .replace(/[:.]/g, "-");
                a.href = url;
                a.download = `press-audit-trace-${example.id}-${ts}.json`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              Ekspor JSON
            </Button>
          )}
          {results && (
            <Badge variant={allPass ? "default" : "destructive"}>
              {allPass
                ? `Lulus ${results.length}/${results.length}`
                : `Gagal ${
                    results.filter((r) => !r.pass).length
                  }/${results.length}`}
            </Badge>
          )}
        </div>

        {results && (
          <ul className="text-xs space-y-1" data-testid={`pa-demo-${example.id}-results`}>
            {results.map((r) => (
              <li
                key={r.preset}
                className={r.pass ? "text-emerald-600" : "text-destructive"}
                data-pass={r.pass ? "1" : "0"}
              >
                {r.pass ? "✓" : "✗"} <b>{r.preset}</b> — expected [
                {r.expected.join(",") || "∅"}] · actual [
                {r.actual.join(",") || "∅"}]
              </li>
            ))}
          </ul>
        )}

        {traces && (
          <div
            className="text-xs space-y-2 rounded border bg-background/60 p-2"
            data-testid={`pa-demo-${example.id}-trace`}
          >
            <div className="text-[10px] text-muted-foreground">
              Elemen ancestor pemenang disorot langsung di preview di atas
              (garis putus-putus). Warna:{" "}
              <span className="text-destructive">merah</span> = block
              (deny/skip/off/allowlist-miss),{" "}
              <span className="text-emerald-600">hijau</span> = allow
              (on/allow-match/scope.allow).
            </div>
            {traces.map((t) => (
              <div key={t.code}>
                <div className="font-medium">
                  {t.code} · {t.rule} —{" "}
                  <span
                    className={
                      t.allowed ? "text-emerald-600" : "text-destructive"
                    }
                  >
                    {t.allowed ? "ALLOWED" : "BLOCKED"}
                  </span>
                  {(() => {
                    const s = pickWinnerStep(t);
                    return s?.hostTag ? (
                      <span className="ml-2 text-[10px] text-muted-foreground font-mono">
                        winner: {s.name} @{s.hostTag}
                      </span>
                    ) : null;
                  })()}
                </div>
                <ul className="pl-4 list-disc">
                  {formatPressAuditTrace(t).map((line, i) => (
                    <li key={i} className="font-mono">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {diffRows && (
          <div
            className="text-xs rounded border bg-background/60 p-2"
            data-testid={`pa-demo-${example.id}-diff`}
            data-diff-match={diffAllMatch ? "1" : "0"}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="font-medium">Diff efektif</span>
              <Badge variant={diffAllMatch ? "default" : "destructive"}>
                {diffAllMatch ? "cocok" : "beda"}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                preset: <b>{activePreset.label}</b>
              </span>
            </div>
            <table className="w-full font-mono text-[11px]">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="pr-2">Kode</th>
                  <th className="pr-2">Expected</th>
                  <th className="pr-2">Actual</th>
                  <th className="pr-2">Winner</th>
                  <th>Δ</th>
                </tr>
              </thead>
              <tbody>
                {diffRows.map((r) => (
                  <tr
                    key={r.code}
                    data-code={r.code}
                    data-match={r.match ? "1" : "0"}
                    className={r.match ? "" : "bg-destructive/10"}
                  >
                    <td className="pr-2">{r.code}</td>
                    <td
                      className={
                        "pr-2 " +
                        (r.expectedKept
                          ? "text-emerald-600"
                          : "text-destructive")
                      }
                    >
                      {r.expectedKept ? "kept" : "blocked"}
                    </td>
                    <td
                      className={
                        "pr-2 " +
                        (r.actualKept
                          ? "text-emerald-600"
                          : "text-destructive")
                      }
                    >
                      {r.actualKept ? "kept" : "blocked"}
                    </td>
                    <td className="pr-2 text-muted-foreground">
                      {r.winnerName
                        ? `${r.winnerName}${r.winnerHost ? " @" + r.winnerHost : ""}`
                        : "—"}
                    </td>
                    <td>
                      {r.match ? (
                        <span className="text-emerald-600">=</span>
                      ) : (
                        <span className="text-destructive">
                          {r.expectedKept ? "kept→blocked" : "blocked→kept"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PressAuditDemoPage() {
  const [runAll, setRunAll] = useState(0);
  useEffect(() => {
    // Bantu E2E: expose helper global untuk trigger verifikasi seluruh halaman.
    (window as any).__pressAuditDemoVerify = async () => {
      const buttons = document.querySelectorAll<HTMLButtonElement>(
        'button:not([disabled])',
      );
      buttons.forEach((b) => {
        if (b.textContent?.startsWith("Verifikasi semua preset")) b.click();
      });
    };
    return () => {
      delete (window as any).__pressAuditDemoVerify;
    };
  }, []);

  return (
    <div className="p-4 space-y-4 max-w-3xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Demo Press-Audit</h1>
        <p className="text-sm text-muted-foreground">
          Verifikasi otomatis contoh HTML di{" "}
          <code>docs/press-scope.md</code>. Setiap kartu memasang
          kombinasi <code>data-press-audit</code> / <code>-skip</code> /{" "}
          <code>-allow</code> / <code>-deny</code> lalu memanggil{" "}
          <code>scanPressAuditFindings()</code> untuk membandingkan
          finding aktual vs yang diharapkan.
        </p>
      </div>
      <div
        className="rounded border bg-muted/30 p-3 text-xs"
        data-testid="pa-demo-legend"
        aria-label="Legend warna dan gaya sorotan ancestor pemenang"
      >
        <div className="font-medium mb-2">Legend sorotan</div>
        <ul className="grid gap-2 sm:grid-cols-3">
          <li className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-4 w-8 rounded"
              style={{
                outline: "2px dashed hsl(142 71% 45%)",
                outlineOffset: "2px",
                boxShadow: "0 0 0 4px hsl(142 71% 45% / 0.13)",
              }}
            />
            <span>
              <b className="text-emerald-600">Hijau</b> — allow (on / allow-match / scope.allow)
            </span>
          </li>
          <li className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-4 w-8 rounded"
              style={{
                outline: "2px dashed hsl(0 84% 60%)",
                outlineOffset: "2px",
                boxShadow: "0 0 0 4px hsl(0 84% 60% / 0.13)",
              }}
            />
            <span>
              <b className="text-destructive">Merah</b> — block / deny / skip / off / allowlist-miss
            </span>
          </li>
          <li className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-4 w-8 rounded border-2 border-dashed border-muted-foreground/70"
            />
            <span>
              <b>Dashed</b> — ancestor <i>pemenang</i> pada trace (hover untuk alasan)
            </span>
          </li>
        </ul>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setRunAll((n) => n + 1);
            (window as any).__pressAuditDemoVerify?.();
          }}
        >
          Verifikasi semua kartu
        </Button>
      </div>
      <div className="grid gap-4" key={runAll}>
        {EXAMPLES.map((ex) => (
          <ExampleCard key={ex.id} example={ex} />
        ))}
      </div>
    </div>
  );
}