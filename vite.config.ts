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

/**
 * Perbaikan bug chunking bundler (rolldown) pada build SSR.
 *
 * Chunk hasil build kadang mengekspor objek namespace (`*_exports`) yang
 * TIDAK pernah dideklarasikan di chunk itu — mis.
 * `export { server_default as default, ssr_exports as n, ... }` padahal
 * `ssr_exports` tidak ada. Modul seperti itu gagal di-link di worker
 * produksi sehingga seluruh route membalas 500.
 *
 * Plugin ini mendeklarasikan ulang namespace tersebut dari ekspor yang
 * memang ada di chunk yang sama (memakai helper `__exportAll` bawaan
 * bundler yang sudah tersedia di chunk).
 */
function repairMissingNamespaceExports() {
  const DECL = (name: string) =>
    new RegExp(`(?:var|let|const|function|class)\\s+${name}\\b`);
  return {
    name: "lovable:repair-missing-namespace-exports",
    generateBundle(_options: unknown, bundle: Record<string, any>) {
      for (const file of Object.values(bundle)) {
        if (file.type !== "chunk" || typeof file.code !== "string") continue;
        const code: string = file.code;
        if (!code.includes("__exportAll")) continue;
        const match = code.match(/export \{([^}]*)\};?\s*$/);
        if (!match) continue;
        const specs = match[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => {
            const [local, exported = local] = s.split(/\s+as\s+/);
            return { local: local.trim(), exported: exported.trim() };
          });
        const missing = specs.filter(
          (s) =>
            /_exports$/.test(s.local) &&
            !DECL(s.local).test(code) &&
            !new RegExp(`as\\s+${s.local}\\b`).test(
              code.slice(0, code.indexOf("//#region") + 1 || 2000),
            ),
        );
        if (missing.length === 0) continue;
        const members = specs
          .filter((s) => !/_exports$/.test(s.local) && s.local !== "__exportAll")
          .map((s) => `${JSON.stringify(s.exported)}: () => ${s.local}`);
        const patch = missing
          .map(
            (s) =>
              `\nvar ${s.local} = /* @__PURE__ */ __exportAll({ ${members.join(", ")} });\n`,
          )
          .join("");
        file.code = code.replace(/export \{([^}]*)\};?\s*$/, patch + match[0]);
      }
    },
  };
}

export default defineConfig({
  // Build mobile tidak butuh bundle SSR Cloudflare/Nitro — TanStack Start
  // memancarkan output statis ke `.output/public` yang dipakai Capacitor.
  ...(CAPACITOR_BUILD ? ({ nitro: false } as const) : {}),
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
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
      repairMissingNamespaceExports(),
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
