import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/integration/**/*.test.ts"],
    exclude: ["node_modules", "tests/visual/**", "dist", ".tanstack"],
    environment: "node",
    testTimeout: 20_000,
  },
});