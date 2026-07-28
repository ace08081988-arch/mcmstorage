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

// Selector mm:ss (scope: src/components/chat).
const MMSS_SELECTORS = [
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
];

// Selector sold_at (scope: src/components, src/routes, src/lib).
const SOLD_AT_SELECTORS = [
  {
    selector:
      "UnaryExpression[operator='!'] > MemberExpression[property.name='sold_at']",
    message:
      "[sold_at] Literal `!x.sold_at` / `!!x.sold_at` dilarang sebagai predikat aktif/terkirim.\n" +
      "  Ganti dengan: isActivePrep(x) atau isSentPrep(x) dari '@/lib/prep-active-selector'.\n" +
      "  Untuk memfilter array: filterActivePreps(preps) / filterSentPreps(preps).\n" +
      "  Untuk menghitung: countActivePreps / countActiveByTitle.",
  },
  {
    selector:
      "BinaryExpression[operator=/^(===|!==|==|!=)$/][left.type='MemberExpression'][left.property.name='sold_at'][right.type='Literal'][right.value=null]",
    message:
      "[sold_at] Perbandingan `x.sold_at === null` / `!== null` dilarang.\n" +
      "  Ganti dengan: isActivePrep(x) / isSentPrep(x) dari '@/lib/prep-active-selector'.\n" +
      "  Ini melindungi konsistensi definisi 'aktif vs terkirim' agar tetap tunggal.",
  },
  {
    selector:
      "CallExpression[callee.property.name='is'][arguments.0.value='sold_at'][arguments.1.type='Literal'][arguments.1.value=null]",
    message:
      "[sold_at] `.is(\"sold_at\", null)` langsung di query dilarang.\n" +
      "  Ganti dengan: withActivePrepsFilter(builder) dari '@/lib/prep-active-selector'.\n" +
      "  Alasan: satu titik untuk mengubah semantik filter aktif.",
  },
];

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
        ...MMSS_SELECTORS,
      ],
    },
  },
  // ── Guardrail: badge "aktif" / "terkirim" untuk paket prep. ────────────
  //
  // Definisi "sent" (paket sudah masuk Riwayat Terkirim) HANYA boleh
  // datang dari helper di `@/lib/prep-active-selector` — `isSentPrep`,
  // `isActivePrep`, `filterActivePreps`, `filterSentPreps`,
  // `countActivePreps`, `countActiveByTitle`, `withActivePrepsFilter`.
  //
  // Rule ini menolak literal umum yang pernah kami temukan menyebabkan
  // badge miring: `!!p.sold_at`, `!p.sold_at`, perbandingan langsung ke
  // null (`p.sold_at === null`), dan filter server-side ad-hoc
  // `.is("sold_at", null)`. Kalau memang butuh (mis. selector-nya sendiri
  // atau modul yang membaca timestamp untuk formatting), pakai
  // `// eslint-disable-next-line no-restricted-syntax -- sold-at-allow: <alasan>`.
  {
    files: [
      "src/components/**/*.{ts,tsx}",
      "src/routes/**/*.{ts,tsx}",
      "src/lib/**/*.{ts,tsx}",
    ],
    ignores: [
      // Selector itu sendiri: definisi resmi predikat.
      "src/lib/prep-active-selector.ts",
      // Read-only guard membaca sold_at hanya untuk formatting nominal /
      // tanggal — predikat "sent"-nya sudah pakai isSentPrep (dites di
      // prep-readonly-guard.test.ts).
      "src/lib/prep-readonly-guard.ts",
      // Tes berhak menulis literal untuk membekukan kontrak / regex
      // guardrail.
      "src/**/*.test.{ts,tsx}",
      "src/**/__tests__/**/*.{ts,tsx}",
      // Route generated & tipe DB dari Supabase.
      "src/routeTree.gen.ts",
      "src/integrations/supabase/types.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // `!<ident>.sold_at` — juga men-cover `!!<ident>.sold_at` karena
          // AST-nya adalah UnaryExpression `!` di luar UnaryExpression `!`
          // di dalam; yang di dalam tetap tercatat.
          selector:
            "UnaryExpression[operator='!'] > MemberExpression[property.name='sold_at']",
          message:
            "[sold_at] Literal `!x.sold_at` / `!!x.sold_at` dilarang sebagai predikat aktif/terkirim.\n" +
            "  Ganti dengan: isActivePrep(x) atau isSentPrep(x) dari '@/lib/prep-active-selector'.\n" +
            "  Untuk memfilter array: filterActivePreps(preps) / filterSentPreps(preps).\n" +
            "  Untuk menghitung: countActivePreps / countActiveByTitle.",
        },
        {
          // Perbandingan langsung terhadap null.
          selector:
            "BinaryExpression[operator=/^(===|!==|==|!=)$/][left.type='MemberExpression'][left.property.name='sold_at'][right.type='Literal'][right.value=null]",
          message:
            "[sold_at] Perbandingan `x.sold_at === null` / `!== null` dilarang.\n" +
            "  Ganti dengan: isActivePrep(x) / isSentPrep(x) dari '@/lib/prep-active-selector'.\n" +
            "  Ini melindungi konsistensi definisi 'aktif vs terkirim' agar tetap tunggal.",
        },
        {
          // Filter server-side ad-hoc — pakai withActivePrepsFilter().
          selector:
            "CallExpression[callee.property.name='is'][arguments.0.value='sold_at'][arguments.1.type='Literal'][arguments.1.value=null]",
          message:
            "[sold_at] `.is(\"sold_at\", null)` langsung di query dilarang.\n" +
            "  Ganti dengan: withActivePrepsFilter(builder) dari '@/lib/prep-active-selector'.\n" +
            "  Alasan: satu titik untuk mengubah semantik filter aktif.",
        },
      ],
    },
  },
);
