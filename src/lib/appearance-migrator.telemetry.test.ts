import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  logAppearanceMigration,
  APPEARANCE_MIGRATION_EVENT,
  type AppearanceMigrationEvent,
} from "./appearance-migrator.telemetry";
import {
  migrateImportedAppearance,
  EXPORT_SCHEMA_VERSION,
  type MigrateResult,
} from "./appearance-migrator";
import {
  CURRENT_DEFAULT,
  FIXTURE_V1,
  FIXTURE_V2,
  FIXTURE_V3_FUTURE,
  FIXTURE_UNKNOWN_TYPE,
} from "./appearance-migrator.fixtures";

describe("logAppearanceMigration · telemetri migrasi skema", () => {
  let info: ReturnType<typeof vi.spyOn>;
  let received: AppearanceMigrationEvent[] = [];
  const listener = (e: Event) => {
    received.push((e as CustomEvent<AppearanceMigrationEvent>).detail);
  };

  beforeEach(() => {
    received = [];
    info = vi.spyOn(console, "info").mockImplementation(() => {});
    window.addEventListener(APPEARANCE_MIGRATION_EVENT, listener);
  });
  afterEach(() => {
    window.removeEventListener(APPEARANCE_MIGRATION_EVENT, listener);
    info.mockRestore();
  });

  it("mencatat fromVersion=1 & toVersion=target untuk payload v1", () => {
    const res = migrateImportedAppearance(FIXTURE_V1, CURRENT_DEFAULT);
    const ev = logAppearanceMigration("file", res);
    expect(ev.outcome).toBe("ok");
    expect(ev.fromVersion).toBe(1);
    expect(ev.toVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(ev.forward).toBe(false);
    expect(ev.source).toBe("file");
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(ev);
    // Format satu baris JSON dengan prefix agar mudah difilter.
    expect(info).toHaveBeenCalledOnce();
    const line = String(info.mock.calls[0]?.[0] ?? "");
    expect(line.startsWith("[appearance-migrator] ")).toBe(true);
    expect(JSON.parse(line.slice("[appearance-migrator] ".length))).toEqual(ev);
  });

  it("mencatat fromVersion=2 untuk payload v2", () => {
    const res = migrateImportedAppearance(FIXTURE_V2, CURRENT_DEFAULT);
    const ev = logAppearanceMigration("paste", res);
    expect(ev.outcome).toBe("ok");
    expect(ev.fromVersion).toBe(2);
    expect(ev.forward).toBe(false);
    expect(ev.source).toBe("paste");
  });

  it("menandai `forward: true` untuk skema versi lebih baru", () => {
    const res = migrateImportedAppearance(FIXTURE_V3_FUTURE, CURRENT_DEFAULT);
    const ev = logAppearanceMigration("url", res);
    expect(ev.outcome).toBe("ok");
    expect(ev.fromVersion).toBe(3);
    expect(ev.forward).toBe(true);
    expect(ev.toVersion).toBeLessThan(ev.fromVersion!);
    expect(ev.source).toBe("url");
  });

  it("mencatat outcome `unknown_type` untuk payload dari aplikasi lain", () => {
    const res = migrateImportedAppearance(FIXTURE_UNKNOWN_TYPE, CURRENT_DEFAULT);
    const ev = logAppearanceMigration("file", res);
    expect(ev.outcome).toBe("unknown_type");
    expect(ev.fromVersion).toBeNull();
    expect(ev.forward).toBe(false);
    expect(received[0]?.outcome).toBe("unknown_type");
  });

  it("mencatat outcome `invalid` untuk payload yang ditolak", () => {
    const res: MigrateResult = { ok: false, reason: "invalid" };
    const ev = logAppearanceMigration("paste", res);
    expect(ev.outcome).toBe("invalid");
    expect(ev.fromVersion).toBeNull();
    expect(received[0]?.outcome).toBe("invalid");
  });

  it("menuliskan timestamp ISO yang valid", () => {
    const res = migrateImportedAppearance(FIXTURE_V1, CURRENT_DEFAULT);
    const ev = logAppearanceMigration("file", res);
    expect(() => new Date(ev.at).toISOString()).not.toThrow();
    expect(new Date(ev.at).toISOString()).toBe(ev.at);
  });
});