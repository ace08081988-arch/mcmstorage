import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyPreviewOverrideFromHash,
  encodePreviewConfigHash,
  setPreviewOverrideTelemetry,
  WORKER_PORTAL_DEFAULTS,
  type PreviewOverrideTelemetryEvent,
  type WorkerPortalConfig,
} from "./worker-portal-config";

/**
 * Vitest env = node → kita sediakan stub `window` + `atob` minimal
 * supaya `applyPreviewOverrideFromHash()` (yang murni client-side)
 * dapat dijalankan tanpa jsdom.
 */

type WinLike = {
  location: { hash: string };
  __WORKER_PORTAL_CONFIG__?: Partial<WorkerPortalConfig>;
};

const g = globalThis as unknown as {
  window?: WinLike;
  atob?: (s: string) => string;
};

function b64url(json: string): string {
  return Buffer.from(json, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function setHash(payload: unknown) {
  const json = JSON.stringify(payload);
  g.window!.location.hash = `#wpcfg=${b64url(json)}`;
}

beforeEach(() => {
  g.window = { location: { hash: "" } };
  g.atob = (s: string) => Buffer.from(s, "base64").toString("utf8");
});

afterEach(() => {
  delete g.window;
  delete g.atob;
  setPreviewOverrideTelemetry(null);
});

describe("applyPreviewOverrideFromHash · sanitasi nilai ekstrem", () => {
  it("menolak sessionTtlMs negatif & melebihi 24 jam", () => {
    setHash({ sessionTtlMs: -1, maxAttempts: 3, lockSeconds: 30 });
    const applied = applyPreviewOverrideFromHash();
    expect(applied).toEqual({ maxAttempts: 3, lockSeconds: 30 });
    expect(g.window!.__WORKER_PORTAL_CONFIG__).toEqual({
      maxAttempts: 3,
      lockSeconds: 30,
    });

    setHash({ sessionTtlMs: 7 * 24 * 60 * 60 * 1000 });
    g.window!.__WORKER_PORTAL_CONFIG__ = {};
    const applied2 = applyPreviewOverrideFromHash();
    expect(applied2).toEqual({});
    expect(g.window!.__WORKER_PORTAL_CONFIG__).toEqual({});
  });

  it("menolak maxAttempts < 1 dan > 10", () => {
    setHash({ maxAttempts: 0 });
    expect(applyPreviewOverrideFromHash()).toEqual({});
    setHash({ maxAttempts: 999 });
    expect(applyPreviewOverrideFromHash()).toEqual({});
    setHash({ maxAttempts: 10 });
    expect(applyPreviewOverrideFromHash()).toEqual({ maxAttempts: 10 });
  });

  it("menolak lockSeconds < 5 dan > 3600", () => {
    setHash({ lockSeconds: 0 });
    expect(applyPreviewOverrideFromHash()).toEqual({});
    setHash({ lockSeconds: 99_999 });
    expect(applyPreviewOverrideFromHash()).toEqual({});
    setHash({ lockSeconds: 5 });
    expect(applyPreviewOverrideFromHash()).toEqual({ lockSeconds: 5 });
    setHash({ lockSeconds: 3600 });
    expect(applyPreviewOverrideFromHash()).toEqual({ lockSeconds: 3600 });
  });

  it("menolak nilai non-finite (NaN, Infinity, string, null)", () => {
    setHash({
      sessionTtlMs: "30m",
      maxAttempts: null,
      lockSeconds: Number.POSITIVE_INFINITY,
      lagThresholdSec: Number.NaN,
    });
    expect(applyPreviewOverrideFromHash()).toEqual({});
    expect(g.window!.__WORKER_PORTAL_CONFIG__).toEqual({});
  });

  it("menggabungkan dengan override runtime sebelumnya, tidak menimpa total", () => {
    g.window!.__WORKER_PORTAL_CONFIG__ = { sessionTtlMs: 5 * 60_000 };
    setHash({ maxAttempts: 4, lockSeconds: 999_999 /* dibuang */ });
    const applied = applyPreviewOverrideFromHash();
    expect(applied).toEqual({ maxAttempts: 4 });
    expect(g.window!.__WORKER_PORTAL_CONFIG__).toEqual({
      sessionTtlMs: 5 * 60_000,
      maxAttempts: 4,
    });
  });

  it("payload bukan base64-JSON → return null, tidak menyentuh override", () => {
    g.window!.__WORKER_PORTAL_CONFIG__ = { maxAttempts: 7 };
    g.window!.location.hash = "#wpcfg=$$bukan-base64$$";
    expect(applyPreviewOverrideFromHash()).toBeNull();
    expect(g.window!.__WORKER_PORTAL_CONFIG__).toEqual({ maxAttempts: 7 });
  });

  it("tanpa fragment #wpcfg → no-op", () => {
    g.window!.location.hash = "";
    expect(applyPreviewOverrideFromHash()).toBeNull();
    g.window!.location.hash = "#section";
    expect(applyPreviewOverrideFromHash()).toBeNull();
  });

  it("nilai valid di seluruh field tetap diterapkan (round-trip encode/decode)", () => {
    const cfg: Partial<WorkerPortalConfig> = {
      sessionTtlMs: 20 * 60_000,
      maxAttempts: 4,
      lockSeconds: 90,
      silentFailTolerance: 3,
      lagThresholdSec: 45,
      staleThresholdSec: 120,
      lagCooldownMs: 8_000,
      staleCooldownBaseMs: 4_000,
      staleCooldownMaxMs: 20_000,
    };
    g.window!.location.hash = encodePreviewConfigHash(cfg);
    const applied = applyPreviewOverrideFromHash();
    expect(applied).toEqual(cfg);
    expect(g.window!.__WORKER_PORTAL_CONFIG__).toEqual(cfg);
    // Default tetap tersedia untuk field yang tidak dioverride
    expect(WORKER_PORTAL_DEFAULTS.sessionTtlMs).toBeGreaterThan(0);
  });
});

describe("applyPreviewOverrideFromHash · variasi format #wpcfg", () => {
  const validCfg = { maxAttempts: 4, lockSeconds: 30 };
  const validJson = JSON.stringify(validCfg);
  const stdB64 = Buffer.from(validJson, "utf8").toString("base64"); // dgn '=' padding
  const b64UrlNoPad = stdB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const b64UrlWithPad = stdB64.replace(/\+/g, "-").replace(/\//g, "_"); // padding masih '='

  it("base64url tanpa padding diterapkan dengan benar", () => {
    g.window!.location.hash = `#wpcfg=${b64UrlNoPad}`;
    expect(applyPreviewOverrideFromHash()).toEqual(validCfg);
    expect(g.window!.__WORKER_PORTAL_CONFIG__).toEqual(validCfg);
  });

  it("base64url dengan padding '=' percent-encoded juga diterima", () => {
    const encoded = encodeURIComponent(b64UrlWithPad); // '=' → '%3D'
    g.window!.location.hash = `#wpcfg=${encoded}`;
    expect(applyPreviewOverrideFromHash()).toEqual(validCfg);
  });

  it("base64 standar (dengan '+' / '/' / '=') tetap di-decode via normalisasi", () => {
    // Payload yg memunculkan '+' atau '/' jarang muncul utk JSON pendek;
    // di sini cukup verifikasi padding '=' standar.
    g.window!.location.hash = `#wpcfg=${encodeURIComponent(stdB64)}`;
    expect(applyPreviewOverrideFromHash()).toEqual(validCfg);
  });

  it("padding salah (kelebihan '=') ditoleransi decoder dan tetap di-sanitasi", () => {
    g.window!.location.hash = `#wpcfg=${encodeURIComponent(stdB64 + "===")}`;
    expect(applyPreviewOverrideFromHash()).toEqual(validCfg);
    expect(g.window!.__WORKER_PORTAL_CONFIG__).toEqual(validCfg);
  });

  it("whitespace di tengah payload ditoleransi decoder dan tetap di-sanitasi", () => {
    const withSpace = b64UrlNoPad.slice(0, 4) + " " + b64UrlNoPad.slice(4);
    g.window!.location.hash = `#wpcfg=${encodeURIComponent(withSpace)}`;
    expect(applyPreviewOverrideFromHash()).toEqual(validCfg);
    expect(g.window!.__WORKER_PORTAL_CONFIG__).toEqual(validCfg);
  });

  it("newline / tab di akhir payload ditoleransi decoder", () => {
    g.window!.location.hash = `#wpcfg=${encodeURIComponent(b64UrlNoPad + "\n\t")}`;
    expect(applyPreviewOverrideFromHash()).toEqual(validCfg);
    expect(g.window!.__WORKER_PORTAL_CONFIG__).toEqual(validCfg);
  });

  it("karakter di luar alfabet base64 → no-op aman", () => {
    g.window!.location.hash = `#wpcfg=${encodeURIComponent("!!!@@@")}`;
    expect(applyPreviewOverrideFromHash()).toBeNull();
    expect(g.window!.__WORKER_PORTAL_CONFIG__).toBeUndefined();
  });

  it("#wpcfg= kosong → no-op aman", () => {
    g.window!.location.hash = `#wpcfg=`;
    expect(applyPreviewOverrideFromHash()).toBeNull();
    expect(g.window!.__WORKER_PORTAL_CONFIG__).toBeUndefined();
  });

  it("base64 valid tapi bukan JSON → no-op aman", () => {
    const notJson = Buffer.from("halo dunia", "utf8")
      .toString("base64")
      .replace(/=+$/, "");
    g.window!.location.hash = `#wpcfg=${notJson}`;
    expect(applyPreviewOverrideFromHash()).toBeNull();
    expect(g.window!.__WORKER_PORTAL_CONFIG__).toBeUndefined();
  });

  it("JSON array (bukan object) → sanitasi jadi {}, tidak mencemari override", () => {
    const arr = Buffer.from(JSON.stringify([1, 2, 3]), "utf8")
      .toString("base64")
      .replace(/=+$/, "");
    g.window!.location.hash = `#wpcfg=${arr}`;
    expect(applyPreviewOverrideFromHash()).toEqual({});
    expect(g.window!.__WORKER_PORTAL_CONFIG__).toEqual({});
  });

  it("muncul sebagai parameter kedua (#foo&wpcfg=...) tetap dikenali", () => {
    g.window!.location.hash = `#foo=bar&wpcfg=${b64UrlNoPad}`;
    expect(applyPreviewOverrideFromHash()).toEqual(validCfg);
    expect(g.window!.__WORKER_PORTAL_CONFIG__).toEqual(validCfg);
  });

  it("nilai out-of-range di payload base64url tanpa padding disaring", () => {
    const ext = Buffer.from(
      JSON.stringify({ maxAttempts: 999, lockSeconds: 60 }),
      "utf8",
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    g.window!.location.hash = `#wpcfg=${ext}`;
    expect(applyPreviewOverrideFromHash()).toEqual({ lockSeconds: 60 });
    expect(g.window!.__WORKER_PORTAL_CONFIG__).toEqual({ lockSeconds: 60 });
  });
});