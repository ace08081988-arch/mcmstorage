/**
 * Snapshot test untuk pemetaan ikon status panggilan.
 *
 * Tujuannya: ikon (nama komponen Lucide) dan kelas warna untuk status
 * "Tidak dijawab", "Ditolak", "Dibatalkan", dan "Diterima" (masuk/keluar/
 * netral) tidak boleh berubah tanpa disengaja. Kalau ada perubahan
 * pemetaan, snapshot akan gagal dan wajib di-review manual sebelum
 * di-update dengan `vitest -u`.
 */
import { describe, expect, it } from "vitest";
import {
  getCallStatusVisual,
  type CallVisualStatus,
} from "../call-status-visual";

function snapshot(
  status: CallVisualStatus,
  opts?: { outgoing?: boolean },
) {
  const v = getCallStatusVisual(status, opts);
  return {
    icon: v.Icon.displayName ?? v.Icon.name,
    colorClass: v.colorClass,
    label: v.label,
    hint: v.hint,
  };
}

describe("getCallStatusVisual — pemetaan ikon status kritis", () => {
  it("Tidak dijawab (missed) memakai PhoneMissed merah", () => {
    expect(snapshot("missed")).toMatchInlineSnapshot(`
      {
        "colorClass": "text-red-500",
        "hint": "Tidak dijawab — panggilan tidak diangkat penerima.",
        "icon": "PhoneMissed",
        "label": "Tidak dijawab",
      }
    `);
  });

  it("Ditolak (declined) memakai PhoneOff amber", () => {
    expect(snapshot("declined")).toMatchInlineSnapshot(`
      {
        "colorClass": "text-amber-500",
        "hint": "Ditolak — penerima menolak panggilan.",
        "icon": "PhoneOff",
        "label": "Ditolak",
      }
    `);
  });

  it("Dibatalkan (cancelled) memakai Ban amber", () => {
    expect(snapshot("cancelled")).toMatchInlineSnapshot(`
      {
        "colorClass": "text-amber-500",
        "hint": "Dibatalkan — panggilan dihentikan sebelum diangkat.",
        "icon": "Ban",
        "label": "Dibatalkan",
      }
    `);
  });

  it("Diterima netral (ended, arah tidak diketahui) memakai CheckCircle2 emerald", () => {
    expect(snapshot("ended")).toMatchInlineSnapshot(`
      {
        "colorClass": "text-emerald-500",
        "hint": "Diterima — panggilan berhasil tersambung.",
        "icon": "CheckCircle2",
        "label": "Diterima",
      }
    `);
  });

  it("Diterima keluar (ended, outgoing) memakai PhoneOutgoing emerald", () => {
    expect(snapshot("ended", { outgoing: true })).toMatchInlineSnapshot(`
      {
        "colorClass": "text-emerald-500",
        "hint": "Diterima — panggilan keluar berhasil tersambung.",
        "icon": "PhoneOutgoing",
        "label": "Diterima",
      }
    `);
  });

  it("Diterima masuk (ended, incoming) memakai PhoneIncoming emerald", () => {
    expect(snapshot("ended", { outgoing: false })).toMatchInlineSnapshot(`
      {
        "colorClass": "text-emerald-500",
        "hint": "Diterima — panggilan masuk berhasil tersambung.",
        "icon": "PhoneIncoming",
        "label": "Diterima",
      }
    `);
  });

  it("Gagal (failed) memakai AlertCircle merah", () => {
    expect(snapshot("failed")).toMatchInlineSnapshot(`
      {
        "colorClass": "text-red-500",
        "hint": "Gagal — panggilan tidak dapat tersambung.",
        "icon": "AlertCircle",
        "label": "Gagal",
      }
    `);
  });
});