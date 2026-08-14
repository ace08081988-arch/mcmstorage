import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, posix, sep } from "node:path";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");

/**
 * Parser struktural minimal (tanpa dependency YAML) untuk workflow GitHub:
 * mengembalikan key top-level dan anak langsung dari sebuah blok top-level.
 */
const topLevelKeys = (yml: string) => [...yml.matchAll(/^([A-Za-z_][\w-]*):/gm)].map((m) => m[1]);

const childKeysOf = (yml: string, key: string) => {
  const lines = yml.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^[A-Za-z_][\w-]*:/.test(line)) break; // blok top-level berikutnya
    const m = /^ {2}([A-Za-z_][\w-]*):/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
};

/**
 * Pencarian repo murni Node (portable lokal/CI, tanpa executable eksternal).
 * - Direktori yang dilewati: VCS, dependency, dan output build.
 * - Ekstensi biner dilewati.
 * - File yang tidak terbaca dilaporkan sebagai error, bukan ditelan.
 */
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".output",
  ".nitro",
  ".vinxi",
  ".vite",
  "coverage",
  "test-artifacts",
  "playwright-report",
  "test-results",
  ".gradle",
  ".idea",
  ".next",
  ".cache",
]);

const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|avif|ico|icns|svgz|pdf|zip|gz|tgz|bz2|xz|7z|jar|aar|aab|apk|keystore|jks|so|dll|dylib|exe|bin|class|dex|woff2?|ttf|otf|eot|mp[34]|mov|mp4|webm|wav|ogg|lockb|node)$/i;

const listRepoFiles = (dir = ".", acc: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = dir === "." ? entry.name : `${dir}${sep}${entry.name}`;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      listRepoFiles(rel, acc);
    } else if (entry.isFile()) {
      if (BINARY_EXT.test(entry.name)) continue;
      acc.push(rel.split(sep).join(posix.sep));
    }
  }
  return acc;
};

/** Cari file yang cocok pattern. `exclude` = path relatif (posix) atau "*.ext". */
const searchFiles = (pattern: string, exclude: string[]) => {
  const re = new RegExp(pattern);
  const excludedExt = exclude
    .filter((e) => e.startsWith("*."))
    .map((e) => e.slice(1).toLowerCase());
  const excludedPaths = new Set(exclude.filter((e) => !e.startsWith("*.")).map((e) => e.toLowerCase()));
  const hits: string[] = [];
  for (const file of listRepoFiles()) {
    const lower = file.toLowerCase();
    if (excludedPaths.has(lower)) continue;
    if (excludedExt.some((ext) => lower.endsWith(ext))) continue;
    let content: string;
    try {
      content = readFileSync(join(...file.split(posix.sep)), "utf8");
    } catch (err) {
      throw new Error(`gagal membaca ${file}: ${(err as Error).message}`);
    }
    if (content.includes("\u0000")) continue; // biner tak berekstensi
    if (re.test(content)) hits.push(file);
  }
  return hits;
};

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
    expect(workflow).not.toMatch(
      /\bvariant\s*:|--variant|\bVARIANT\b|mcmstorage\.chat|privateconnect/i,
    );
    expect(workflow).toContain("node scripts/build-aab.mjs");
    expect(workflow).toContain("mcm-storage-aab-${{ github.run_number }}");
    expect(workflow).toContain("GOOGLE_SERVICES_JSON_B64");
    expect(workflow).toContain("BUNDLETOOL_JAR");
    expect(workflow).toContain("sha256sum dist/aab/*.aab");
  });

  it("workflow debug juga hanya menghasilkan MCM Storage", () => {
    expect(debugWorkflow).not.toMatch(
      /\bvariant\s*:|--variant|\bVARIANT\b|mcmstorage\.chat|privateconnect/i,
    );
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
    // struktural: satu-satunya trigger adalah workflow_dispatch
    expect(childKeysOf(workflow, "on")).toEqual(["workflow_dispatch"]);
    expect(topLevelKeys(workflow)).not.toContain("push");
    expect(topLevelKeys(workflow)).not.toContain("pull_request");
    expect(workflow).toMatch(/options:\s*\[internal\]/);
    // upload hanya lewat langkah terpisah setelah verifikasi artefak
    expect(workflow).toContain("node scripts/upload-play.mjs");
  });

  it("tidak ada track/option/status production secara struktural (komentar boleh)", () => {
    const code = workflow
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .map((l) => l.replace(/\s#.*$/, ""))
      .join("\n");
    expect(code).not.toMatch(/options:\s*\[[^\]]*production/);
    expect(code).not.toMatch(/^\s*-\s*production\s*$/m);
    expect(code).not.toMatch(/--track\s+production|track:\s*production/);
    // upload di-hardcode ke internal
    expect(code).toContain("--track internal");
    // manual-only: tidak ada percabangan berbasis event push
    expect(code).not.toContain("github.event_name");
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

  it("nama secret final dipakai seragam di seluruh repo (source, workflow, docs)", () => {
    const self = "tests/integration/android-package-separation.test.ts";
    const legacy = [
      "KEYSTORE_STORE_" + "PASS",
      "KEYSTORE_KEY_" + "PASS",
      "MCM_STORAGE_" + "KEYSTORE_FILE",
      "MCM_STORAGE_" + "STORE_PASS",
      "ANDROID_" + "KEYSTORE_BASE64",
      "ANDROID_" + "KEY_PASSWORD",
    ];
    for (const name of legacy) {
      const hits = rgFiles(`${name}\\b`, [self]);
      expect(hits, `${name} masih dipakai di: ${hits.join(", ")}`).toEqual([]);
    }
  });

  it("tidak ada sisa package chat / private connect di repo", () => {
    const self = "tests/integration/android-package-separation.test.ts";
    const hits = rgFiles("biz\\.mcmstorage\\.chat|com\\.mcm\\.privateconnect", [self, "*.md"]);
    // Referensi yang boleh tersisa hanya: komentar penjelas, atau daftar
    // package TERLARANG di preflight (justru penjaga pemisahan).
    const offending: string[] = [];
    for (const file of hits) {
      const lines = read(file.replace(/^\.\//, "")).split("\n");
      lines.forEach((line, i) => {
        if (!/biz\.mcmstorage\.chat|com\.mcm\.privateconnect/.test(line)) return;
        const isComment = /^\s*(\/\/|\/\*|\*|#)/.test(line);
        const isForbiddenListEntry =
          /^\s*"(biz\.mcmstorage\.chat|com\.mcm\.privateconnect)",?\s*$/.test(line);
        if (!isComment && !isForbiddenListEntry) offending.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offending, `referensi aktif: ${offending.join(" | ")}`).toEqual([]);
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
