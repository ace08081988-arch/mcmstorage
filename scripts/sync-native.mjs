#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Menanam lapisan Android native Ace Chat ke proyek `android/` hasil
 * Capacitor. IDEMPOTENT — aman dijalankan berulang kali dan WAJIB
 * dijalankan SETELAH `cap sync`, karena Capacitor bisa menulis ulang
 * manifest/gradle.
 *
 * Yang dipasang:
 *  - Java: FCM service, action receiver, incoming call UI, FGS panggilan
 *  - Manifest: service/receiver/activity + izin FGS panggilan & full-screen
 *  - Gradle: firebase-messaging (Capacitor hanya menariknya transitif)
 *  - strings: ace_api_base (base URL endpoint aksi notifikasi)
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

// ── 2. strings.xml: ace_api_base ───────────────────────────────────────
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
}

// ── 3. AndroidManifest.xml ─────────────────────────────────────────────
{
  let xml = readFileSync(MANIFEST, "utf8");
  const components = `        ${MARK_MANIFEST}
        <!-- Ace Chat native: FCM data-only, aksi notifikasi, panggilan.
             Dipasang ulang otomatis oleh scripts/sync-native.mjs. -->
        <service
            android:name="biz.mcmstorage.app.AceMessagingService"
            android:exported="false"
            android:directBootAware="false">
            <intent-filter>
                <action android:name="com.google.firebase.MESSAGING_EVENT" />
            </intent-filter>
        </service>

        <service
            android:name="biz.mcmstorage.app.CallForegroundService"
            android:exported="false"
            android:foregroundServiceType="phoneCall" />

        <receiver
            android:name="biz.mcmstorage.app.AceActionReceiver"
            android:exported="false">
            <intent-filter>
                <action android:name="biz.mcmstorage.app.REPLY" />
                <action android:name="biz.mcmstorage.app.MARK_READ" />
                <action android:name="biz.mcmstorage.app.CALL_DECLINE" />
                <action android:name="biz.mcmstorage.app.DISMISS" />
            </intent-filter>
        </receiver>

        <activity
            android:name="biz.mcmstorage.app.IncomingCallActivity"
            android:exported="false"
            android:launchMode="singleInstance"
            android:excludeFromRecents="true"
            android:showOnLockScreen="true"
            android:turnScreenOn="true"
            android:showWhenLocked="true"
            android:theme="@style/AppTheme.NoActionBar"
            android:configChanges="orientation|keyboardHidden|screenSize|uiMode" />

        <activity
            android:name="biz.mcmstorage.app.ChatBubbleActivity"
            android:exported="false"
            android:allowEmbedded="true"
            android:resizeableActivity="true"
            android:documentLaunchMode="always"
            android:theme="@style/AppTheme.NoActionBar"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation|density" />
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

  const perms = [
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_PHONE_CALL",
    "android.permission.MANAGE_OWN_CALLS",
    "android.permission.USE_FULL_SCREEN_INTENT",
  ];
  const missing = perms.filter((p) => !xml.includes(`"${p}"`));
  if (missing.length) {
    const block =
      `\n    <!-- ace-native: panggilan masuk & foreground service saat panggilan -->\n` +
      missing.map((p) => `    <uses-permission android:name="${p}" />`).join("\n") +
      "\n";
    xml = xml.replace("</manifest>", `${block}</manifest>`);
    changed++;
    note(`manifest: izin ${missing.length} ditambahkan`);
  }
  writeFileSync(MANIFEST, xml);
}

// ── 4. build.gradle: firebase-messaging + androidx.core ────────────────
{
  let g = readFileSync(GRADLE, "utf8");
  const block = `    ${MARK_GRADLE}
    // Diperlukan service FCM kustom (Capacitor hanya menariknya transitif,
    // tanpa jaminan API MessagingStyle/CallStyle tersedia saat kompilasi).
    implementation platform("com.google.firebase:firebase-bom:33.7.0")
    implementation "com.google.firebase:firebase-messaging"
    implementation "androidx.core:core:1.13.1"
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