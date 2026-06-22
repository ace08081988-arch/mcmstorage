/**
 * Build a plain-text diagnostics summary that renders consistently across
 * clipboard apps, terminals, and chat composers — on every browser & OS.
 *
 * Design rules (test-enforced):
 *  - ASCII only. No box-drawing (═ ─ │), no emoji-variant glyphs (✓ ✗ ⚠).
 *    These render inconsistently on Windows Notepad, some Android clipboards,
 *    and proportional fonts.
 *  - Line width ≤ 56 chars so the text stays readable on narrow mobile
 *    clipboard previews without wrapping mid-line.
 *  - Uses "key: value" pairs (proportional-font friendly) instead of
 *    column-aligned tables, which only line up in monospace fonts.
 *  - Line endings are "\n" (LF). Clipboard APIs normalize for the target OS.
 *  - No leading/trailing whitespace per line, no tabs.
 */

export type SummaryPackage = { name: string; version: string };
export type SummaryCheck = { label: string; ok: boolean; detail: string };

export type SummaryInput = {
  appName?: string;
  timestamp: Date;
  packages: SummaryPackage[];
  checks: SummaryCheck[];
};

export const SUMMARY_MAX_WIDTH = 56;

function rule(char: string): string {
  return char.repeat(SUMMARY_MAX_WIDTH);
}

function fmtTimestamp(d: Date): string {
  // YYYY-MM-DD HH:MM (UTC) — stable, locale-independent.
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

export function buildDiagnosticsSummary(input: SummaryInput): string {
  const appName = input.appName ?? "Aplikasi";
  const okCount = input.checks.filter((c) => c.ok).length;
  const allOk = okCount === input.checks.length;

  const lines: string[] = [];
  lines.push(rule("="));
  lines.push(`DIAGNOSTIK ${appName.toUpperCase()}`);
  lines.push(`Waktu: ${fmtTimestamp(input.timestamp)}`);
  lines.push(rule("="));
  lines.push("");
  lines.push(`Status   : ${allOk ? "KOMPATIBEL" : "ADA KETIDAKCOCOKAN"}`);
  lines.push(`Ringkas  : ${okCount}/${input.checks.length} cek lolos`);
  lines.push("");
  lines.push("VERSI PAKET");
  lines.push(rule("-"));
  for (const p of input.packages) {
    lines.push(`- ${p.name}@${p.version}`);
  }
  lines.push("");
  lines.push("HASIL CEK");
  lines.push(rule("-"));
  input.checks.forEach((c, i) => {
    const mark = c.ok ? "[OK]  " : "[FAIL]";
    lines.push(`${i + 1}. ${mark} ${c.label}`);
    // Wrap detail to width, indenting continuation lines by 4 spaces.
    for (const wrapped of wrapText(c.detail, SUMMARY_MAX_WIDTH - 4)) {
      lines.push(`    ${wrapped}`);
    }
  });
  lines.push("");
  lines.push(rule("="));

  return lines.join("\n");
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    if (!line) { line = w; continue; }
    if (line.length + 1 + w.length <= width) line += " " + w;
    else { out.push(line); line = w; }
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}