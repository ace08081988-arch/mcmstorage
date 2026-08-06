import type { Page, TestInfo } from "@playwright/test";

/**
 * Diagnostik UI untuk spec E2E.
 *
 * Tujuan: ketika tombol "Simpan" tidak bekerja, kegagalan test harus
 * langsung memberi tahu APA yang terjadi di layar — toast apa yang muncul,
 * dialog mana yang terbuka/tertutup, error console, dan request gagal —
 * tanpa harus re-run manual.
 *
 * Yang direkam:
 *   - toast (sonner / [data-sonner-toast], [role="status"], [role="alert"])
 *   - dialog / alertdialog (buka & tutup, beserta judulnya)
 *   - console error/warning
 *   - pageerror (exception tak tertangkap)
 *   - response HTTP >= 400
 *
 * Semua event dilampirkan ke laporan Playwright sebagai
 * `ui-diagnostics.log` + `ui-diagnostics.json`, dan pada kegagalan juga
 * screenshot `ui-final-state.png`.
 */

export type UiEvent = { t: number; kind: string; detail: string };

const OBSERVER_SCRIPT = `(() => {
  if (window.__uiDiagInstalled) return;
  window.__uiDiagInstalled = true;

  const TOAST_SEL = '[data-sonner-toast],[role="status"],[role="alert"],.toaster [data-toast]';
  const DIALOG_SEL = '[role="dialog"],[role="alertdialog"]';
  const seen = new WeakSet();

  const text = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 300);

  const report = (kind, detail) => {
    try { window.__uiDiagPush && window.__uiDiagPush({ kind, detail }); } catch {}
  };

  const scan = (root) => {
    if (!(root instanceof Element)) return;
    const check = (el) => {
      if (seen.has(el)) return;
      seen.add(el);
      if (el.matches(TOAST_SEL)) report('toast', text(el));
      else if (el.matches(DIALOG_SEL)) {
        const title = el.querySelector('[data-slot="dialog-title"],h1,h2,h3');
        report('dialog:open', (title ? text(title) : text(el)).slice(0, 160));
      }
    };
    check(root);
    root.querySelectorAll(TOAST_SEL + ',' + DIALOG_SEL).forEach(check);
  };

  const obs = new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => scan(n));
      r.removedNodes.forEach((n) => {
        if (n instanceof Element && n.matches && n.matches(DIALOG_SEL)) {
          report('dialog:close', text(n).slice(0, 120));
        }
      });
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  scan(document.body || document.documentElement);
})();`;

/**
 * Pasang perekam. Panggil SEBELUM `page.goto()` pertama.
 * Kembalikan fungsi `flush()` untuk dipanggil di akhir test (mis. afterEach).
 */
export async function attachUiDiagnostics(
  page: Page,
  testInfo: TestInfo,
): Promise<() => Promise<void>> {
  const started = Date.now();
  const events: UiEvent[] = [];
  const push = (kind: string, detail: string) => {
    events.push({ t: Date.now() - started, kind, detail });
  };

  await page.exposeBinding(
    "__uiDiagPush",
    (_src, payload: { kind: string; detail: string }) => {
      push(payload?.kind ?? "unknown", payload?.detail ?? "");
    },
  );
  await page.addInitScript(OBSERVER_SCRIPT);

  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "error" || type === "warning") {
      push(`console:${type}`, msg.text().slice(0, 300));
    }
  });
  page.on("pageerror", (err) => push("pageerror", String(err?.message ?? err).slice(0, 300)));
  page.on("response", (res) => {
    if (res.status() >= 400) push("http", `${res.status()} ${res.request().method()} ${res.url()}`);
  });
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) push("navigate", f.url());
  });

  return async function flush() {
    const lines = events.map(
      (e) => `[+${String(e.t).padStart(6, " ")}ms] ${e.kind.padEnd(16)} ${e.detail}`,
    );
    const body = lines.length ? lines.join("\n") : "(tidak ada event UI terekam)";
    await testInfo.attach("ui-diagnostics.log", { body, contentType: "text/plain" });
    await testInfo.attach("ui-diagnostics.json", {
      body: JSON.stringify(events, null, 2),
      contentType: "application/json",
    });

    if (testInfo.status !== testInfo.expectedStatus) {
      // Ringkasan toast/dialog langsung ke stdout supaya terlihat di reporter list.
      const highlights = events.filter((e) => e.kind.startsWith("toast") || e.kind.startsWith("dialog"));
      console.log(
        `\n── UI diagnostics (${testInfo.title}) ──\n` +
          (highlights.length
            ? highlights.map((e) => `  [+${e.t}ms] ${e.kind}: ${e.detail}`).join("\n")
            : "  (tidak ada toast/dialog terekam)") +
          "\n" +
          (lines.length ? `  …${lines.length} event total, lihat ui-diagnostics.log\n` : ""),
      );
      try {
        await testInfo.attach("ui-final-state.png", {
          body: await page.screenshot(),
          contentType: "image/png",
        });
      } catch {
        /* halaman mungkin sudah tertutup */
      }
    }
  };
}
