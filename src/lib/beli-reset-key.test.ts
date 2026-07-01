import { describe, it, expect } from "vitest";
import { beliResetKey } from "./beli-reset-key";

describe("beliResetKey", () => {
  it("mengikuti itemId dalam mode existing (bukan packageType)", () => {
    const a = beliResetKey({ mode: "existing", itemId: "id-1", packageType: "botol" });
    const b = beliResetKey({ mode: "existing", itemId: "id-2", packageType: "botol" });
    expect(a).not.toBe(b);
    const c = beliResetKey({ mode: "existing", itemId: "id-1", packageType: "gram" });
    expect(a).toBe(c);
  });

  it("mengikuti packageType dalam mode new (bukan itemId)", () => {
    const a = beliResetKey({ mode: "new", itemId: "id-1", packageType: "botol" });
    const b = beliResetKey({ mode: "new", itemId: "id-1", packageType: "gram" });
    expect(a).not.toBe(b);
    const c = beliResetKey({ mode: "new", itemId: "id-2", packageType: "botol" });
    expect(a).toBe(c);
  });

  it("berbeda antara mode existing dan new walau nilai lainnya sama", () => {
    const a = beliResetKey({ mode: "existing", itemId: "id-1", packageType: "botol" });
    const b = beliResetKey({ mode: "new", itemId: "id-1", packageType: "botol" });
    expect(a).not.toBe(b);
  });
});