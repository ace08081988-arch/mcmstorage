import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Baca allowlist mm:ss dari file konfig eksternal supaya komponen tambahan
// bisa diizinkan tanpa menyentuh rule ini. Setiap entri wajib punya `reason`
// (divalidasi oleh schema JSON dan runtime check di bawah).
const __dirname = dirname(fileURLToPath(import.meta.url));
const mmssAllowlistPath = resolve(__dirname, "eslint.mmss-allowlist.json");
let mmssAllowlistFiles = [];
try {
  const raw = JSON.parse(readFileSync(mmssAllowlistPath, "utf8"));
  if (!Array.isArray(raw?.files)) {
    throw new Error("eslint.mmss-allowlist.json: `files` harus array");
  }
  for (const entry of raw.files) {
    if (!entry?.path || typeof entry.path !== "string") {
      throw new Error("Allowlist entry tanpa `path` string");
    }
    if (!entry?.reason || typeof entry.reason !== "string" || entry.reason.trim().length < 20) {
      throw new Error(
        `Allowlist entry untuk "${entry.path}" wajib punya \`reason\` (>= 20 karakter) yang menjelaskan pengecualian.`,
      );
    }
    if (!entry.path.startsWith("src/components/chat/")) {
      throw new Error(
        `Allowlist entry "${entry.path}" harus di bawah src/components/chat/ (scope rule ini).`,
      );
    }
    mmssAllowlistFiles.push(entry.path);
  }
} catch (err) {
  if (err && err.code === "ENOENT") {
    mmssAllowlistFiles = [];
  } else {
    throw err;
  }
}

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  eslintPluginPrettier,
  // Aktifkan `react-hooks/exhaustive-deps` sebagai ERROR khusus untuk
  // `_authenticated.gudang.tsx`. File ini memuat form Catat Pembelian
  // dengan banyak useMemo/useEffect di sekitar `selectedItem` → `derived`
  // → `warnings`. Dependency array yang bocor pernah menyebabkan
  // ringkasan real-time stale dan sisa state karton/priceMode ikut
  // terbawa antar item, jadi rule ini dinaikkan ke error agar kelalaian
  // dep segera ketahuan di CI (bukan hanya warning yang bisa diabaikan).
  {
    files: ["src/routes/_authenticated.gudang.tsx"],
    rules: {
      "react-hooks/exhaustive-deps": "error",
    },
  },
  // Cegah formatter mm:ss ad-hoc di komponen chat. Semua durasi media
  // WAJIB melewati `formatDurationMMSS` dari `@/lib/format-duration`.
  // Allowlist file dibaca dari `eslint.mmss-allowlist.json` (setiap entri
  // wajib menyertakan `reason`). Inline exception juga didukung via:
  //   // eslint-disable-next-line no-restricted-syntax -- mmss-allow: <alasan>
  {
    files: ["src/components/chat/**/*.{ts,tsx}"],
    ignores: [
      "src/components/chat/**/*.test.{ts,tsx}",
      ...mmssAllowlistFiles,
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='Math'][callee.property.name='floor'] BinaryExpression[operator='/'][right.value=60]",
          message:
            "[mm:ss] `Math.floor(x / 60)` ad-hoc dilarang di src/components/chat.\n" +
            "  Ganti dengan: formatDurationMMSS(x) dari '@/lib/format-duration'.\n" +
            "  Contoh: `${formatDurationMMSS(sec)}` (import: import { formatDurationMMSS } from \"@/lib/format-duration\").\n" +
            "  Auto-fix: jalankan `bun run codemod:mmss` untuk mengganti pola ini di src/components/chat.",
        },
        {
          selector: "BinaryExpression[operator='%'][right.value=60]",
          message:
            "[mm:ss] `x % 60` ad-hoc dilarang di src/components/chat.\n" +
            "  Ganti seluruh label detik→mm:ss dengan: formatDurationMMSS(x) dari '@/lib/format-duration'.\n" +
            "  Auto-fix: jalankan `bun run codemod:mmss` (pola template-literal umum dikonversi otomatis).",
        },
        {
          selector:
            "CallExpression[callee.property.name='padStart'][arguments.0.value=2][arguments.1.value='0']",
          message:
            "[mm:ss] `padStart(2, \"0\")` untuk label waktu dilarang di src/components/chat.\n" +
            "  Ganti dengan: formatDurationMMSS(sec) dari '@/lib/format-duration' — sudah zero-pad menit & detik.\n" +
            "  Auto-fix: jalankan `bun run codemod:mmss`.",
        },
      ],
    },
  },
);
