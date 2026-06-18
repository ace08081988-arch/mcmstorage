import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "biz.mcmstorage.app",
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