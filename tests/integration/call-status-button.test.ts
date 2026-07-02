// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * End-to-end kecil untuk `CallStatusButton` — komponen yang dipakai di
 * /panggilan pada tiap baris riwayat.
 *
 * Yang divalidasi (dari sudut pengguna, bukan implementasi internal):
 *   1. Tooltip native (attribute `title` + `aria-label`) muncul dengan
 *      teks hint dari `getCallStatusVisual`, sehingga hover / focus
 *      langsung menampilkan penjelasan status.
 *   2. Klik ikon status memanggil `toast.info` dengan teks hint yang
 *      SAMA — jadi user sentuh (mobile) tetap dapat konteks tanpa hover.
 *
 * Dilakukan untuk tiga status kritis yang paling sering ditanyakan user:
 * "Tidak dijawab" (missed), "Ditolak / Dibatalkan" (declined + cancelled),
 * dan "Diterima" (ended, baik masuk maupun keluar).
 */

const toastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    info: (...args: unknown[]) => toastInfo(...args),
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

// Import setelah mock terpasang.
// eslint-disable-next-line import/first
import { CallStatusButton } from "@/components/chat/CallStatusButton";
// eslint-disable-next-line import/first
import { getCallStatusVisual, type CallVisualStatus } from "@/lib/call-status-visual";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  toastInfo.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderStatus(status: CallVisualStatus, outgoing = false) {
  act(() => {
    root.render(
      createElement(CallStatusButton, { status, outgoing }),
    );
  });
  const btn = container.querySelector<HTMLButtonElement>(
    `[data-testid="call-status-${status}"]`,
  );
  if (!btn) throw new Error(`Tombol status-${status} tidak ter-render`);
  return btn;
}

describe("CallStatusButton — tooltip & toast per status", () => {
  it("Tidak dijawab (missed) → tooltip & toast pakai hint 'Tidak dijawab —'", () => {
    const expected = getCallStatusVisual("missed").hint;
    const btn = renderStatus("missed");

    expect(btn.getAttribute("title")).toBe(expected);
    expect(btn.getAttribute("aria-label")).toBe(expected);
    expect(btn.textContent).toContain("Tidak dijawab");

    act(() => btn.click());
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(toastInfo).toHaveBeenCalledWith(expected);
  });

  it("Ditolak (declined) → tooltip & toast pakai hint 'Ditolak —'", () => {
    const expected = getCallStatusVisual("declined").hint;
    const btn = renderStatus("declined");

    expect(btn.getAttribute("title")).toBe(expected);
    expect(btn.getAttribute("aria-label")).toBe(expected);
    expect(btn.textContent).toContain("Ditolak");

    act(() => btn.click());
    expect(toastInfo).toHaveBeenCalledWith(expected);
  });

  it("Dibatalkan (cancelled) → tooltip & toast pakai hint 'Dibatalkan —'", () => {
    const expected = getCallStatusVisual("cancelled").hint;
    const btn = renderStatus("cancelled");

    expect(btn.getAttribute("title")).toBe(expected);
    expect(btn.getAttribute("aria-label")).toBe(expected);
    expect(btn.textContent).toContain("Dibatalkan");

    act(() => btn.click());
    expect(toastInfo).toHaveBeenCalledWith(expected);
  });

  it("Diterima keluar (ended, outgoing) → hint 'panggilan keluar berhasil tersambung'", () => {
    const expected = getCallStatusVisual("ended", { outgoing: true }).hint;
    const btn = renderStatus("ended", true);

    expect(btn.getAttribute("title")).toBe(expected);
    expect(expected).toContain("keluar");

    act(() => btn.click());
    expect(toastInfo).toHaveBeenCalledWith(expected);
  });

  it("Diterima masuk (ended, incoming) → hint 'panggilan masuk berhasil tersambung'", () => {
    const expected = getCallStatusVisual("ended", { outgoing: false }).hint;
    const btn = renderStatus("ended", false);

    expect(btn.getAttribute("title")).toBe(expected);
    expect(expected).toContain("masuk");

    act(() => btn.click());
    expect(toastInfo).toHaveBeenCalledWith(expected);
  });

  it("Klik ulang memicu toast berulang kali (satu per interaksi)", () => {
    const btn = renderStatus("missed");
    act(() => btn.click());
    act(() => btn.click());
    act(() => btn.click());
    expect(toastInfo).toHaveBeenCalledTimes(3);
  });
});