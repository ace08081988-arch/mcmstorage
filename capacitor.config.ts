import type { CapacitorConfig } from "@capacitor/cli";

// Varian build: "full" (default) = Ace Storage lengkap; "chat" = APK
// Ace Chat (UI storage disembunyikan via VITE_APP_MODE=chat).
// Diset lewat env `APP_VARIANT` saat menjalankan `bunx cap sync`.
const variant = (process.env.APP_VARIANT ?? "full").toLowerCase();
const isChat = variant === "chat";

const config: CapacitorConfig = {
  // Varian full HARUS memakai `mcmstorage.app` — itu package name aplikasi
  // ACE STORAGE yang sudah terdaftar di Google Play Console. Varian chat
  // tetap `biz.mcmstorage.chat`.
  appId: isChat ? "biz.mcmstorage.chat" : "mcmstorage.app",
  appName: isChat ? "Ace Chat" : "ACE STORAGE",
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