// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadEnv } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEnv = loadEnv("development", process.cwd(), "");
Object.assign(process.env, serverEnv);

const BUILD_ID = (() => {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${t}-${r}`;
})();
const BUILD_TIME = new Date().toISOString();

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    routeFileIgnorePattern: "(?:^|/)_[^/]+\\.test\\.(?:ts|tsx)$|(?:^|/)_authenticated\\.gudang\\.strict-compute-spy\\.ts$",
  },
  vite: {
    resolve: {
      alias: {
        "entities/lib/decode.js": path.resolve(
          __dirname,
          "node_modules/entities/lib/decode.js",
        ),
        "entities/lib/encode.js": path.resolve(
          __dirname,
          "node_modules/entities/lib/encode.js",
        ),
        entities: path.resolve(__dirname, "node_modules/entities"),
      },
    },
    define: {
      __BUILD_ID__: JSON.stringify(BUILD_ID),
      __BUILD_TIME__: JSON.stringify(BUILD_TIME),
    },
  },
});
