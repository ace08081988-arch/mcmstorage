#!/usr/bin/env node
/**
 * Runner untuk project Playwright `appearance-import-migrator-e2e`.
 *
 * Tujuannya adalah menghilangkan friksi "Executable doesn't exist" /
 * "Host system is missing dependencies" / "browserType.launch: version
 * mismatch" saat spec dijalankan di sandbox / mesin dev yang:
 *   - tidak boleh `playwright install`, atau
 *   - sudah punya Chromium/Chrome sistem dengan versi berbeda dari yang
 *     dibundel `@playwright/test`.
 *
 * Urutan resolusi executable:
 *   1. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` env (dipakai apa adanya).
 *   2. `CHROMIUM_PATH` env (alias, back-compat).
 *   3. `PLAYWRIGHT_CHANNEL` env → dipakai lewat `channel`
 *      (mis. `chrome`, `msedge`, `chromium`).
 *   4. Auto-detect binary umum: `chromium`, `chromium-browser`,
 *      `google-chrome-stable`, `google-chrome`, `microsoft-edge`.
 *   5. Terakhir, biarkan Playwright memakai Chromium bawaannya.
 *
 * Kalau tidak satu pun berhasil, script mencetak instruksi remedi
 * (set env atau jalankan `npx playwright install chromium`) dan keluar
 * dengan status yang jelas — bukan crash dengan stacktrace binary yang
 * membingungkan.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const CANDIDATES = [
  "chromium",
  "chromium-browser",
  "google-chrome-stable",
  "google-chrome",
  "microsoft-edge",
];

function which(bin) {
  const r = spawnSync("which", [bin], { encoding: "utf8" });
  if (r.status === 0) {
    const path = r.stdout.trim();
    if (path && existsSync(path)) return path;
  }
  return null;
}

function resolveExecutable() {
  const envPath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.CHROMIUM_PATH;
  if (envPath) {
    if (!existsSync(envPath)) {
      console.error(
        `[appearance-e2e] PLAYWRIGHT_CHROMIUM_EXECUTABLE menunjuk ke path yang tidak ada: ${envPath}`,
      );
      process.exit(2);
    }
    return { kind: "path", value: envPath };
  }
  if (process.env.PLAYWRIGHT_CHANNEL) {
    return { kind: "channel", value: process.env.PLAYWRIGHT_CHANNEL };
  }
  for (const bin of CANDIDATES) {
    const path = which(bin);
    if (path) return { kind: "path", value: path };
  }
  return { kind: "bundled", value: null };
}

const resolved = resolveExecutable();
const env = { ...process.env };

if (resolved.kind === "path") {
  env.PLAYWRIGHT_CHROMIUM_EXECUTABLE = resolved.value;
  console.log(
    `[appearance-e2e] pakai executablePath: ${resolved.value}`,
  );
} else if (resolved.kind === "channel") {
  env.PLAYWRIGHT_CHANNEL = resolved.value;
  console.log(`[appearance-e2e] pakai channel: ${resolved.value}`);
} else {
  console.log(
    "[appearance-e2e] pakai Chromium bawaan Playwright (tidak ada env / binary sistem terdeteksi).",
  );
}

const args = [
  "playwright",
  "test",
  "--project=appearance-import-migrator-e2e",
  ...process.argv.slice(2),
];

const child = spawn("npx", args, { stdio: "inherit", env });
child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  if (code === null) process.exit(1);
  if (code !== 0) {
    console.error(
      "\n[appearance-e2e] Playwright keluar dengan kode " + code + ".",
    );
    console.error(
      "  Bila error menyebut 'Executable doesn\\'t exist' / 'version mismatch',",
    );
    console.error(
      "  set salah satu env berikut lalu jalankan ulang:",
    );
    console.error(
      "    PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome bun run test:appearance-import",
    );
    console.error(
      "    PLAYWRIGHT_CHANNEL=chrome bun run test:appearance-import",
    );
    console.error(
      "  Atau, jika diperkenankan: `npx playwright install chromium`.",
    );
  }
  process.exit(code);
});