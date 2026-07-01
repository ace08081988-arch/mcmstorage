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

/**
 * Konfigurasi runtime auditor.
 *
 * - `mode`:
 *   - `"off"`     — audit dimatikan sepenuhnya (tidak scan, tidak log).
 *   - `"log"`     — hanya `console.warn` (default, tanpa side-effect DOM).
 *   - `"suggest"` — selain log, tandai elemen dengan atribut
 *                   `data-press-audit-suggest="<code>"` supaya devtools /
 *                   overlay bisa memfilter visual. Tidak pernah mengubah
 *                   perilaku press — murni marker.
 * - `rules.allow` — bila diisi, HANYA rule dalam daftar yang dilaporkan.
 * - `rules.deny`  — rule dalam daftar diabaikan (dievaluasi setelah allow).
 * - `scope.allow` — CSS selectors; temuan HANYA dilaporkan bila elemen
 *                   berada di dalam salah satu selector (mis. `'main'`).
 * - `scope.deny`  — CSS selectors; temuan diabaikan bila cocok ancestor.
 *
 * Selain config global, tiap section boleh opt-out lokal:
 * - `data-press-audit="off"`        pada ancestor → skip seluruh rule.
 * - `data-press-audit-skip="a,b"`   pada ancestor → skip rule tertentu
 *   (comma-separated nama rule atau kode `PA00X`).
 */
export type PressAuditMode = "off" | "log" | "suggest";
export type PressAuditConfig = {
  mode: PressAuditMode;
  rules: { allow: string[]; deny: string[] };
  scope: { allow: string[]; deny: string[] };
};
export type PressAuditPersist = "memory" | "session";
export type PressAuditSetOptions = {
  /**
   * "memory" (default) — konfigurasi hidup selama halaman ini saja.
   *   Refresh/navigasi hard reload = kembali ke DEFAULT_CONFIG.
   * "session"          — bertahan selama tab masih dibuka (survive
   *   refresh dalam tab yang sama), otomatis hilang saat tab ditutup.
   *
   * Konfigurasi TIDAK PERNAH ditulis ke localStorage. Ini memastikan
   * flag debug tidak bocor lintas sesi / lintas perangkat.
   */
  persist?: PressAuditPersist;
  /**
   * Auto-reset setelah `ttlMs` (default 30 menit untuk mode debug).
   * Kirim `0`/`Infinity` untuk menonaktifkan TTL.
   */
  ttlMs?: number;
  /**
   * Auto-reset saat SPA navigation (`popstate`, `pushState`,
   * `replaceState`). Default `true` supaya penyisiran section
   * tertentu tidak nyangkut ke halaman berikutnya.
   */
  resetOnNavigate?: boolean;
};

const LEGACY_LS_KEY = "press-audit:config"; // dibersihkan on init
const SESSION_KEY = "press-audit:config";   // sessionStorage saja
const DEFAULT_TTL_MS = 30 * 60 * 1000;      // 30 menit
const DEFAULT_CONFIG: PressAuditConfig = {
  mode: "log",
  rules: { allow: [], deny: [] },
  scope: { allow: [], deny: [] },
};

let config: PressAuditConfig = DEFAULT_CONFIG;
let ttlTimer: ReturnType<typeof setTimeout> | 0 = 0;
let navUnbind: (() => void) | null = null;

function normalize(parsed: Partial<PressAuditConfig> | null | undefined): PressAuditConfig {
  if (!parsed) return DEFAULT_CONFIG;
  return {
    mode: parsed.mode ?? DEFAULT_CONFIG.mode,
    rules: {
      allow: parsed.rules?.allow ?? [],
      deny: parsed.rules?.deny ?? [],
    },
    scope: {
      allow: parsed.scope?.allow ?? [],
      deny: parsed.scope?.deny ?? [],
    },
  };
}

function loadConfig(): PressAuditConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  // Migrasi diam-diam: hapus jejak localStorage lama supaya flag debug
  // tidak lintas-sesi lagi.
  try {
    window.localStorage.removeItem(LEGACY_LS_KEY);
  } catch {
    /* ignore */
  }
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return normalize(JSON.parse(raw) as Partial<PressAuditConfig>);
  } catch {
    return DEFAULT_CONFIG;
  }
}

function clearTtl() {
  if (ttlTimer) {
    clearTimeout(ttlTimer as ReturnType<typeof setTimeout>);
    ttlTimer = 0;
  }
}

function unbindNav() {
  if (navUnbind) {
    navUnbind();
    navUnbind = null;
  }
}

