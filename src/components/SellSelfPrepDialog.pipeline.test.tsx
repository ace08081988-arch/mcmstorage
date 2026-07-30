// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import React, { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { NumericTextField, displayFromCanonicalString } from "./NumericDraftInput";
import { parseNum } from "./SellSelfPrepDialog";

/**
 * Integration test: mengunci konsistensi TOTAL akhir dari input Gram &
 * Harga di seluruh pipeline yang dipakai SellSelfPrepDialog, bukan
 * hanya parseNum:
 *
 *   user mengetik  →  NumericTextField.onChange (reformat)
 *                  →  canonical string emit ke state
 *                  →  displayFromCanonicalString untuk render ulang
 *                  →  parseNum(gramsStr) × parseNum(priceStr) = subtotal
 *                  →  Σ subtotal = totalAmount (logika SellSelfPrepDialog)
 *
 * Regresi yang di-guard: bug "0,9 × 900.000 = 8.100.000" (10× lipat)
 * dan varian trailing-zero (0,10, 1,50) di mana display ↔ canonical
 * dulu sempat divergen.
 */

// Salinan logika subtotal/total dari SellSelfPrepDialog (memo di baris
// 146-154). Diduplikasi di sini SUPAYA test ini adalah kontrak — kalau
// implementasi pipeline berubah, test harus di-update secara sadar.
function computeSubtotal(gramsStr: string, priceStr: string): number {
  const g = parseNum(gramsStr);
  const p = parseNum(priceStr);
  return Math.max(0, g) * Math.max(0, p);
}
function computeTotal(rows: Array<{ g: string; p: string }>): number {
  return rows
    .map((r) => computeSubtotal(r.g, r.p))
    .reduce((s, v) => s + v, 0);
}

type Harness = {
  gramsCanonical: string;
  priceCanonical: string;
  gramsDisplay: string;
  priceDisplay: string;
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let last: Harness | null = null;

function Fixture({ gramsStep = 0.01, priceStep = 1 }: { gramsStep?: number; priceStep?: number }) {
  const [g, setG] = useState("");
  const [p, setP] = useState("");
  last = {
    gramsCanonical: g,
    priceCanonical: p,
    gramsDisplay: displayFromCanonicalString(g, true, 2),
    priceDisplay: displayFromCanonicalString(p, false, 0),
  };
  return (
    <>
      <NumericTextField
        ariaLabel="grams"
        value={g}
        onValueChange={setG}
        step={gramsStep}
      />
      <NumericTextField
        ariaLabel="price"
        value={p}
        onValueChange={setP}
        step={priceStep}
      />
    </>
  );
}

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<Fixture />);
  });
}

function typeInto(ariaLabel: string, text: string) {
  const el = container!.querySelector<HTMLInputElement>(
    `input[aria-label="${ariaLabel}"]`,
  );
  if (!el) throw new Error(`input[aria-label=${ariaLabel}] tidak ada`);
  // Simulasikan user mengetik dari kosong: set value satu shot & fire
  // input event. Ini path yang sama dipakai React onChange handler di
  // NumericTextField (onChange → reformat → onValueChange(canonical)).
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function blur(ariaLabel: string) {
  const el = container!.querySelector<HTMLInputElement>(
    `input[aria-label="${ariaLabel}"]`,
  );
  if (!el) throw new Error(`input[aria-label=${ariaLabel}] tidak ada`);
  act(() => {
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
  last = null;
});

describe("SellSelfPrepDialog · pipeline total end-to-end", () => {
  it("regresi bug 10×: ketik 0,9 gram × 900.000 harga → subtotal 810.000", () => {
    mount();
    typeInto("grams", "0,9");
    typeInto("price", "900000");
    blur("grams");
    blur("price");

    expect(last!.gramsDisplay).toBe("0,9");
    expect(last!.priceDisplay).toBe("900.000");
    expect(last!.gramsCanonical).toBe("0.9");
    expect(last!.priceCanonical).toBe("900000");

    const subtotal = computeSubtotal(last!.gramsCanonical, last!.priceCanonical);
    expect(subtotal).toBe(810_000);
    // Bukan 8.100.000 (bug lama)
    expect(subtotal).not.toBe(8_100_000);
  });

  it("trailing zero desimal (0,10) tidak menggeser total", () => {
    mount();
    typeInto("grams", "0,10");
    typeInto("price", "900000");
    blur("grams");
    blur("price");

    // Display persis seperti yang user ketik
    expect(last!.gramsDisplay).toBe("0,10");
    expect(last!.priceDisplay).toBe("900.000");
    // Canonical mempertahankan digit literal
    expect(last!.gramsCanonical).toBe("0.10");

    expect(computeSubtotal(last!.gramsCanonical, last!.priceCanonical)).toBe(90_000);
  });

  it("format id-ID (koma desimal + titik ribuan) sepanjang pipeline", () => {
    mount();
    typeInto("grams", "1,5");
    typeInto("price", "1.500.000");
    blur("grams");
    blur("price");

    expect(last!.gramsDisplay).toBe("1,5");
    expect(last!.priceDisplay).toBe("1.500.000");
    expect(computeSubtotal(last!.gramsCanonical, last!.priceCanonical)).toBe(
      2_250_000,
    );
  });

  it("total multi-baris = Σ subtotal (konsisten dengan useMemo di dialog)", () => {
    // Pipeline yang sama seperti totalAmount di SellSelfPrepDialog:
    // beberapa Line berbeda dengan canonical yang sudah lolos NumericTextField.
    // Kita bangun canonical-nya via mount → type → capture per baris.
    const rows: Array<{ g: string; p: string }> = [];

    for (const [gramsInput, priceInput] of [
      ["0,9", "900000"],
      ["0,10", "900000"],
      ["2,5", "40.000"],
    ] as const) {
      mount();
      typeInto("grams", gramsInput);
      typeInto("price", priceInput);
      blur("grams");
      blur("price");
      rows.push({ g: last!.gramsCanonical, p: last!.priceCanonical });
      act(() => {
        root!.unmount();
      });
      container!.remove();
      container = null;
      root = null;
    }

    // 810.000 + 90.000 + 100.000
    expect(computeTotal(rows)).toBe(1_000_000);
  });

  it("input kosong → subtotal 0 (tidak NaN, tidak meledakkan total)", () => {
    mount();
    // Sengaja tidak isi apa-apa.
    expect(last!.gramsCanonical).toBe("");
    expect(last!.priceCanonical).toBe("");
    expect(computeSubtotal(last!.gramsCanonical, last!.priceCanonical)).toBe(0);
  });

  it("nilai negatif di-clamp ke 0 di subtotal (parity dengan Math.max(0, …))", () => {
    // Canonical negatif tidak bisa diketik lewat NumericTextField
    // (reformat menolak tanda minus), tapi pipeline downstream harus
    // tetap aman kalau ada state yang bocor via kode lain.
    expect(computeSubtotal("-1", "1000")).toBe(0);
    expect(computeSubtotal("1", "-1000")).toBe(0);
  });
});

