import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

/**
 * Reporter kustom untuk mengelompokkan hasil spec E2E APK menjadi dua
 * grup di akhir run:
 *   1. terminalGuard-only  — spec APK yang hanya memakai
 *      `stub.terminalGuard()`.
 *   2. full guards         — spec yang juga memasang
 *      `installServerFnPassthroughGuard`.
 *
 * Klasifikasi ditentukan secara statis dari isi file spec (regex atas
 * import `installServerFnPassthroughGuard`), jadi tetap akurat walau
 * dijalankan dalam satu invocation Playwright bersama grup lain
 * (mis. `run-apk-e2e.mjs --mode=both`).
 *
 * Aktivasi: tambahkan di `playwright.config.ts`
 *   reporter: [["./tests/e2e/_helpers/apk-grouped-reporter.ts"], ...]
 * atau via CLI `--reporter=./tests/e2e/_helpers/apk-grouped-reporter.ts`.
 * Reporter ini aditif — reporter lain (list/html) tetap jalan.
 *
 * Env opsional:
 *   APK_GROUPED_REPORTER_QUIET=1 → sembunyikan output bila tidak ada
 *     spec APK yang dijalankan (mis. run non-APK).
 */

type Group = "terminal" | "full" | "other";

type Row = {
  file: string;
  title: string;
  status: TestResult["status"];
  durationMs: number;
  project: string;
};

const GROUP_LABEL: Record<Exclude<Group, "other">, string> = {
  terminal: "terminalGuard-only",
  full: "full guards (terminal + passthrough)",
};

function statusIcon(s: TestResult["status"]): string {
  switch (s) {
    case "passed":
      return "✓";
    case "failed":
    case "timedOut":
      return "✗";
    case "skipped":
      return "○";
    case "interrupted":
      return "!";
    default:
      return "·";
  }
}

export default class ApkGroupedReporter implements Reporter {
  private rows: Row[] = [];
  private classifyCache = new Map<string, Group>();
  private rootDir = process.cwd();

  onBegin(config: FullConfig, _suite: Suite): void {
    this.rootDir = config.rootDir ?? process.cwd();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const file = test.location?.file ?? "";
    if (!file) return;
    const base = path.basename(file);
    if (!base.startsWith("apk-")) return;
    const group = this.classify(file);
    if (group === "other") return;
    this.rows.push({
      file: base,
      title: test.titlePath().slice(1).join(" › ") || test.title,
      status: result.status,
      durationMs: result.duration,
      project: (test.parent as Suite & { project?: () => { name: string } })
        .project?.()?.name ?? "",
    });
  }

  async onEnd(_result: FullResult): Promise<void> {
    if (this.rows.length === 0) {
      if (process.env.APK_GROUPED_REPORTER_QUIET !== "1") {
        // Tetap cetak header ringan supaya runner batch tahu reporter aktif.
        process.stdout.write(
          "\n── APK grouped reporter: 0 spec APK ter-eksekusi ──\n",
        );
      }
      return;
    }

    const groups: Record<Exclude<Group, "other">, Row[]> = {
      terminal: [],
      full: [],
    };
    for (const r of this.rows) {
      const g = this.classifyCached(path.join(this.rootDir, "tests/e2e", r.file));
      if (g !== "other") groups[g].push(r);
    }

    const out: string[] = [];
    out.push("");
    out.push("══ Ringkasan grup spec E2E APK ══");
    for (const key of ["terminal", "full"] as const) {
      const rows = groups[key];
      const total = rows.length;
      const passed = rows.filter((r) => r.status === "passed").length;
      const failed = rows.filter(
        (r) => r.status === "failed" || r.status === "timedOut",
      ).length;
      const skipped = rows.filter((r) => r.status === "skipped").length;
      out.push("");
      out.push(
        `▸ ${GROUP_LABEL[key]}  —  ${total} test  ` +
          `(✓ ${passed} · ✗ ${failed} · ○ ${skipped})`,
      );
      if (total === 0) {
        out.push("    (tidak ada spec dalam grup ini)");
        continue;
      }
      // Kelompokkan per file supaya baris rapi.
      const byFile = new Map<string, Row[]>();
      for (const r of rows) {
        const list = byFile.get(r.file) ?? [];
        list.push(r);
        byFile.set(r.file, list);
      }
      for (const [file, list] of [...byFile.entries()].sort()) {
        const proj = list[0]?.project ?? "";
        out.push(`    • ${file}${proj ? `  [${proj}]` : ""}`);
        for (const r of list) {
          out.push(
            `        ${statusIcon(r.status)} ${r.title}  ` +
              `(${Math.round(r.durationMs)}ms)`,
          );
        }
      }
    }
    out.push("");
    process.stdout.write(out.join("\n"));
  }

  private classifyCached(absPath: string): Group {
    const cached = this.classifyCache.get(absPath);
    if (cached) return cached;
    const g = this.classify(absPath);
    this.classifyCache.set(absPath, g);
    return g;
  }

  private classify(absPath: string): Group {
    const cached = this.classifyCache.get(absPath);
    if (cached) return cached;
    let src = "";
    try {
      // Sync read via require-like fallback; reporter berjalan di Node
      // jadi kita gunakan fs.readFileSync via dynamic import.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      src = require("node:fs").readFileSync(absPath, "utf8") as string;
    } catch {
      this.classifyCache.set(absPath, "other");
      return "other";
    }
    const base = path.basename(absPath);
    if (!base.startsWith("apk-")) {
      this.classifyCache.set(absPath, "other");
      return "other";
    }
    const g: Group = /\binstallServerFnPassthroughGuard\s*\(/.test(src)
      ? "full"
      : "terminal";
    this.classifyCache.set(absPath, g);
    return g;
  }

  // Jaga-jaga untuk build tooling yang tree-shake `fs/promises`.
  private static _fsPromises = fs;
}