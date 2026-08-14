import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");

const workflow = read(".github/workflows/mcm-storage-play-release.yml");
const debugWorkflow = read(".github/workflows/android-debug-apk.yml");
const manifest = read("android/app/src/main/AndroidManifest.xml");
const strings = read("android/app/src/main/res/values/strings.xml");

describe("invarian rilis Android tunggal MCM Storage", () => {
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

  it("workflow Play tidak menerima atau meneruskan varian", () => {
    expect(workflow).toContain("name: MCM Storage Play Release");
    expect(workflow).not.toMatch(/\bvariant\s*:|--variant|\bVARIANT\b|mcmstorage\.chat|privateconnect/i);
    expect(workflow).toContain("node scripts/build-aab.mjs");
    expect(workflow).toContain("mcm-storage-aab-${{ github.run_number }}");
    expect(workflow).toContain("GOOGLE_SERVICES_JSON_B64");
    expect(workflow).toContain("BUNDLETOOL_JAR");
    expect(workflow).toContain("sha256sum dist/aab/*.aab");
  });

  it("workflow debug juga hanya menghasilkan MCM Storage", () => {
    expect(debugWorkflow).not.toMatch(/\bvariant\s*:|--variant|\bVARIANT\b|mcmstorage\.chat|privateconnect/i);
    expect(debugWorkflow).toContain("mcm-storage-debug-apk-${{ github.run_number }}");
    expect(debugWorkflow).toContain("bunx tsc --noEmit");
  });

  it("resource native mengunci label dan custom scheme ke package Play", () => {
    expect(strings).toContain('<string name="app_name">MCM Storage</string>');
    expect(strings).toContain('<string name="custom_url_scheme">mcmstorage.app</string>');
    expect(strings).not.toMatch(/biz\.mcmstorage\.app|Ace Chat|Private Connect/i);
    expect(manifest).toContain('<data android:scheme="${applicationId}" />');
    expect(read("android/app/build.gradle")).toContain('applicationId "mcmstorage.app"');
  });

  it("komponen panggilan/bubble milik Private Connect tidak ikut", () => {
    for (const c of ["IncomingCallActivity", "ChatBubbleActivity", "CallForegroundService"]) {
      expect(manifest).not.toContain(c);
    }
    for (const perm of [
      "USE_FULL_SCREEN_INTENT",
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_MICROPHONE",
      "FOREGROUND_SERVICE_CAMERA",
      "FOREGROUND_SERVICE_PHONE_CALL",
      "SYSTEM_ALERT_WINDOW",
      "MANAGE_OWN_CALLS",
    ]) {
      expect(manifest).not.toContain(`<uses-permission android:name="android.permission.${perm}"`);
    }
    expect(manifest).not.toMatch(/biz\.mcmstorage\.chat|com\.mcm\.privateconnect/);
  });

  it("semua script rilis menolak konsep varian lama secara struktural", () => {
    for (const path of [
      "scripts/build-aab.mjs",
      "scripts/build-apk.mjs",
      "scripts/aab-to-apk.mjs",
      "scripts/install-apk.mjs",
      "scripts/upload-play.mjs",
    ]) {
      expect(read(path), path).not.toMatch(/--variant|\bvariant\b|mcmstorage\.chat/i);
    }
  });

  it("preflight memverifikasi package, label, scheme, Firebase, SDK, dan AAB", () => {
    const p = read("scripts/preflight-release.mjs");
    expect(p).toContain('appId === "mcmstorage.app"');
    expect(p).toContain('label === "MCM Storage"');
    expect(p).toContain('scheme === "mcmstorage.app"');
    expect(p).toContain('pkgs.length !== 1 || pkgs[0] !== "mcmstorage.app"');
    expect(p).toContain("target >= 36");
    expect(p).toContain("BUNDLETOOL_JAR");
    expect(p).toContain('android:debuggable="true"');
  });

  it("workflow rilis Play manual-only dan terkunci ke Internal testing", () => {
    expect(workflow).toContain("workflow_dispatch:");
    // tidak ada trigger otomatis yang bisa memakai kredensial signing/Play
    expect(workflow).not.toMatch(/^\s{2}push:/m);
    expect(workflow).not.toMatch(/^\s{2}pull_request:/m);
    expect(workflow).toMatch(/options:\s*\[internal\]/);
    expect(workflow).not.toMatch(/production/);
    // upload hanya lewat langkah terpisah setelah verifikasi artefak
    expect(workflow).toContain("node scripts/upload-play.mjs");
  });

  it("kontrak nama secrets seragam di workflow rilis", () => {
    for (const secret of [
      "KEYSTORE_BASE64",
      "KEYSTORE_ALIAS",
      "KEYSTORE_STORE_PASSWORD",
      "KEYSTORE_KEY_PASSWORD",
      "GOOGLE_SERVICES_JSON_B64",
      "PLAY_SERVICE_ACCOUNT_JSON_B64",
    ]) {
      expect(workflow, secret).toContain(secret);
    }
    for (const legacy of [
      "MCM_STORAGE_KEYSTORE_FILE",
      "MCM_STORAGE_STORE_PASS",
      "ANDROID_KEYSTORE_BASE64",
      "ANDROID_KEY_PASSWORD",
    ]) {
      expect(workflow, legacy).not.toContain(legacy);
      expect(read(".github/workflows/android-apk.yml"), legacy).not.toContain(legacy);
      expect(read("RELEASE_CHECKLIST.md"), legacy).not.toContain(legacy);
    }
  });

  it("upload-play hanya mengizinkan track internal", () => {
    const u = read("scripts/upload-play.mjs");
    expect(u).toContain('const VALID_TRACKS = ["internal"];');
    expect(u).toContain('packageName !== "mcmstorage.app"');
  });

  it("CI push Android tidak memegang kredensial apa pun", () => {
    const ci = read(".github/workflows/mcm-storage-android-ci.yml");
    expect(ci).toContain("push:");
    expect(ci).not.toMatch(/secrets\./);
  });
});