function bindNavReset() {
  if (typeof window === "undefined" || navUnbind) return;
  const onNav = () => resetConfig();
  window.addEventListener("popstate", onNav);
  // Patch history untuk SPA (idempotent — tandai supaya tak dobel patch).
  const h = window.history as History & { __pressAuditPatched?: boolean };
  const origPush = h.pushState;
  const origReplace = h.replaceState;
  if (!h.__pressAuditPatched) {
    h.__pressAuditPatched = true;
    h.pushState = function (...args) {
      const r = origPush.apply(this, args as never);
      window.dispatchEvent(new Event("press-audit:navigate"));
      return r;
    };
    h.replaceState = function (...args) {
      const r = origReplace.apply(this, args as never);
      window.dispatchEvent(new Event("press-audit:navigate"));
      return r;
    };
  }
  window.addEventListener("press-audit:navigate", onNav);
  navUnbind = () => {
    window.removeEventListener("popstate", onNav);
    window.removeEventListener("press-audit:navigate", onNav);
  };
}

function persistConfig(next: PressAuditConfig, persist: PressAuditPersist) {
  if (typeof window === "undefined") return;
  try {
    if (persist === "session") {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
    } else {
      window.sessionStorage.removeItem(SESSION_KEY);
    }
  } catch {
    /* ignore */
  }
}

function resetConfig() {
  config = DEFAULT_CONFIG;
  clearTtl();
  unbindNav();
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }
  dedupe.clear();
  // schedule sweep dengan config bersih
  if (typeof window !== "undefined") {
    try { run(); } catch { /* run belum siap saat modul load — abaikan */ }
  }
}

function applyConfig(
  next: PressAuditConfig,
  opts: PressAuditSetOptions | undefined,
) {
  config = next;
  const persist = opts?.persist ?? "memory";
  persistConfig(next, persist);

  clearTtl();
  const ttl = opts?.ttlMs ?? DEFAULT_TTL_MS;
  if (ttl && Number.isFinite(ttl) && ttl > 0 && typeof window !== "undefined") {
    ttlTimer = setTimeout(() => resetConfig(), ttl);
  }

  const shouldBindNav = opts?.resetOnNavigate ?? true;
  if (shouldBindNav) bindNavReset();
  else unbindNav();
}

function ruleMatches(list: string[], rule: string, code: string): boolean {
  return list.some((k) => k === rule || k.toUpperCase() === code);
}

function scopeAllows(el: Element): boolean {
  // Section-level opt-out via atribut DOM
  const off = el.closest('[data-press-audit="off"]');
  if (off) return false;
  // Scope allow/deny berbasis selector konfigurasi
  if (config.scope.deny.length) {
    for (const sel of config.scope.deny) {
      try {
        if (el.closest(sel)) return false;
      } catch {
        /* selector invalid — abaikan */
      }
    }
  }
  if (config.scope.allow.length) {
    let ok = false;
    for (const sel of config.scope.allow) {
      try {
        if (el.closest(sel)) {
          ok = true;
          break;
        }
      } catch {
        /* ignore */
      }
    }
    if (!ok) return false;
  }
  return true;
}

function ruleAllows(el: Element, rule: string, code: string): boolean {
  // Global allow: bila diisi, hanya rule yang tercantum yang lolos
  if (
    config.rules.allow.length &&
    !ruleMatches(config.rules.allow, rule, code)
  ) {
    return false;
  }
  if (ruleMatches(config.rules.deny, rule, code)) return false;
  // Section-level skip pada ancestor
  const skipHost = el.closest("[data-press-audit-skip]");
  if (skipHost) {
    const list = (skipHost.getAttribute("data-press-audit-skip") || "")
      .split(/[\s,]+/)
      .filter(Boolean);
    if (list.some((k) => k === rule || k.toUpperCase() === code)) return false;
  }
  return true;
}

/**
 * Metadata terstruktur per rule. Format `PA###` sengaja stabil supaya
 * mudah di-grep dari log, di-filter di devtools ("PA002"), dan
 * dijadikan tautan langsung ke bagian dokumentasi terkait.
 */
type RuleMeta = { code: string; docs: string };

const DOCS_BASE = "docs/press-scope.md";
const RULE_META: Record<string, RuleMeta> = {
  "radix-animated-surface": {
    code: "PA001",
    docs: `${DOCS_BASE}#radix-dialog--dropdownmenu`,
  },
  "motion-whiletap-wraps-button": {
    code: "PA002",
    docs: `${DOCS_BASE}#shadcn-button-dalam-motiondiv`,
  },
  "sortable-handle": {
    code: "PA003",
    docs: `${DOCS_BASE}#sortable--drag-handle`,
  },
  "destructive-menuitem": {
    code: "PA004",
    docs: `${DOCS_BASE}#radix-dialog--dropdownmenu`,
  },
};

