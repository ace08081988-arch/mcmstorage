/**
 * Dev-mode auditor untuk `data-no-press`.
 *
 * Memindai DOM secara berkala (idle + MutationObserver) dan menandai
 * komponen interaktif yang berpotensi bentrok dengan reaksi press
 * (skala + shading) namun **belum** memiliki atribut `data-no-press`.
 *
 * Aturan deteksi (heuristik konservatif — hanya WARN, tidak mengubah DOM):
 *
 * 1. Radix Overlay / Content / Portal item dengan `data-state="open|closed"`
 *    yang berada dalam subtree ber-`data-press-scope="on"` (jarang, tapi
 *    memungkinkan kalau scope dipasang di root).
 * 2. Framer Motion element (`[data-framer-motion] / style[transform]`)
 *    yang punya `whileTap` (dideteksi via marker `data-whiletap="1"`) dan
 *    membungkus `<button>` tanpa `data-no-press`.
 * 3. dnd-kit sortable handle: elemen dengan atribut `aria-roledescription`
 *    berisi "sortable" / "draggable", atau `data-dnd-handle`, tanpa
 *    `data-no-press`.
 * 4. Radix `role="menuitem"` bertanda destruktif (class/label mengandung
 *    "destructive" / "text-destructive") tanpa `data-no-press`.
 *
 * Hanya jalan saat `import.meta.env.DEV` dan `window` tersedia. Peringatan
 * di-dedupe berdasarkan tanda tangan elemen sehingga console tidak banjir.
 */

type Finding = {
  el: Element;
  rule: string;
  suggestion: string;
};

const seen = new WeakSet<Element>();
const dedupe = new Set<string>();

function sig(el: Element, rule: string): string {
  const tag = el.tagName.toLowerCase();
  const id = (el as HTMLElement).id || "";
  const cls = (el.getAttribute("class") || "").slice(0, 60);
  return `${rule}::${tag}#${id}.${cls}`;
}

function withinScope(el: Element): boolean {
  return !!el.closest('[data-press-scope="on"]');
}

function hasOptOut(el: Element): boolean {
  return el.hasAttribute("data-no-press") ||
    !!el.closest('[data-press-scope="off"]');
}

function scan(root: ParentNode): Finding[] {
  const out: Finding[] = [];

  // Rule 1 — Radix overlay/content
  root
    .querySelectorAll<HTMLElement>(
      '[data-radix-popper-content-wrapper] > *, [role="dialog"][data-state], [role="alertdialog"][data-state], [data-radix-dialog-overlay], [data-radix-alert-dialog-overlay]',
    )
    .forEach((el) => {
      if (hasOptOut(el)) return;
      // Radix content sering di-portal ke <body>, di luar scope, jadi aman.
      // Hanya warn kalau memang berada dalam scope.
      if (!withinScope(el)) return;
      out.push({
        el,
        rule: "radix-animated-surface",
        suggestion:
          'Tambahkan `data-no-press` pada Radix Overlay/Content agar animasi masuk-keluar tidak bertumpuk dengan skala press.',
      });
    });

  // Rule 2 — motion.* dengan whileTap membungkus <button>
  root
    .querySelectorAll<HTMLElement>('[data-whiletap="1"]')
    .forEach((wrap) => {
      const btn = wrap.querySelector<HTMLElement>("button, [role='button']");
      if (!btn) return;
      if (hasOptOut(btn)) return;
      out.push({
        el: btn,
        rule: "motion-whiletap-wraps-button",
        suggestion:
          'Tombol berada di dalam `motion.*` dengan `whileTap` — tambahkan `data-no-press` di tombol supaya tidak ada dua transform bertumpuk.',
      });
    });

  // Rule 3 — dnd-kit / sortable handle
  root
    .querySelectorAll<HTMLElement>(
      '[data-dnd-handle], [aria-roledescription*="sortable" i], [aria-roledescription*="draggable" i]',
    )
    .forEach((el) => {
      if (hasOptOut(el)) return;
      out.push({
        el,
        rule: "sortable-handle",
        suggestion:
          'Sortable/drag handle bisa jitter saat di-drag — tambahkan `data-no-press` di elemen handle.',
      });
    });

  // Rule 4 — destructive menuitem
  root
    .querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]')
    .forEach((el) => {
      if (hasOptOut(el)) return;
      const cls = el.getAttribute("class") || "";
      const label = (el.textContent || "").toLowerCase();
      const destructive =
        /destructive|text-destructive|bg-destructive/i.test(cls) ||
        /\bhapus\b|\bdelete\b|\bkeluar\b|\blogout\b/i.test(label);
      if (!destructive) return;
      out.push({
        el,
        rule: "destructive-menuitem",
        suggestion:
          'Menu item destruktif sebaiknya `data-no-press` supaya highlight `data-highlighted` Radix tidak tabrakan dengan skala.',
      });
    });

  return out;
}

function report(findings: Finding[]) {
  if (!findings.length) return;
  const fresh = findings.filter((f) => {
    if (seen.has(f.el)) return false;
    const s = sig(f.el, f.rule);
    if (dedupe.has(s)) return false;
    dedupe.add(s);
    seen.add(f.el);
    return true;
  });
  if (!fresh.length) return;
  // Kelompokkan per rule agar mudah dibaca.
  const byRule = new Map<string, Finding[]>();
  for (const f of fresh) {
    const arr = byRule.get(f.rule) || [];
    arr.push(f);
    byRule.set(f.rule, arr);
  }
  // eslint-disable-next-line no-console
  console.groupCollapsed(
    `%c[press-audit]%c ${fresh.length} komponen berpotensi bentrok tanpa \`data-no-press\``,
    "color:#f59e0b;font-weight:600",
    "color:inherit",
  );
  for (const [rule, list] of byRule) {
    // eslint-disable-next-line no-console
    console.groupCollapsed(`${rule} (${list.length})`);
    for (const { el, suggestion } of list) {
      // eslint-disable-next-line no-console
      console.warn(suggestion, el);
    }
    // eslint-disable-next-line no-console
    console.groupEnd();
  }
  // eslint-disable-next-line no-console
  console.info(
    "Dokumentasi: docs/press-scope.md — bagian Checklist implementasi per komponen.",
  );
  // eslint-disable-next-line no-console
  console.groupEnd();
}

let started = false;

export function installPressAudit(): () => void {
  if (typeof window === "undefined") return () => {};
  if (started) return () => {};
  started = true;

  const run = () => {
    try {
      report(scan(document.body));
    } catch {
      /* ignore audit errors */
    }
  };

  // Idle-time sweep pertama.
  const idle = (window as any).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 500));
  idle(run);

  // Re-scan pada perubahan besar (route change → banyak node baru).
  let scheduled = 0 as any;
  const mo = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = setTimeout(() => {
      scheduled = 0;
      run();
    }, 800);
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // API manual untuk audit ad-hoc dari console.
  (window as any).__pressAudit = () => {
    dedupe.clear();
    // WeakSet tak bisa di-clear; buat sweep dianggap fresh dgn signature baru.
    run();
  };

  return () => {
    mo.disconnect();
    started = false;
  };
}