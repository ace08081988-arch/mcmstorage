import { describe, expect, it } from "vitest";
import { sameSnapshotValue } from "./prep-snapshot";

const item = (id: string, updated: string) => ({
  id, name: "Beras", updated_at: updated, submissions: [{ id: "s1", photos: ["a", "b"] }],
});

describe("sameSnapshotValue", () => {
  it("payload identik dianggap sama (no-op render)", () => {
    expect(sameSnapshotValue([item("1", "t1"), item("2", "t1")], [item("1", "t1"), item("2", "t1")])).toBe(true);
  });
  it("perubahan nested terdeteksi", () => {
    expect(sameSnapshotValue([item("1", "t1")], [item("1", "t2")])).toBe(false);
  });
  it("panjang array berbeda terdeteksi", () => {
    expect(sameSnapshotValue([item("1", "t1")], [item("1", "t1"), item("2", "t1")])).toBe(false);
  });
  it("null vs objek", () => {
    expect(sameSnapshotValue(null, {})).toBe(false);
    expect(sameSnapshotValue(null, null)).toBe(true);
  });
  it("kunci berbeda terdeteksi", () => {
    expect(sameSnapshotValue({ a: 1 }, { b: 1 })).toBe(false);
    expect(sameSnapshotValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});
