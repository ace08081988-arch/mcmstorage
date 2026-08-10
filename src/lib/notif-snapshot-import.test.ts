import { describe, it, expect } from "vitest";
import {
  parseSnapshotText,
  normalizeSnapshot,
  CURRENT_SCHEMA_VERSION,
  SCHEMA_NAME,
} from "./notif-snapshot-import";

/** Payload v0/legacy yang mirip ekspor lama (tanpa schemaVersion). */
function legacyPayload(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2024-05-01T10:00:00.000Z",
    permission: { state: "granted" },
    frame: { inIframe: false },
    serviceWorker: { state: "activated" },
    pushSubscription: { active: true },
    ...overrides,
  };
}

function v1Payload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    schemaName: SCHEMA_NAME,
    exportedAt: "2026-06-01T10:00:00.000Z",
    permission: { state: "granted" },
    frame: { inIframe: false },
    serviceWorker: { state: "activated" },
    pushSubscription: { active: true },
    ...overrides,
  };
}

describe("normalizeSnapshot — legacy v0 → v1", () => {
  it("memetakan generatedAt ke exportedAt & menyisipkan schemaVersion/schemaName", () => {
    const r = normalizeSnapshot(legacyPayload());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sourceVersion).toBe(0);
    expect(r.snapshot.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(r.snapshot.schemaName).toBe(SCHEMA_NAME);
    expect(r.snapshot.exportedAt).toBe("2024-05-01T10:00:00.000Z");
    expect(r.appliedMigrations).toEqual([
      expect.objectContaining({ from: 0, to: 1 }),
    ]);
    expect(r.compatibility.mode).toBe("forward_migrated");
    expect(r.compatibility.sourceVersion).toBe(0);
    expect(r.compatibility.targetVersion).toBe(1);
    expect(r.compatibility.versionGap).toBe(0);
  });

  it("menghasilkan warning legacy_no_schema_version & migrated", () => {
    const r = normalizeSnapshot(legacyPayload());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const codes = r.warnings.map((w) => w.code);
    expect(codes).toContain("legacy_no_schema_version");
    expect(codes).toContain("migrated");
  });

  it("menghapus generatedAt dari rawAfter (tidak masuk extra)", () => {
    const r = normalizeSnapshot(legacyPayload());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect("generatedAt" in r.rawAfter).toBe(false);
    expect(r.rawBefore.generatedAt).toBe("2024-05-01T10:00:00.000Z");
    expect(r.snapshot.extra).toBeUndefined();
  });

  it("mempertahankan exportedAt jika sudah ada di file legacy (tidak menimpa)", () => {
    const r = normalizeSnapshot(
      legacyPayload({ exportedAt: "2024-01-01T00:00:00.000Z" }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.exportedAt).toBe("2024-01-01T00:00:00.000Z");
  });

  it("mempertahankan schemaName custom yang sudah ada (tidak menimpa)", () => {
    const r = normalizeSnapshot(
      legacyPayload({ schemaName: "mcm.custom.legacy" }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // rawAfter tetap membawa schemaName aslinya
    expect(r.rawAfter.schemaName).toBe("mcm.custom.legacy");
    // snapshot ternormalisasi selalu memakai konstanta SCHEMA_NAME,
    // dan warning wrong_schema_name harus muncul.
    expect(r.snapshot.schemaName).toBe(SCHEMA_NAME);
    expect(r.warnings.some((w) => w.code === "wrong_schema_name")).toBe(true);
  });

  it("legacy tanpa generatedAt tetap sukses tetapi menandai exportedAt hilang", () => {
    const p = legacyPayload();
    delete (p as Record<string, unknown>).generatedAt;
    const r = normalizeSnapshot(p);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.exportedAt).toBeNull();
    expect(
      r.warnings.some(
        (w) => w.code === "missing_field" && /exportedAt/.test(w.detail),
      ),
    ).toBe(true);
    expect(
      r.fieldIssues.some((i) => i.path === "exportedAt" && i.code === "missing"),
    ).toBe(true);
  });

  it("legacy dengan bagian utama hilang menghasilkan fieldIssues missing", () => {
    const r = normalizeSnapshot({ generatedAt: "2024-05-01T10:00:00.000Z" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const paths = r.fieldIssues.map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "permission",
        "frame",
        "serviceWorker",
        "pushSubscription",
      ]),
    );
    // Migrasi tetap dijalankan
    expect(r.appliedMigrations).toHaveLength(1);
  });

  it("legacy dengan permission.state invalid menghasilkan invalid_enum", () => {
    const r = normalizeSnapshot(
      legacyPayload({ permission: { state: "maybe" } }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(
      r.fieldIssues.some(
        (i) => i.path === "permission.state" && i.code === "invalid_enum",
      ),
    ).toBe(true);
  });

  it("legacy dengan frame.inIframe bertipe salah menghasilkan wrong_type", () => {
    const r = normalizeSnapshot(
      legacyPayload({ frame: { inIframe: "false" } }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(
      r.fieldIssues.some(
        (i) => i.path === "frame.inIframe" && i.code === "wrong_type",
      ),
    ).toBe(true);
  });

  it("legacy field tak dikenal masuk snapshot.extra & unknownTopLevelFields (mode forward)", () => {
    // Catatan: untuk sumber < current, unknown_field_preserved TIDAK
    // di-warn (hanya di backward_partial), tetapi field tetap disimpan.
    const r = normalizeSnapshot(
      legacyPayload({ customTelemetry: { hits: 3 } }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.extra).toEqual({ customTelemetry: { hits: 3 } });
    expect(r.compatibility.unknownTopLevelFields).toContain("customTelemetry");
  });
});

describe("normalizeSnapshot — v1 exact (tanpa migrasi)", () => {
  it("tidak menjalankan migrasi apapun & mode=exact", () => {
    const r = normalizeSnapshot(v1Payload());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sourceVersion).toBe(1);
    expect(r.appliedMigrations).toEqual([]);
    expect(r.compatibility.mode).toBe("exact");
    expect(r.warnings.some((w) => w.code === "legacy_no_schema_version")).toBe(
      false,
    );
    expect(r.warnings.some((w) => w.code === "migrated")).toBe(false);
  });
});

describe("normalizeSnapshot — schemaVersion invalid", () => {
  it("schemaVersion bertipe string dikembalikan sebagai error", () => {
    const r = normalizeSnapshot({ schemaVersion: "1" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/schemaVersion/);
  });

  it("schemaVersion masa depan → backward_partial dengan future warnings", () => {
    const r = normalizeSnapshot(
      v1Payload({ schemaVersion: 99, futureThing: { a: 1 } }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.compatibility.mode).toBe("backward_partial");
    expect(r.compatibility.versionGap).toBeGreaterThan(0);
    const codes = r.warnings.map((w) => w.code);
    expect(codes).toContain("future_schema_version");
    expect(codes).toContain("future_partial_migration");
    expect(codes).toContain("unknown_field_preserved");
    expect(r.snapshot.extra).toEqual({ futureThing: { a: 1 } });
  });
});

describe("parseSnapshotText", () => {
  it("menolak JSON invalid dengan error yang jelas", () => {
    const r = parseSnapshotText("{not json");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/JSON tidak valid/);
  });

  it("menolak JSON yang bukan object", () => {
    const r = parseSnapshotText("[]");
    expect(r.ok).toBe(false);
  });

  it("legacy JSON string round-trip berhasil migrasi ke v1", () => {
    const text = JSON.stringify(legacyPayload());
    const r = parseSnapshotText(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.schemaVersion).toBe(1);
    expect(r.snapshot.exportedAt).toBe("2024-05-01T10:00:00.000Z");
  });
});
