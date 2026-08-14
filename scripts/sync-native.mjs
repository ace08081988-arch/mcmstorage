#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Menanam lapisan Android native MCM Storage ke proyek `android/` hasil
 * Capacitor. IDEMPOTENT — aman dijalankan berulang kali dan WAJIB
 * dijalankan SETELAH `cap sync`, karena Capacitor bisa menulis ulang
 * manifest/gradle.
 *
 * Yang dipasang:
 *  - Java: FCM service + action receiver (balas / tandai dibaca)
 *  - Manifest: service & receiver notifikasi MCM Storage
 *  - Gradle: firebase-messaging (Capacitor hanya menariknya transitif)
 *  - strings: ace_api_base (base URL endpoint aksi notifikasi)
 *
 * Komponen panggilan masuk full-screen, foreground service panggilan, dan
 * conversation bubble SENGAJA tidak ada di sini — itu milik project
 * terpisah MCM: Private Connect (`com.mcm.privateconnect`).
 *
 * Tidak ada secret di sini — token aksi datang dari payload FCM.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const SRC = resolve(root, "native/android/java/biz/mcmstorage/app");
const DEST = resolve(root, "android/app/src/main/java/biz/mcmstorage/app");
const MANIFEST = resolve(root, "android/app/src/main/AndroidManifest.xml");
const STRINGS = resolve(root, "android/app/src/main/res/values/strings.xml");
const GRADLE = resolve(root, "android/app/build.gradle");

const API_BASE = (process.env["ACE_API_BASE"] || "https://mcmstorage.app").replace(/\/+$/, "");
const MARK_MANIFEST = "<!-- ace-native:begin -->";
const MARK_GRADLE = "// ace-native:begin";

let changed = 0;
const note = (m) => console.log(`  ${m}`);

function requireFile(p, hint) {
  if (!existsSync(p)) {
    console.error(`✗ ${p} tidak ada — jalankan \`bunx cap sync android\` dulu.${hint ? ` (${hint})` : ""}`);
    process.exit(1);
  }
}

requireFile(MANIFEST);
requireFile(GRADLE);
requireFile(STRINGS);

// ── 1. Salin sumber Java ────────────────────────────────────────────────
mkdirSync(DEST, { recursive: true });
for (const f of readdirSync(SRC).filter((n) => n.endsWith(".java"))) {
  const from = resolve(SRC, f);
  const to = resolve(DEST, f);
  const next = readFileSync(from, "utf8");
  if (existsSync(to) && readFileSync(to, "utf8") === next) continue;
  copyFileSync(from, to);
  changed++;
  note(`java: ${f}`);
}

// ── 2. strings.xml: API base + package-aligned custom scheme ───────────
{
  let xml = readFileSync(STRINGS, "utf8");
  const entry = `    <string name="ace_api_base">${API_BASE}</string>`;
  if (xml.includes('name="ace_api_base"')) {
    const replaced = xml.replace(/ {4}<string name="ace_api_base">[^<]*<\/string>/, entry);
    if (replaced !== xml) {
      xml = replaced;
      writeFileSync(STRINGS, xml);
      changed++;
      note("strings.xml: ace_api_base diperbarui");
    }
  } else {
    xml = xml.replace("</resources>", `${entry}\n</resources>`);
    writeFileSync(STRINGS, xml);
    changed++;
    note("strings.xml: ace_api_base ditambahkan");
  }
  const schemeEntry = '    <string name="custom_url_scheme">mcmstorage.app</string>';
  if (xml.includes('name="custom_url_scheme"')) {
    const replaced = xml.replace(
      / {4}<string name="custom_url_scheme">[^<]*<\/string>/,
      schemeEntry,
    );
    if (replaced !== xml) {
      xml = replaced;
      writeFileSync(STRINGS, xml);
      changed++;
      note("strings.xml: custom_url_scheme = mcmstorage.app");
    }
  } else {
    xml = xml.replace("</resources>", `${schemeEntry}\n</resources>`);
    writeFileSync(STRINGS, xml);
    changed++;
    note("strings.xml: custom_url_scheme ditambahkan");
  }
}

