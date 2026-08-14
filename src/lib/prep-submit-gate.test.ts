import { describe, it, expect } from "vitest";
import { validateSubmitGate } from "./prep-submit-gate";

const loc = { locUrl: "https://maps.google.com/?q=1,2" };

describe("validateSubmitGate", () => {
  it("menolak tanpa foto", () => {
    const r = validateSubmitGate({ photos: [], ...loc });
    expect(r).toMatchObject({ ok: false, code: "no-photo" });
  });

  it("menolak foto yang belum lewat editor", () => {
    const r = validateSubmitGate({ photos: [{ edited: false }], ...loc });
    expect(r).toMatchObject({ ok: false, code: "unedited" });
  });

  it("mengizinkan foto mentah bila user setuju eksplisit", () => {
    expect(
      validateSubmitGate({ photos: [{ edited: false }], ...loc, allowUnedited: true }),
    ).toEqual({ ok: true });
  });

  it("menolak tanpa lokasi maupun gps", () => {
    expect(validateSubmitGate({ photos: [{ edited: true }] })).toMatchObject({
      ok: false,
      code: "no-location",
    });
  });

  it("menerima gps saja", () => {
    expect(
      validateSubmitGate({ photos: [{ edited: true }], gps: { lat: -6.2, lng: 106.8 } }),
    ).toEqual({ ok: true });
  });

  it("menolak url lokasi non-https", () => {
    expect(
      validateSubmitGate({ photos: [{ edited: true }], locUrl: "http://maps.example" }),
    ).toMatchObject({ ok: false, code: "bad-url" });
  });

  it("lolos penuh saat foto teredit + lokasi valid", () => {
    expect(validateSubmitGate({ photos: [{ edited: true }], ...loc })).toEqual({ ok: true });
  });
});
