import { useEffect, type RefObject } from "react";
import { describeEl, focusDebugLog, focusDebugSetLayers, isFocusDebugEnabled } from "@/lib/focus-debug";
import { FOCUSABLE_SELECTOR, PORTAL_LAYER_SELECTOR, isFocusableNow } from "@/lib/focus-order";

/**
 * Penjaga fokus untuk dialog dengan layer portal BERTUMPUK (popover → select →
 * menu). Diekstrak dari dialog pratinjau WA supaya perilaku yang sama bisa
 * diuji end-to-end lewat harness Playwright, bukan disalin ulang.
 *
 * Tanggung jawab:
 *  - Menumpuk tiap layer portal beserta pemicunya sendiri.
 *  - Saat layer ditutup berantai (dari atas ke bawah), memulihkan fokus ke
 *    pemicu masing-masing sesuai urutan penutupan.
 *  - Kalau pemicunya keburu ter-unmount (re-render / lazy-load isi layer),
 *    memakai jejak posisinya untuk mencari elemen fokusable terdekat.
 */

/** Selector stabil untuk menemukan ulang elemen setelah re-render. */
export function stableSelectorFor(el: HTMLElement): string | null {
  const esc = (v: string) =>
    typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, "\\$&");
  const testId = el.getAttribute("data-testid");
  if (testId) return `[data-testid="${esc(testId)}"]`;
  if (el.id) return `#${esc(el.id)}`;
  const label = el.getAttribute("aria-label");
  if (label) return `${el.tagName.toLowerCase()}[aria-label="${esc(label)}"]`;
  return null;
}

export type PortalFocusStackOptions = {
  open: boolean;
  /** Node konten dialog (state, bukan ref) supaya observer terpasang tepat waktu. */
  contentEl: HTMLElement | null;
  contentRef: RefObject<HTMLElement | null>;
  /** Area scroll tabIndex -1; dipakai sebagai target fokus terakhir. */
  scrollRef: RefObject<HTMLElement | null>;
  layerTriggerRef: RefObject<HTMLElement | null>;
  layerTriggerAnchorRef: RefObject<{
    selector: string | null;
    parent: HTMLElement | null;
    index: number;
  } | null>;
};