function metaFor(rule: string): RuleMeta {
  return RULE_META[rule] ?? { code: "PA000", docs: DOCS_BASE };
}

function describeEl(el: Element): {
  tag: string;
  id: string | null;
  testid: string | null;
  role: string | null;
  cls: string | null;
} {
  const h = el as HTMLElement;
  return {
    tag: el.tagName.toLowerCase(),
    id: h.id || null,
    testid: h.getAttribute("data-testid"),
    role: h.getAttribute("role"),
    cls: (h.getAttribute("class") || null)?.slice(0, 80) ?? null,
  };
}

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
    const meta = metaFor(f.rule);
    if (!ruleAllows(f.el, f.rule, meta.code)) return false;
    if (!scopeAllows(f.el)) return false;
    if (seen.has(f.el)) return false;
    const s = sig(f.el, f.rule);
    if (dedupe.has(s)) return false;
    dedupe.add(s);
    seen.add(f.el);
    return true;
  });
  if (!fresh.length) return;
  // Mode `suggest`: pasang marker DOM (tidak mengubah styling) supaya
  // devtools/overlay bisa memfilter visual berdasar kode error.
  if (config.mode === "suggest") {
    for (const f of fresh) {
      try {
        (f.el as HTMLElement).setAttribute(
          "data-press-audit-suggest",
          metaFor(f.rule).code,
        );
      } catch {
        /* elemen non-HTML — abaikan */
      }
    }
  }
  // Kelompokkan per rule agar mudah dibaca.
  const byRule = new Map<string, Finding[]>();
  for (const f of fresh) {
    const arr = byRule.get(f.rule) || [];
    arr.push(f);
    byRule.set(f.rule, arr);
  }
  // Ringkasan kode error untuk memudahkan filtering global
  // (mis. devtools filter "PA00" atau grep log).
  const codes = Array.from(byRule.keys())
    .map((r) => metaFor(r).code)
    .sort()
    .join(",");
  // eslint-disable-next-line no-console
  console.groupCollapsed(
    `%c[press-audit]%c ${fresh.length} temuan tanpa \`data-no-press\` · mode: ${config.mode} · kode: ${codes} · docs: ${DOCS_BASE}`,
    "color:#f59e0b;font-weight:600",
    "color:inherit",
  );
  for (const [rule, list] of byRule) {
    const meta = metaFor(rule);
    // eslint-disable-next-line no-console
    console.groupCollapsed(`[${meta.code}] ${rule} (${list.length}) · ${meta.docs}`);
    for (const { el, suggestion } of list) {
      const details = { code: meta.code, rule, docs: meta.docs, ...describeEl(el) };
      // eslint-disable-next-line no-console
      console.warn(`[press-audit ${meta.code}] ${suggestion} · docs: ${meta.docs}`, el, details);
    }
    // eslint-disable-next-line no-console
    console.groupEnd();
  }
  // eslint-disable-next-line no-console
  console.info(
    `Dokumentasi lengkap: ${DOCS_BASE} — bagian "Checklist implementasi per komponen". ` +
      `Filter cepat di devtools: ketik "press-audit" atau kode (PA001-PA004). ` +
      `Konfigurasi: window.__pressAuditConfig.set({ mode, rules, scope }).`,
  );
  // eslint-disable-next-line no-console
  console.groupEnd();
}

let started = false;

export function installPressAudit(): () => void {
  if (typeof window === "undefined") return () => {};
  if (started) return () => {};
  started = true;
  config = loadConfig();

  const run = () => {
    if (config.mode === "off") return;
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

  // API konfigurasi runtime — bisa dipanggil dari devtools console tanpa reload.
  (window as any).__pressAuditConfig = {
    get: (): PressAuditConfig => ({ ...config }),
    set: (patch: Partial<PressAuditConfig>) => {
      saveConfig({
        mode: patch.mode ?? config.mode,
        rules: {
          allow: patch.rules?.allow ?? config.rules.allow,
          deny: patch.rules?.deny ?? config.rules.deny,
        },
        scope: {
          allow: patch.scope?.allow ?? config.scope.allow,
          deny: patch.scope?.deny ?? config.scope.deny,
        },
      });
      dedupe.clear();
      run();
      return config;
    },
    reset: () => {
      saveConfig(DEFAULT_CONFIG);
      dedupe.clear();
      run();
      return config;
    },
  };

  return () => {
    mo.disconnect();
    started = false;
  };
}