// ── 3. AndroidManifest.xml ─────────────────────────────────────────────
{
  let xml = readFileSync(MANIFEST, "utf8");
  const components = `        ${MARK_MANIFEST}
        <!-- MCM Storage native: FCM data-only + aksi notifikasi.
             Dipasang ulang otomatis oleh scripts/sync-native.mjs. -->
        <service
            android:name="biz.mcmstorage.app.AceMessagingService"
            android:exported="false"
            android:directBootAware="false">
            <intent-filter>
                <action android:name="com.google.firebase.MESSAGING_EVENT" />
            </intent-filter>
        </service>

        <receiver
            android:name="biz.mcmstorage.app.AceActionReceiver"
            android:exported="false">
            <intent-filter>
                <action android:name="biz.mcmstorage.app.REPLY" />
                <action android:name="biz.mcmstorage.app.MARK_READ" />
                <action android:name="biz.mcmstorage.app.DISMISS" />
            </intent-filter>
        </receiver>
        <!-- ace-native:end -->
`;
  const compRe = new RegExp(`[ \\t]*${MARK_MANIFEST}[\\s\\S]*?<!-- ace-native:end -->\\n`);
  if (compRe.test(xml)) {
    const next = xml.replace(compRe, components);
    if (next !== xml) {
      xml = next;
      changed++;
      note("manifest: komponen diperbarui");
    }
  } else {
    xml = xml.replace("    </application>", `${components}    </application>`);
    changed++;
    note("manifest: komponen ditambahkan");
  }

  // Izin yang HARUS dicabut: MCM Storage tidak punya panggilan masuk
  // full-screen, foreground service panggilan, maupun Telecom/self-managed
  // ConnectionService. Semua itu milik MCM: Private Connect.
  for (const stale of [
    "android.permission.FOREGROUND_SERVICE_PHONE_CALL",
    "android.permission.MANAGE_OWN_CALLS",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_MICROPHONE",
    "android.permission.FOREGROUND_SERVICE_CAMERA",
    "android.permission.USE_FULL_SCREEN_INTENT",
    "android.permission.SYSTEM_ALERT_WINDOW",
  ]) {
    const re = new RegExp(`[ \\t]*<uses-permission android:name="${stale}" />\\n`, "g");
    if (re.test(xml)) {
      xml = xml.replace(re, "");
      changed++;
      note(`manifest: izin ${stale} dihapus`);
    }
  }
  // Komentar sisa dari blok izin panggilan lama.
  const staleComment =
    /[ \t]*<!-- ace-native: panggilan masuk & foreground service saat panggilan -->\n/g;
  if (staleComment.test(xml)) {
    xml = xml.replace(staleComment, "");
    changed++;
    note("manifest: komentar izin panggilan lama dihapus");
  }
  // Deep-link scheme mengikuti applicationId.
  const schemeRe = /android:scheme="biz\.mcmstorage\.app"/g;
  if (schemeRe.test(xml)) {
    xml = xml.replace(schemeRe, 'android:scheme="${applicationId}"');
    changed++;
    note("manifest: scheme deep link mengikuti applicationId");
  }

  writeFileSync(MANIFEST, xml);
}

// ── 4. build.gradle: firebase-messaging + androidx.core ────────────────
{
  let g = readFileSync(GRADLE, "utf8");
  const block = `    ${MARK_GRADLE}
    // Diperlukan service FCM kustom (Capacitor hanya menariknya transitif,
    // tanpa jaminan API MessagingStyle/CallStyle tersedia saat kompilasi).
    // BOM harus >= yang ditarik Capacitor PushNotifications 8, dan
    // androidx.core TIDAK dipin di sini supaya tidak menurunkan versi
    // dari android/variables.gradle (coreVersion).
    implementation platform("com.google.firebase:firebase-bom:34.4.0")
    implementation "com.google.firebase:firebase-messaging"
    // ace-native:end
`;
  const re = new RegExp(`[ \\t]*${MARK_GRADLE.replace("/", "\\/")}[\\s\\S]*?// ace-native:end\\n`);
  if (re.test(g)) {
    const next = g.replace(re, block);
    if (next !== g) {
      g = next;
      changed++;
      note("build.gradle: dependensi diperbarui");
    }
  } else {
    g = g.replace(
      /dependencies \{\n/,
      (m) => `${m}${block}`,
    );
    changed++;
    note("build.gradle: dependensi ditambahkan");
  }
  writeFileSync(GRADLE, g);
}

console.log(
  changed
    ? `✓ sync-native: ${changed} perubahan diterapkan (api base: ${API_BASE})`
    : `✓ sync-native: sudah sinkron (api base: ${API_BASE})`,
);