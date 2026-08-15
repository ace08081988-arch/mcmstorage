// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { loadEnv } from "vite";
import { visualizer } from "rollup-plugin-visualizer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEnv = loadEnv("development", process.cwd(), "");
Object.assign(process.env, serverEnv);

const BUILD_ID = (() => {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${t}-${r}`;
})();
const BUILD_TIME = new Date().toISOString();

// Versi skema DB = prefix timestamp migrasi terbaru. Dihitung di build time
// supaya SecurityScanReminder tidak perlu import.meta.glob eager (yang dulu
// menyeret ratusan URL migrasi ke bundle Beranda).
const MIGRATION_VERSION = (() => {
  try {
    const dir = path.resolve(__dirname, "supabase/migrations");
    const names = fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".sql"))
      .sort();
    const last = names[names.length - 1];
    if (!last) return "";
    const m = last.match(/^(\d{14})/);
    return m ? m[1] : last;
  } catch {
    return "";
  }
})();

// Bundle analyzer aktif hanya saat ANALYZE=1 supaya build normal / dev
// tidak terbebani. Jalankan: `bun run analyze`.
const ANALYZE = process.env.ANALYZE === "1" || process.env.ANALYZE === "true";

// Build khusus Capacitor (APK/AAB): TanStack Start dalam mode SPA/static
// sehingga menghasilkan shell HTML statis yang bisa dipakai WebView.
// HANYA aktif lewat env `CAPACITOR_BUILD=1` — build web SSR/Cloudflare
// normal tidak terpengaruh sama sekali.
const CAPACITOR_BUILD =
  process.env.CAPACITOR_BUILD === "1" || process.env.CAPACITOR_BUILD === "true";

export default defineConfig({
  // Build mobile tidak butuh bundle SSR Cloudflare/Nitro — TanStack Start
  // memancarkan output statis ke `.output/public` yang dipakai Capacitor.
  ...(CAPACITOR_BUILD ? ({ nitro: false } as const) : {}),
  tanstackStart: {
    ...(CAPACITOR_BUILD
      ? {
          spa: {
            enabled: true,
            prerender: {
              enabled: true,
              outputPath: "/index.html",
              crawlLinks: false,
            },
          },
        }
      : {}),
    router: {
      routeFileIgnorePattern:
        "(?:^|/)[-_][^/]+\\.test\\.(?:ts|tsx)$|(?:^|/)_authenticated\\.gudang\\.strict-compute-spy\\.ts$",
      codeSplittingOptions: {
        defaultBehavior: [
          ["component"],
          ["pendingComponent"],
          ["errorComponent"],
          ["notFoundComponent"],
        ],
      },
    },
  },
  vite: {
    plugins: [
      mcpPlugin(),
      ...(ANALYZE
        ? [
            visualizer({
              filename: "bundle-report/stats.html",
              template: "treemap",
              gzipSize: true,
              brotliSize: true,
              sourcemap: false,
              emitFile: false,
            }),
          ]
        : []),
    ],
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
    build: {
      rollupOptions: {
        output: {
          // Runtime TanStack Start (createMiddleware + start-server core +
          // helper runtime bundler) HARUS berada dalam satu chunk. Bila
          // terpisah, bundler menghasilkan impor melingkar sehingga worker
          // produksi crash saat boot dengan
          // "createMiddleware is not a function" dan semua route balas 500.
          advancedChunks: {
            groups: [
              {
                name: "tanstack-start-runtime",
                test: /(rolldown-runtime|createMiddleware|[/\\]server-[^/\\]*\.js$|start-server|react-start)/,
                priority: 100,
              },
            ],
          },
        },
      },
    },
    define: {
      __BUILD_ID__: JSON.stringify(BUILD_ID),
      __BUILD_TIME__: JSON.stringify(BUILD_TIME),
      __MIGRATION_VERSION__: JSON.stringify(MIGRATION_VERSION),
    },
  },
});
