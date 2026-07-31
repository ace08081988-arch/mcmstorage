#!/usr/bin/env node
// Patch ios/App/App/Info.plist agar menerima deep link
// `biz.mcmstorage.app://t/<token>?p=<pin>` di iPhone/iPad.
//
// Jalankan SEKALI setelah `bunx cap add ios` (atau setiap kali Info.plist
// diregenerasi). Skrip idempoten: aman dijalankan berulang — kalau
// CFBundleURLTypes sudah ada dengan scheme yang sama, ia tidak akan
// menduplikasi entri.
//
// Runtime listener sudah ditangani `src/lib/native-deeplink.ts` via
// `@capacitor/app` (lintas-platform) — jadi tidak ada kode Swift yang
// perlu ditambahkan.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PLIST = resolve(process.cwd(), "ios/App/App/Info.plist");
const SCHEME = "biz.mcmstorage.app";
const URL_NAME = "biz.mcmstorage.app.deeplink";

if (!existsSync(PLIST)) {
  console.error(`[patch-ios-deeplink] ${PLIST} tidak ditemukan.`);
  console.error("Jalankan `bunx cap add ios` terlebih dahulu.");
  process.exit(1);
}

let plist = readFileSync(PLIST, "utf8");

if (plist.includes(`<string>${SCHEME}</string>`)) {
  console.log(`[patch-ios-deeplink] Scheme ${SCHEME} sudah terdaftar, tidak ada perubahan.`);
  process.exit(0);
}

const block = `\t<key>CFBundleURLTypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>CFBundleURLName</key>
\t\t\t<string>${URL_NAME}</string>
\t\t\t<key>CFBundleTypeRole</key>
\t\t\t<string>Editor</string>
\t\t\t<key>CFBundleURLSchemes</key>
\t\t\t<array>
\t\t\t\t<string>${SCHEME}</string>
\t\t\t</array>
\t\t</dict>
\t</array>
`;

if (plist.includes("<key>CFBundleURLTypes</key>")) {
  // Sudah ada CFBundleURLTypes lain — sisipkan <dict> tambahan ke dalam <array>-nya.
  const inject = `\t\t<dict>
\t\t\t<key>CFBundleURLName</key>
\t\t\t<string>${URL_NAME}</string>
\t\t\t<key>CFBundleTypeRole</key>
\t\t\t<string>Editor</string>
\t\t\t<key>CFBundleURLSchemes</key>
\t\t\t<array>
\t\t\t\t<string>${SCHEME}</string>
\t\t\t</array>
\t\t</dict>
`;
  plist = plist.replace(
    /(<key>CFBundleURLTypes<\/key>\s*<array>\s*)/,
    `$1${inject}`,
  );
} else {
  // Sisipkan block sebelum </dict> terakhir (penutup root dict).
  const idx = plist.lastIndexOf("</dict>");
  if (idx < 0) {
    console.error("[patch-ios-deeplink] Format Info.plist tidak dikenali.");
    process.exit(1);
  }
  plist = plist.slice(0, idx) + block + plist.slice(idx);
}

writeFileSync(PLIST, plist, "utf8");
console.log(`[patch-ios-deeplink] CFBundleURLTypes ditambahkan untuk scheme ${SCHEME}.`);