export function usePortalFocusStack({
  open,
  contentEl,
  contentRef,
  scrollRef,
  layerTriggerRef,
  layerTriggerAnchorRef,
}: PortalFocusStackOptions) {
  useEffect(() => {
    if (!open) return;
    const root = contentEl ?? contentRef.current;
    if (!root) return;

    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    /**
     * TUMPUKAN layer Radix (popover → select → menu ...) yang terbuka di portal
     * luar dialog. Tiap entri mengingat pemicunya sendiri, jadi saat layer
     * ditutup satu per satu fokus kembali persis ke pemicu masing-masing:
     * item di dalam popover dulu, baru tombol di dalam dialog.
     */
    type LayerEntry = {
      layer: Element;
      /** Elemen yang memegang fokus tepat sebelum layer ini terbuka. */
      trigger: HTMLElement | null;
      /** Jejak posisi pemicu, dipakai kalau node-nya keburu ter-unmount. */
      anchor: {
        selector: string | null;
        parent: HTMLElement | null;
        index: number;
      } | null;
    };
    const layerStack: LayerEntry[] = [];
    /** Snapshot tumpukan layer untuk panel debug (dev/test saja). */
    const syncDebugLayers = () => {
      if (!isFocusDebugEnabled()) return;
      focusDebugSetLayers(
        layerStack.map((e) => ({
          layer: describeEl(e.layer) ?? "(layer)",
          trigger: describeEl(e.trigger),
          anchor: e.anchor ? { selector: e.anchor.selector, index: e.anchor.index } : null,
        })),
      );
    };
    let layerObserver: MutationObserver | null = null;
    /** Elemen fokus terakhir, baik di dalam dialog maupun di dalam layer aktif. */
    let lastFocused: HTMLElement | null = null;

    const portalLayerOpen = () =>
      layerStack.some((entry) => document.contains(entry.layer));

    /** Semua elemen fokusable dialog dalam urutan DOM (terlihat & tidak disabled). */
    const focusablesIn = (node: HTMLElement) =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => isFocusableNow(el) || el === document.activeElement,
      );

    /** Jejak posisi sebuah elemen, untuk mencari penggantinya nanti. */
    const anchorOf = (node: HTMLElement, el: HTMLElement) => ({
      selector: stableSelectorFor(el),
      parent: el.parentElement,
      index: Math.max(0, focusablesIn(node).filter((f) => f !== scrollRef.current).indexOf(el)),
    });

    /**
     * Fallback saat pemicu layer sudah ter-unmount: cari elemen fokusable
     * TERDEKAT dengan posisi pemicu lama.
     *  1. Node setara hasil re-render (selector stabil, dicari di dalam dialog).
     *  2. Elemen fokusable pertama di dalam kontainer pemicu (parent) — biasanya
     *     baris/kartu yang sama.
     *  3. Elemen fokusable pada indeks yang sama; kalau daftar menyusut, ambil
     *     tetangga terdekat ke belakang lalu ke depan.
     */
    const nearestFallback = (node: HTMLElement): HTMLElement | null => {
      const anchor = layerTriggerAnchorRef.current;
      if (!anchor) return null;

      if (anchor.selector) {
        const found = node.querySelector<HTMLElement>(anchor.selector);
        if (found && isFocusableNow(found)) return found;
      }

      const parent = anchor.parent;
      if (parent && document.contains(parent) && node.contains(parent)) {
        const inParent = focusablesIn(parent).find((el) => isFocusableNow(el));
        if (inParent) return inParent;
      }

      const list = focusablesIn(node).filter(
        (el) => el !== scrollRef.current && isFocusableNow(el),
      );
      if (list.length === 0) return null;
      const idx = Math.min(Math.max(anchor.index, 0), list.length - 1);
      return list[idx] ?? list[list.length - 1] ?? null;
    };

    /** Cek super-murah: apakah fokus sudah hilang dari dialog? */
    const focusEscaped = () => {
      const node = contentRef.current;
      if (!node || !document.contains(node)) return false;
      // Selama layer portal masih terbuka, fokus di dalamnya SAH.
      if (portalLayerOpen()) return false;
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body) return true;
      // Radix FocusScope sering "menyelamatkan" fokus ke kontainer dialog saat
      // elemen aktif dilepas. Itu masih di dalam dialog, tapi urutan Tab jadi
      // mulai dari awal — anggap perlu diperbaiki bila kita tahu posisi
      // pemicu terakhirnya.
      if (active === node && layerTriggerAnchorRef.current) return true;
      return !node.contains(active);
    };

    const runRefocus = () => {
        const node = contentRef.current;
        if (!node || !document.contains(node)) return;
        if (portalLayerOpen()) return;
        const active = document.activeElement as HTMLElement | null;
        const parkedOnContainer = active === node && !!layerTriggerAnchorRef.current;
        if (active && active !== document.body && node.contains(active) && !parkedOnContainer) return;
        // Prioritas 1: elemen pemicu popover/select yang tadi memegang fokus
        // di dalam dialog (mis. tombol "Pilih kontak"). Radix biasanya sudah
        // mengembalikannya sendiri, tapi di Android WebView sering meleset ke
        // <body> — di situ kita pulihkan manual.
        const back = layerTriggerRef.current;
        // `back === node` berarti Radix cuma memarkir fokus di kontainer
        // dialog — bukan pemicu sungguhan; jangan dipakai. Pemicu yang sudah
        // disabled/ter-hidden juga dilewati supaya fokus tidak "hilang".
        if (back && back !== node && node.contains(back) && isFocusableNow(back)) {
          layerTriggerRef.current = null;
          layerTriggerAnchorRef.current = null;
          try { back.focus({ preventScroll: true }); return; } catch { /* ignore */ }
        }
        // Pemicu masih ada tapi tidak bisa difokus (disabled/hidden): pakai
        // jejak posisinya supaya fallback mendarat di tetangga yang benar.
        if (back && back !== node && node.contains(back) && !layerTriggerAnchorRef.current) {
          layerTriggerAnchorRef.current = anchorOf(node, back);
        }
        // Prioritas 2: pemicu sudah ter-unmount selagi popover/select terbuka.
        // Jangan buang fokus ke area konten — pakai tetangga terdekatnya.
        const near = nearestFallback(node);
        if (near) {
          layerTriggerRef.current = null;
          layerTriggerAnchorRef.current = null;
          try { near.focus({ preventScroll: true }); return; } catch { /* ignore */ }
        }
        // Prioritaskan area konten (tabIndex -1) agar pembaca layar tetap
        // berada dalam konteks dialog tanpa memicu tombol aksi.
        const target =
          scrollRef.current ?? node.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? node;
        focusDebugLog("refocus", `fallback=${describeEl(target) ?? "(dialog)"}`);
        try { target.focus({ preventScroll: true }); } catch { /* ignore */ }
    };

    /** Koalesi: 1 timer + 1 rAF, tidak peduli berapa kali dipanggil. */
    const scheduleRefocus = () => {
      if (timer !== null || raf !== 0) return;
      timer = setTimeout(() => {
        timer = null;
        if (!focusEscaped()) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          runRefocus();
        });
      }, 50);
    };

    /**
     * Kembalikan fokus ke pemicu satu layer yang baru saja ditutup. Pemicunya
     * boleh berada di dalam dialog ATAU di dalam layer induk yang masih
     * terbuka (kasus popover → select).
     */
    const restoreLayerTrigger = (entry: LayerEntry) => {
      const node = contentRef.current;
      const t = entry.trigger;
      const stillReachable =
        !!t &&
        isFocusableNow(t) &&
        (!!node?.contains(t) ||
          layerStack.some((e) => document.contains(e.layer) && e.layer.contains(t)));
      if (stillReachable && t) {
        lastFocused = t;
        layerTriggerRef.current = node?.contains(t) ? t : layerTriggerRef.current;
        focusDebugLog("restore-layer-trigger", `ke=${describeEl(t)}`);
        try {
          t.focus({ preventScroll: true });
          return true;
        } catch {
          /* ignore */
        }
      }
      // Pemicunya ter-unmount ATAU sudah disabled/ter-hidden: pakai jejak
      // posisinya untuk cari tetangga terdekat di dalam dialog lewat jalur
      // pemulihan biasa. Kalau jejak lama tidak ada tapi node-nya masih di
      // DOM, rekam jejaknya sekarang (posisinya masih valid).
      const anchor =
        entry.anchor ?? (t && node && node.contains(t) ? anchorOf(node, t) : null);
      if (anchor) layerTriggerAnchorRef.current = anchor;
      layerTriggerRef.current = null;
      focusDebugLog(
        "restore-layer-trigger",
        `pemicu tidak fokusable → anchor selector=${anchor?.selector ?? "-"} index=${anchor?.index ?? -1}`,
      );
      scheduleRefocus();
      return false;
    };

    /**
     * Buang layer yang sudah lepas dari DOM, dari yang PALING ATAS ke bawah,
     * sambil memulihkan fokus ke pemicu tiap layer sesuai urutan penutupannya.
     */
    const pruneClosedLayers = () => {
      let closedAny = false;
      let restored = false;
      while (layerStack.length > 0) {
        const top = layerStack[layerStack.length - 1]!;
        if (document.contains(top.layer)) break;
        layerStack.pop();
        closedAny = true;
        focusDebugLog("layer-close", `tutup=${describeEl(top.layer) ?? "(layer)"}`);
        restored = restoreLayerTrigger(top);
      }
      if (closedAny) syncDebugLayers();
      if (layerStack.length === 0) {
        layerObserver?.disconnect();
        layerObserver = null;
      }
      // Kalau layer terluar sudah tertutup tapi fokusnya belum mendarat,
      // serahkan ke penjaga fokus dialog (nearestFallback).
      if (closedAny && !restored && layerStack.length === 0) scheduleRefocus();
    };

    /** Satu observer saja untuk seluruh tumpukan layer. */
    const ensureLayerObserver = () => {
      if (layerObserver) return;
      layerObserver = new MutationObserver(() => pruneClosedLayers());
      layerObserver.observe(document.body, { childList: true, subtree: true });
    };

    const observer = new MutationObserver((records) => {
      // Layer portal bisa ditutup bersamaan dengan mutasi ini.
      pruneClosedLayers();
      // Hanya mutasi yang MELEPAS node bisa membuang fokus. Selain itu abaikan
      // tanpa menyentuh DOM sedikit pun.
      let removed = false;
      for (const r of records) {
        if (r.removedNodes.length > 0) { removed = true; break; }
      }
      if (!removed) return;
      if (!focusEscaped()) return;
      scheduleRefocus();
    });
    observer.observe(root, { childList: true, subtree: true });

    const onFocusIn = (e: FocusEvent) => {
      const node = contentRef.current;
      const target = e.target as Node | null;
      if (!node || !target) return;
      if (node.contains(target)) {
        // Catat kandidat pemicu: elemen interaktif terakhir di dalam dialog.
        const el = target instanceof HTMLElement ? target : null;
        if (el && typeof el.focus === "function" && el !== scrollRef.current && el !== node) {
          lastFocused = el;
          layerTriggerRef.current = el;
          // Rekam jejak posisinya sekalian — murah, dan satu-satunya cara
          // memulihkan fokus kalau node ini keburu dilepas dari DOM.
          layerTriggerAnchorRef.current = anchorOf(node, el);
        }
        return;
      }
      // Popover/select/tooltip Radix dirender di portal luar dialog — itu
      // masih "di dalam" konteks dialog secara logis, jangan direbut.
      const el = target instanceof Element ? target : (target.parentElement ?? null);
      const layer = el?.closest(PORTAL_LAYER_SELECTOR) ?? null;
      if (layer) {
        // Layer portal aktif: penjaga fokus dinonaktifkan selama layer hidup.
        // Layer baru DITUMPUK di atas yang lama (popover → select), lengkap
        // dengan pemicunya sendiri agar pemulihan mengikuti urutan penutupan.
        if (!layerStack.some((entry) => entry.layer === layer)) {
          layerStack.push({
            layer,
            trigger: lastFocused,
            anchor: layerTriggerAnchorRef.current,
          });
          syncDebugLayers();
          focusDebugLog(
            "layer-open",
            `buka=${describeEl(layer) ?? "(layer)"} | pemicu=${describeEl(lastFocused) ?? "-"} | depth=${layerStack.length}`,
          );
          ensureLayerObserver();
        }
        if (el instanceof HTMLElement) lastFocused = el;
        return;
      }
      scheduleRefocus();
    };
    document.addEventListener("focusin", onFocusIn, true);

    return () => {
      if (timer !== null) clearTimeout(timer);
      if (raf !== 0) cancelAnimationFrame(raf);
      observer.disconnect();
      layerObserver?.disconnect();
      document.removeEventListener("focusin", onFocusIn, true);
    };
  }, [open, contentEl]);
}
