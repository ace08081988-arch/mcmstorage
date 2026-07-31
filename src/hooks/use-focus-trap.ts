import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

type Options = {
  /** Aktifkan trap. Default true. */
  active?: boolean;
  /** Dipanggil saat menekan Escape. */
  onEscape?: () => void;
  /** Pakai ref yang sudah ada (mis. komponen sudah punya rootRef). */
  ref?: RefObject<HTMLElement | null>;
  /** Fokuskan elemen pertama saat mount. Default true. */
  autoFocus?: boolean;
};

/**
 * Focus management untuk overlay/dialog buatan sendiri (yang tidak memakai Radix):
 * - memindahkan fokus ke dalam overlay saat terbuka
 * - menahan Tab/Shift+Tab agar tetap berputar di dalam overlay
 * - mengembalikan fokus ke elemen pemicu saat overlay ditutup
 * - Escape memanggil onEscape (opsional)
 *
 * Komponen Radix (Dialog, AlertDialog, Sheet, Drawer, DropdownMenu, Popover, Select)
 * sudah menangani semua ini sendiri — hook ini khusus untuk overlay manual.
 */
export function useFocusTrap<T extends HTMLElement = HTMLElement>(options: Options = {}) {
  const { active = true, onEscape, ref: externalRef, autoFocus = true } = options;
  const internalRef = useRef<T | null>(null);
  const ref = (externalRef ?? internalRef) as RefObject<T | null>;
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;

    const previous = document.activeElement as HTMLElement | null;

    const list = () =>
      Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    let clearAutoFocus: (() => void) | undefined;
    if (autoFocus) {
      const t = window.setTimeout(() => {
        const items = list();
        const target =
          root.querySelector<HTMLElement>("[data-autofocus]") ?? items[0] ?? root;
        if (target === root && !root.hasAttribute("tabindex")) root.setAttribute("tabindex", "-1");
        try {
          target.focus({ preventScroll: true });
        } catch {
          /* ignore */
        }
      }, 0);
      root.setAttribute("data-focus-trap", "on");
      clearAutoFocus = () => window.clearTimeout(t);
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && escapeRef.current) {
        e.stopPropagation();
        escapeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = list();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (!activeEl || !root.contains(activeEl)) {
        e.preventDefault();
        first.focus({ preventScroll: true });
        return;
      }
      if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("keydown", onKeyDown);
      root.removeAttribute("data-focus-trap");
      clearAutoFocus?.();
      if (previous && document.contains(previous)) {
        try {
          previous.focus({ preventScroll: true });
        } catch {
          /* ignore */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, autoFocus]);

  return ref;
}