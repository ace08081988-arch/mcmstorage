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

/**
 * Ambil langkah "pemenang" pada jejak — langkah block bila ada,
 * jika tidak, langkah pass paling akhir yang menyimpan hostEl.
 */
function pickWinnerStep(t: PressAuditTrace): PressAuditTraceStep | null {
  const block = t.steps.find((s) => s.outcome === "block");
  if (block) return block;
  for (let i = t.steps.length - 1; i >= 0; i--) {
    if (t.steps[i].hostEl) return t.steps[i];
  }
  return null;
}

/** Warna sorotan berdasarkan sifat langkah pemenang. */
function winnerColor(step: PressAuditTraceStep): string {
  if (step.outcome === "block") return "hsl(0 84% 60%)"; // merah
  return "hsl(142 71% 45%)"; // hijau
}

function ExampleCard({ example }: { example: Example }) {
  const [presetIdx, setPresetIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [results, setResults] = useState<VerifyResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [traces, setTraces] = useState<PressAuditTrace[] | null>(null);
  const highlightedRef = useRef<Element[]>([]);

  const clearHighlights = useCallback(() => {
    for (const el of highlightedRef.current) {
      (el as HTMLElement).style.removeProperty("outline");
      (el as HTMLElement).style.removeProperty("outline-offset");
      (el as HTMLElement).style.removeProperty("box-shadow");
      el.removeAttribute("data-pa-winner");
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
    setRunning(false);
  }, [attrs, example.presets]);

  const allPass = useMemo(
    () => results && results.every((r) => r.pass),
    [results],
  );

  const showTrace = useCallback(() => {
    const host = wrapRef.current;
    if (!host) return;
    clearHighlights();
    const out: PressAuditTrace[] = [];
    for (const code of example.triggeredCodes) {
      // Cari elemen target di dalam host (finding di-scan; kalau tak ada,
      // pakai host itu sendiri sebagai konteks).
      const findings = scanPressAuditFindings(host);
      const match = findings.find((f) => f.code === code);
      // Untuk rule yang di-block, findings tak akan berisi kode itu — kita
      // masih bisa memanggil trace dengan elemen kandidat pertama di host.
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
    // Sorot elemen ancestor "pemenang" untuk tiap jejak.
    const applied: Element[] = [];
    for (const t of out) {
      const step = pickWinnerStep(t);
      const winnerEl = step?.hostEl;
      if (!winnerEl) continue;
      const color = winnerColor(step!);
      (winnerEl as HTMLElement).style.outline = `2px dashed ${color}`;
      (winnerEl as HTMLElement).style.outlineOffset = "3px";
      (winnerEl as HTMLElement).style.boxShadow = `0 0 0 4px ${color}22`;
      winnerEl.setAttribute(
        "data-pa-winner",
        `${t.code}:${step!.name}:${t.allowed ? "allow" : "block"}`,
      );
      applied.push(winnerEl);
    }
    highlightedRef.current = applied;
  }, [example.triggeredCodes, clearHighlights]);

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
              variant="ghost"
              onClick={() => {
                clearHighlights();
                setTraces(null);
              }}
            >
              Bersihkan sorotan
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