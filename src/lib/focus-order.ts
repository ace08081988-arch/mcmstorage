/**
 * Urutan Tab/Shift-Tab yang stabil untuk konten dialog yang bisa berubah
 * (mode edit ↔ mode baca) dan untuk dialog yang ditutup lalu dibuka lagi.
 *
 * Logikanya sengaja murni (tanpa React) supaya bisa diverifikasi lewat tes:
 * daftar elemen fokusable selalu dihitung ulang dari DOM saat ini, jadi
 * pertukaran <textarea> ↔ <pre role="button"> tidak pernah membuat posisi Tab
 * "meloncat" ke awal dialog.
 */

export const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export const PORTAL_LAYER_SELECTOR =
  '[data-radix-popper-content-wrapper],[role="menu"],[role="listbox"],[role="dialog"],[role="alertdialog"]';

export type FocusOrderOptions = {
  /** Elemen dianggap terlihat; default memakai offsetParent (jsdom bisa override). */
  isVisible?: (el: HTMLElement) => boolean;
  /** Elemen yang tidak boleh jadi target siklus Tab (mis. area scroll tabIndex -1). */
  skip?: (el: HTMLElement) => boolean;
};

/** Elemen dianggap tampil: punya offsetParent, punya box, atau sedang fokus. */
export function isVisibleNow(el: HTMLElement): boolean {
  const doc = el.ownerDocument;
  if (el === doc.activeElement) return true;
  if (el.offsetParent !== null) return true;
  return el.getClientRects().length > 0;
}

/**
 * Apakah elemen ini BENAR-BENAR bisa menerima fokus SEKARANG: masih di DOM,
 * tidak disabled (termasuk aria-disabled), tidak tersembunyi (hidden /
 * aria-hidden / inert / display:none), dan bukan tabindex="-1" murni.
 * Dipakai saat memulihkan fokus setelah layer portal ditutup — pemicu lama
 * bisa saja sudah dinonaktifkan atau disembunyikan oleh re-render.
 */
export function isFocusableNow(el: HTMLElement | null | undefined): el is HTMLElement {
  if (!el || !el.isConnected) return false;
  if (typeof (el as HTMLElement).focus !== "function") return false;
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.getAttribute("aria-disabled") === "true") return false;
  if (el.hidden) return false;
  if (el.closest('[hidden],[aria-hidden="true"],[inert]')) return false;
  return isVisibleNow(el);
}

/** Semua elemen fokusable di dalam `root`, dalam urutan DOM. */
export function focusablesInOrder(
  root: HTMLElement,
  opts: FocusOrderOptions = {},
): HTMLElement[] {
  const doc = root.ownerDocument;
  const isVisible =
    opts.isVisible ??
    ((el: HTMLElement) => el === doc.activeElement || isVisibleNow(el));
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) =>
      el.getAttribute("aria-disabled") !== "true" &&
      !el.hidden &&
      isVisible(el) &&
      !(opts.skip?.(el) ?? false),
  );
}

/**
 * Target fokus berikutnya saat Tab ditekan; `null` berarti biarkan browser
 * menangani (fokus masih di tengah daftar, tidak perlu digulung).
 */
export function resolveTabTarget(
  root: HTMLElement,
  active: HTMLElement | null,
  shiftKey: boolean,
  opts: FocusOrderOptions = {},
): HTMLElement | null {
  // Layer portal Radix mengelola Tab-nya sendiri.
  if (active && !root.contains(active) && active.closest(PORTAL_LAYER_SELECTOR)) return null;
  const list = focusablesInOrder(root, opts);
  if (list.length === 0) return null;
  const first = list[0]!;
  const last = list[list.length - 1]!;
  const outside = !active || !root.contains(active);
  if (!shiftKey && (active === last || outside)) return first;
  if (shiftKey && (active === first || outside)) return last;
  return null;
}

/**
 * Simulasi satu langkah Tab pada urutan saat ini — dipakai tes untuk
 * memverifikasi tidak ada lompatan setelah konten berubah.
 */
export function nextFocusInOrder(
  root: HTMLElement,
  active: HTMLElement | null,
  shiftKey: boolean,
  opts: FocusOrderOptions = {},
): HTMLElement | null {
  const wrapped = resolveTabTarget(root, active, shiftKey, opts);
  if (wrapped) return wrapped;
  const list = focusablesInOrder(root, opts);
  const idx = active ? list.indexOf(active) : -1;
  if (idx === -1) return list[0] ?? null;
  return list[idx + (shiftKey ? -1 : 1)] ?? null;
}
