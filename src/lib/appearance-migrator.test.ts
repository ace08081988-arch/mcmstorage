import { describe, it, expect } from "vitest";
import {
  migrateImportedAppearance,
  EXPORT_SCHEMA_VERSION,
} from "./appearance-migrator";
import {
  CURRENT_DEFAULT,
  FIXTURE_V1,
  FIXTURE_V1_NO_VERSION,
  FIXTURE_V2,
  FIXTURE_V3_FUTURE,
  FIXTURE_UNKNOWN_TYPE,
  FIXTURE_INVALID_NOT_OBJECT,
  FIXTURE_INVALID_NULL,
  FIXTURE_INVALID_ARRAY,
} from "./appearance-migrator.fixtures";

describe("migrateImportedAppearance — backward compatibility", () => {
  describe("skema v1 (field di root)", () => {
    it("memuat semua field appearance dari root payload", () => {
      const res = migrateImportedAppearance(FIXTURE_V1, CURRENT_DEFAULT);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.fromVersion).toBe(1);
      expect(res.forward).toBe(false);
      expect(res.patch).toEqual({
        theme: "dark",
        font: "serif",
        size: "lg",
        accent: "emerald",
        radius: 0.875,
        bgImage: "https://example.com/bg-v1.jpg",
        bgOverlay: 0.6,
        bgBlur: 12,
        compact: true,
        fontScale: 1.1,
        highContrast: true,
        reduceMotion: false,
      });
    });

    it("default ke v1 ketika `version` maupun `schemaVersion` tidak ada", () => {
      const res = migrateImportedAppearance(
        FIXTURE_V1_NO_VERSION,
        CURRENT_DEFAULT,
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.fromVersion).toBe(1);
      expect(res.forward).toBe(false);
      expect(res.patch.theme).toBe("light");
      expect(res.patch.font).toBe("mono");
      expect(res.patch.reduceMotion).toBe(true);
    });

    it("mengonversi string numerik dari v1 menjadi number", () => {
      const res = migrateImportedAppearance(FIXTURE_V1, CURRENT_DEFAULT);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(typeof res.patch.radius).toBe("number");
      expect(typeof res.patch.bgOverlay).toBe("number");
      expect(typeof res.patch.bgBlur).toBe("number");
    });
  });

  describe("skema v2 (appearance/appPrefs bersarang)", () => {
    it("memuat semua field dari `appearance` dan `appPrefs`", () => {
      const res = migrateImportedAppearance(FIXTURE_V2, CURRENT_DEFAULT);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.fromVersion).toBe(2);
      expect(res.forward).toBe(false);
      expect(res.patch).toEqual({
        theme: "light",
        font: "display",
        size: "xl",
        accent: "rose",
        radius: 1.25,
        bgImage: "https://example.com/bg-v2.jpg",
        bgOverlay: 0.5,
        bgBlur: 20,
        compact: true,
        fontScale: 1.25,
        highContrast: true,
        reduceMotion: true,
      });
    });

    it("memakai `schemaVersion` lebih dulu daripada `version`", () => {
      const payload = { ...FIXTURE_V2, schemaVersion: 2, version: 1 };
      const res = migrateImportedAppearance(payload, CURRENT_DEFAULT);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.fromVersion).toBe(2);
    });
  });

  describe("skema versi lebih baru (forward-compatible)", () => {
    it("menandai `forward: true` dan mengabaikan field yang tidak dikenal", () => {
      const res = migrateImportedAppearance(FIXTURE_V3_FUTURE, CURRENT_DEFAULT);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.fromVersion).toBe(3);
      expect(res.fromVersion).toBeGreaterThan(EXPORT_SCHEMA_VERSION);
      expect(res.forward).toBe(true);
      expect(res.patch.theme).toBe("dark");
      expect(res.patch.accent).toBe("violet");
      expect(res.patch.fontScale).toBe(1.05);
      // Tidak ada field ekstra yang bocor ke patch.
      expect(Object.keys(res.patch).sort()).toEqual(
        [
          "accent",
          "bgBlur",
          "bgImage",
          "bgOverlay",
          "compact",
          "font",
          "fontScale",
          "highContrast",
          "radius",
          "reduceMotion",
          "size",
          "theme",
        ].sort(),
      );
    });
  });

  describe("fallback aman untuk field yang hilang / tidak valid", () => {
    it("mengembalikan nilai `current` untuk enum yang tidak valid", () => {
      const payload = {
        __type: "mcm.appearance-settings",
        schemaVersion: 2,
        appearance: {
          theme: "neon", // bukan enum valid
          font: 123, // salah tipe
          size: null,
          accent: 42, // salah tipe
        },
      };
      const res = migrateImportedAppearance(payload, CURRENT_DEFAULT);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.patch.theme).toBe(CURRENT_DEFAULT.theme);
      expect(res.patch.font).toBe(CURRENT_DEFAULT.font);
      expect(res.patch.size).toBe(CURRENT_DEFAULT.size);
      expect(res.patch.accent).toBe(CURRENT_DEFAULT.accent);
    });

    it("mengunci angka ke rentang yang diizinkan", () => {
      const payload = {
        __type: "mcm.appearance-settings",
        schemaVersion: 2,
        appearance: {
          radius: 99, // > 2 → dijepit ke 2
          bgOverlay: -1, // < 0 → dijepit ke 0
          bgBlur: 999, // > 40 → dijepit ke 40
        },
        appPrefs: {
          fontScale: 5, // > 1.5 → dijepit ke 1.5
        },
      };
      const res = migrateImportedAppearance(payload, CURRENT_DEFAULT);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.patch.radius).toBe(2);
      expect(res.patch.bgOverlay).toBe(0);
      expect(res.patch.bgBlur).toBe(40);
      expect(res.patch.fontScale).toBe(1.5);
    });

    it("payload minimum → hasilnya sama persis dengan `current`", () => {
      const res = migrateImportedAppearance(
        { __type: "mcm.appearance-settings", schemaVersion: 2 },
        CURRENT_DEFAULT,
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.patch).toEqual(CURRENT_DEFAULT);
    });
  });

  describe("penolakan payload yang tidak valid", () => {
    it("menolak file dari aplikasi lain dengan `unknown_type`", () => {
      const res = migrateImportedAppearance(
        FIXTURE_UNKNOWN_TYPE,
        CURRENT_DEFAULT,
      );
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("unknown_type");
    });

    it.each([
      ["string", FIXTURE_INVALID_NOT_OBJECT],
      ["null", FIXTURE_INVALID_NULL],
      ["array", FIXTURE_INVALID_ARRAY],
    ])("menolak payload %s dengan `invalid`", (_label, raw) => {
      const res = migrateImportedAppearance(raw, CURRENT_DEFAULT);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("invalid");
    });
  });

  describe("kontrak invarian untuk rilis berikutnya", () => {
    it("`current` tidak boleh dimutasi oleh migrator", () => {
      const snapshot = JSON.parse(JSON.stringify(CURRENT_DEFAULT));
      migrateImportedAppearance(FIXTURE_V1, CURRENT_DEFAULT);
      migrateImportedAppearance(FIXTURE_V2, CURRENT_DEFAULT);
      migrateImportedAppearance(FIXTURE_V3_FUTURE, CURRENT_DEFAULT);
      expect(CURRENT_DEFAULT).toEqual(snapshot);
    });

    it("bentuk `patch` selalu berisi 12 kunci yang sama untuk semua versi", () => {
      const expected = Object.keys(CURRENT_DEFAULT).sort();
      for (const fx of [FIXTURE_V1, FIXTURE_V1_NO_VERSION, FIXTURE_V2, FIXTURE_V3_FUTURE]) {
        const res = migrateImportedAppearance(fx, CURRENT_DEFAULT);
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(Object.keys(res.patch).sort()).toEqual(expected);
      }
    });
  });
});