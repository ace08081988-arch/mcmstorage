import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");

describe("pemisahan APK MCM Storage vs MCM: Private Connect", () => {
  it("Gradle applicationId hanya mcmstorage.app", () => {
    const g = read("android/app/build.gradle");
    const ids = [...g.matchAll(/applicationId\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(ids).toEqual(["mcmstorage.app"]);
  });

  it("capacitor.config.ts terkunci ke mcmstorage.app / MCM Storage", () => {
    const c = read("capacitor.config.ts");
    expect(c).toContain('appId: "mcmstorage.app"');
    expect(c).toContain('appName: "MCM Storage"');
    expect(c).not.toMatch(/APP_VARIANT|mcmstorage\.chat/);
  });

  it("tidak ada package chat di manifest/gradle/workflow/scripts", () => {
    const out = execSync(
      "grep -rl 'biz.mcmstorage.chat\\|com.mcm.privateconnect' android .github scripts package.json capacitor.config.ts 2>/dev/null || true",
      { encoding: "utf8" },
    ).trim();
    expect(out).toBe("");
  });

  it("resource native tidak memakai label app lain", () => {
    const xml = read("android/app/src/main/res/values/strings.xml");
    expect(xml).toContain("<string name=\"app_name\">MCM Storage</string>");
    expect(xml).not.toMatch(/Ace Chat|Private Connect/i);
  });

  it("komponen panggilan/bubble milik Private Connect tidak ikut", () => {
    const m = read("android/app/src/main/AndroidManifest.xml");
    for (const c of ["IncomingCallActivity", "ChatBubbleActivity", "CallForegroundService"]) {
      expect(m).not.toContain(c);
    }
    for (const perm of ["USE_FULL_SCREEN_INTENT", "SYSTEM_ALERT_WINDOW", "MANAGE_OWN_CALLS"]) {
      expect(m).not.toContain(`<uses-permission android:name="android.permission.${perm}"`);
    }
  });
});
