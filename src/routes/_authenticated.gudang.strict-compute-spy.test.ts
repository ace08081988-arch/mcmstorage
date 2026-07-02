import { describe, it, expect } from "vitest";
import {
  computeBeliDerived,
  computeBeliDerived as realComputeDerived,
} from "@/lib/beli-derived";
import { computeBeliWarnings } from "@/lib/beli-warnings";
import {
  createStrictDerivedSpy,
  createStrictWarningsSpy,
} from "./_authenticated.gudang.strict-compute-spy";
import {
  FIXTURE_ITEM,
  makeBeliItem,
  makeBeliDerivedInput,
  type BeliItemFixture,
} from "@/lib/beli-fixtures";

// ============================================================
// Memastikan matcher strict-compute-spy:
//   1) hanya menghitung panggilan pipeline (via `.call`).
//   2) mengabaikan pemanggilan compute yang berasal dari helper
//      fixture / kontrol positif / snapshot builder — sehingga
//      tidak muncul false positive.
//   3) menolak (throw) bila input tidak sesuai shape pipeline.
//   4) ekspektasi tetap deterministik walau tercampur helper.
// ============================================================

const baseInp = makeBeliDerivedInput;
const ITEM: BeliItemFixture = FIXTURE_ITEM;

describe("strict-compute-spy: matcher hanya menghitung panggilan pipeline", () => {
  it("panggilan via `.call` menaikkan pipelineCalls; panggilan real langsung tidak", () => {
    const spy = createStrictDerivedSpy();

    // Helper luar pipeline — memakai fungsi asli, TIDAK terkait spy.
    for (let i = 0; i < 50; i++) {
      const withStock = makeBeliItem({ stock_base: i });
      realComputeDerived(baseInp({ selectedItem: withStock }));
    }

    expect(spy.pipelineCalls).toBe(0);
    expect(spy.mock).not.toHaveBeenCalled();

    // Panggilan pipeline yang sesungguhnya.
    spy.call(baseInp({ selectedItem: ITEM }));
    spy.call(baseInp({ selectedItem: ITEM, packageQty: "3" }));

    expect(spy.pipelineCalls).toBe(2);
    expect(spy.mock).toHaveBeenCalledTimes(2);
    expect(spy.invalidCalls).toBe(0);
  });

  it("warnings: pipelineCalls stabil walau helper snapshot ikut memanggil compute asli", () => {
    const spyW = createStrictWarningsSpy();
    const derived = computeBeliDerived(baseInp({ selectedItem: ITEM }));

    // Snapshot fixture — panggil ratusan kali di luar pipeline.
    for (let i = 0; i < 200; i++) {
      computeBeliWarnings({
        mode: "existing",
        selectedItem: makeBeliItem({ avg_cost_per_base: 20 + (i % 5) }),
        derived,
        priceMode: "package",
        inputKarton: false,
      });
    }

    // Pipeline sungguhan: 1 kali.
    spyW.call({
      mode: "existing",
      selectedItem: ITEM,
      derived,
      priceMode: "package",
      inputKarton: false,
    });

    expect(spyW.pipelineCalls).toBe(1);
    expect(spyW.mock).toHaveBeenCalledTimes(1);
  });

  it("input yang bentuknya salah untuk pipeline melempar error dan menaikkan invalidCalls", () => {
    const spy = createStrictDerivedSpy();
    expect(() =>
      (spy.call as unknown as (x: unknown) => unknown)({ mode: "existing" }),
    ).toThrow(/computeBeliDerived: field '/);
    expect(spy.invalidCalls).toBe(1);
    expect(spy.pipelineCalls).toBe(0);
  });

  it("reset() mengembalikan counter dan mock ke nol", () => {
    const spy = createStrictDerivedSpy();
    spy.call(baseInp({ selectedItem: ITEM }));
    spy.call(baseInp({ selectedItem: ITEM, packageQty: "5" }));
    expect(spy.pipelineCalls).toBe(2);
    spy.reset();
    expect(spy.pipelineCalls).toBe(0);
    expect(spy.mock).toHaveBeenCalledTimes(0);
  });

  it("stabilitas ekspektasi: 500 helper-calls + 3 pipeline-calls → tetap 3", () => {
    const spy = createStrictDerivedSpy();
    for (let i = 0; i < 500; i++) {
      const withStock = makeBeliItem({ stock_base: i });
      realComputeDerived(baseInp({ selectedItem: withStock }));
    }
    spy.call(baseInp({ selectedItem: ITEM }));
    for (let i = 0; i < 250; i++) {
      const withStock = makeBeliItem({ stock_base: i });
      realComputeDerived(baseInp({ selectedItem: withStock }));
    }
    spy.call(baseInp({ selectedItem: ITEM, packageQty: "3" }));
    spy.call(baseInp({ selectedItem: ITEM, packageQty: "4" }));
    for (let i = 0; i < 250; i++) {
      const withStock = makeBeliItem({ stock_base: i });
      realComputeDerived(baseInp({ selectedItem: withStock }));
    }
    expect(spy.pipelineCalls).toBe(3);
    expect(spy.invalidCalls).toBe(0);
  });
});

// ============================================================
// NEGATIVE TESTS — memastikan helper di sekitar test TIDAK ikut
// menaikkan pipelineCalls / mock counter matcher strict-spy.
// Setiap skenario berikut adalah pola realistis yang bisa
// menyebabkan false positive kalau matcher salah pasang.
// ============================================================
describe("strict-compute-spy: helper lain tidak memicu pipelineCalls", () => {
  it("fixture builder yang men-derive baseline TIDAK menambah counter", () => {
    const spy = createStrictDerivedSpy();
    // Snapshot builder yang lazim ada di test: menghitung baseline via
    // fungsi asli untuk membuat ekspektasi. Tidak boleh dihitung.
    const baselines = Array.from({ length: 25 }, (_, i) =>
      realComputeDerived(
        baseInp({ selectedItem: makeBeliItem({ stock_base: i }) }),
      ),
    );
    expect(baselines).toHaveLength(25);
    expect(spy.pipelineCalls).toBe(0);
    expect(spy.invalidCalls).toBe(0);
    expect(spy.mock).not.toHaveBeenCalled();
  });

  it("kontrol positif (assertion setup) via computeBeliDerived asli TIDAK dihitung", () => {
    const spy = createStrictDerivedSpy();
    // Pola “expected = realCompute(input); pipeline.call(input); expect(...)”
    const input = baseInp({ selectedItem: ITEM, packageQty: "7" });
    const expected = realComputeDerived(input);
    const actual = spy.call(input);
    expect(actual).toEqual(expected);
    expect(spy.pipelineCalls).toBe(1); // hanya `.call`, bukan expected
    expect(spy.mock).toHaveBeenCalledTimes(1);
  });

  it("warnings: helper yang re-derive lewat computeBeliDerived asli tidak menyentuh spy warnings", () => {
    const spyW = createStrictWarningsSpy();
    // Helper luar: butuh derived → panggil compute asli (bukan via spy).
    for (let i = 0; i < 30; i++) {
      const d = realComputeDerived(baseInp({ selectedItem: ITEM, packageQty: String(i + 1) }));
      // Snapshot builder juga panggil computeBeliWarnings asli.
      computeBeliWarnings({
        mode: "existing",
        selectedItem: ITEM,
        derived: d,
        priceMode: "package",
        inputKarton: false,
      });
    }
    expect(spyW.pipelineCalls).toBe(0);
    expect(spyW.mock).not.toHaveBeenCalled();
  });

  it("dua spy independen: helper untuk spy A tidak bocor ke spy B", () => {
    const spyA = createStrictDerivedSpy();
    const spyB = createStrictDerivedSpy();
    // Spy A menerima 4 panggilan pipeline.
    for (let i = 0; i < 4; i++) {
      spyA.call(baseInp({ selectedItem: ITEM, packageQty: String(i + 1) }));
    }
    // Sementara itu banyak helper luar pipeline berjalan.
    for (let i = 0; i < 100; i++) {
      realComputeDerived(baseInp({ selectedItem: makeBeliItem({ stock_base: i }) }));
    }
    expect(spyA.pipelineCalls).toBe(4);
    expect(spyB.pipelineCalls).toBe(0);
    expect(spyB.mock).not.toHaveBeenCalled();
  });

  it("panggilan derived DAN warnings asli tercampur → kedua counter tetap 0", () => {
    const spyD = createStrictDerivedSpy();
    const spyW = createStrictWarningsSpy();
    const derived = realComputeDerived(baseInp({ selectedItem: ITEM }));
    for (let i = 0; i < 60; i++) {
      realComputeDerived(baseInp({ selectedItem: ITEM, packageQty: String(i) }));
      computeBeliWarnings({
        mode: "existing",
        selectedItem: ITEM,
        derived,
        priceMode: "package",
        inputKarton: false,
      });
    }
    expect(spyD.pipelineCalls).toBe(0);
    expect(spyW.pipelineCalls).toBe(0);
    expect(spyD.mock).not.toHaveBeenCalled();
    expect(spyW.mock).not.toHaveBeenCalled();
  });

  it("reset() tidak menghidupkan counter dari helper yang berjalan sebelum spy ada", () => {
    // Simulasikan helper yang dieksekusi SEBELUM spy dibuat.
    for (let i = 0; i < 40; i++) {
      realComputeDerived(baseInp({ selectedItem: makeBeliItem({ stock_base: i }) }));
    }
    const spy = createStrictDerivedSpy();
    expect(spy.pipelineCalls).toBe(0);
    // Setelah reset masih 0, walau helper sebelumnya banyak.
    spy.reset();
    expect(spy.pipelineCalls).toBe(0);
    expect(spy.invalidCalls).toBe(0);
  });
});