import type { CapacitorConfig } from "@capacitor/cli";

// SATU identitas Android untuk project ini: MCM Storage.
// Aplikasi chat privat umum adalah project TERPISAH
// (MCM: Private Connect / `com.mcm.privateconnect`) — jangan pernah
// menambahkan varian/flavor chat di sini.
const config: CapacitorConfig = {
  // Package name aplikasi di Google Play Console.
  // Namespace sumber Java tetap `biz.mcmstorage.app` (android/app/build.gradle).
  appId: "mcmstorage.app",
  appName: "MCM Storage",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;