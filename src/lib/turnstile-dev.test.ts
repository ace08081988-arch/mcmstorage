import { describe, it, expect } from "vitest";
import {
  DEV_TURNSTILE_TOKEN,
  shouldAllowTurnstileDevBypass,
} from "./turnstile-dev";

const LOOPBACK_IPS = ["127.0.0.1", "::1", "0.0.0.0", "::ffff:127.0.0.1"];
const NON_LOOPBACK_IPS = [
  "1.2.3.4",
  "8.8.8.8",
  "192.168.1.10",
  "10.0.0.1",
  "2001:db8::1",
  "",
];
const NON_PROD_ENVS = ["development", "test", "staging", "preview"];

describe("shouldAllowTurnstileDevBypass", () => {
  describe("lolos hanya bila semua syarat terpenuhi", () => {
    for (const ip of LOOPBACK_IPS) {
      for (const env of NON_PROD_ENVS) {
        it(`ip=${ip}, env=${env}, token=dev-bypass → true`, () => {
          expect(
            shouldAllowTurnstileDevBypass(ip, env, DEV_TURNSTILE_TOKEN),
          ).toBe(true);
        });
      }
    }
  });

  describe("tolak bila IP bukan loopback", () => {
    for (const ip of NON_LOOPBACK_IPS) {
      it(`ip=${ip || "<empty>"} → false`, () => {
        expect(
          shouldAllowTurnstileDevBypass(ip, "development", DEV_TURNSTILE_TOKEN),
        ).toBe(false);
      });
    }
  });

  describe("tolak bila NODE_ENV=production", () => {
    for (const ip of LOOPBACK_IPS) {
      it(`ip=${ip} + env=production → false`, () => {
        expect(
          shouldAllowTurnstileDevBypass(ip, "production", DEV_TURNSTILE_TOKEN),
        ).toBe(false);
      });
    }
  });

  describe("tolak bila token bukan dev-bypass", () => {
    const badTokens = [
      "",
      "wrong-token",
      "DEV-BYPASS",
      " dev-bypass",
      "dev-bypass ",
      "cf-real-turnstile-token-xxx",
    ];
    for (const token of badTokens) {
      it(`token=${JSON.stringify(token)} → false`, () => {
        expect(
          shouldAllowTurnstileDevBypass("127.0.0.1", "development", token),
        ).toBe(false);
      });
    }
  });

  describe("tolak bila input null/undefined", () => {
    it("ip=null → false", () => {
      expect(
        shouldAllowTurnstileDevBypass(null, "development", DEV_TURNSTILE_TOKEN),
      ).toBe(false);
    });
    it("nodeEnv=undefined → false", () => {
      expect(
        shouldAllowTurnstileDevBypass("127.0.0.1", undefined, DEV_TURNSTILE_TOKEN),
      ).toBe(false);
    });
    it("token=null → false", () => {
      expect(
        shouldAllowTurnstileDevBypass("127.0.0.1", "development", null),
      ).toBe(false);
    });
  });

  describe("kombinasi hostile: dua syarat terpenuhi tidak cukup", () => {
    it("loopback IP + prod + token benar → false", () => {
      expect(
        shouldAllowTurnstileDevBypass("127.0.0.1", "production", DEV_TURNSTILE_TOKEN),
      ).toBe(false);
    });
    it("loopback IP + dev + token salah → false", () => {
      expect(
        shouldAllowTurnstileDevBypass("127.0.0.1", "development", "attacker-token"),
      ).toBe(false);
    });
    it("public IP + dev + token benar → false", () => {
      expect(
        shouldAllowTurnstileDevBypass("8.8.8.8", "development", DEV_TURNSTILE_TOKEN),
      ).toBe(false);
    });
  });
});