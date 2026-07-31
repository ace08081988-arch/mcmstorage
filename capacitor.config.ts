import type { CapacitorConfig } from "@capacitor/cli";

// Varian build: "full" (default) = MCM Storage lengkap; "chat" = APK
// MCM Chat (UI storage disembunyikan via VITE_APP_MODE=chat).
// Diset lewat env `APP_VARIANT` saat menjalankan `bunx cap sync`.
const variant = (process.env.APP_VARIANT ?? "full").toLowerCase();
const isChat = variant === "chat";

const config: CapacitorConfig = {
  appId: isChat ? "biz.mcmstorage.chat" : "biz.mcmstorage.app",
  appName: isChat ? "MCM Chat" : "MCM Storage",
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