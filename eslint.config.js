import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

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
  // Cegah formatter mm:ss ad-hoc di komponen chat. Semua durasi media
  // WAJIB melewati `formatDurationMMSS` dari `@/lib/format-duration`.
  // Allowlist file di override berikutnya bila perlu (mis. AttachMenu
  // yang menampilkan elapsed upload, bukan durasi media).
  {
    files: ["src/components/chat/**/*.{ts,tsx}"],
    ignores: [
      "src/components/chat/**/*.test.{ts,tsx}",
      // Allowlist: bukan durasi media attachment.
      "src/components/chat/AttachMenu.tsx",
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
