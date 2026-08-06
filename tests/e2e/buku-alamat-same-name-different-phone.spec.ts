import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  requireAuthState,
  skipUnlessAuth,
  trustTestDevice,
} from "./_helpers/auth-state";

/**
 * E2E regresi: Buku Alamat PERNAH memblokir tombol "Simpan" ketika dua
 * kontak punya NAMA yang sama, padahal indeks unik parsial di database
 * hanya melarang duplikat NOMOR/EMAIL. Spec ini mengunci kontrak:
 *
 *   1. Nama sama + nomor berbeda  → Simpan BERHASIL, muncul toast
 *      "Kontak berhasil diperbarui", dialog tertutup.
 *   2. Nomor yang sama persis (setelah normalisasi +62/08) → tetap
 *      diblokir dengan toast "… sudah terdaftar".
 *
 * Self-skip bila `storageState` kosong (belum login) atau kredensial
 * Supabase tidak tersedia untuk seeding data uji.
 */

function readEnv(): { url: string; key: string } | null {
  const fromProcess = {
    url: process.env.VITE_SUPABASE_URL ?? "",
    key: process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
  };
  if (fromProcess.url && fromProcess.key) return fromProcess;
  try {
    const raw = readFileSync(".env", "utf8");
    const pick = (k: string) =>
      raw.match(new RegExp(`^${k}\\s*=\\s*"?([^"\\n]+)"?`, "m"))?.[1]?.trim() ?? "";
    const url = pick("VITE_SUPABASE_URL");
    const key = pick("VITE_SUPABASE_PUBLISHABLE_KEY");
    return url && key ? { url, key } : null;
  } catch {
    return null;
  }
}

const SUFFIX = `${Date.now()}`.slice(-6);
const NAME = `E2E Nama Kembar ${SUFFIX}`;
const PHONE_A = `08110${SUFFIX}`;
const PHONE_B = `08220${SUFFIX}`;
const PHONE_B_NEW = `08330${SUFFIX}`;

/** Jalankan REST call sebagai user login (token dari localStorage app). */
async function rest(
  page: Page,
  cfg: { url: string; key: string },
  path: string,
  init: { method: string; body?: unknown; headers?: Record<string, string> },
): Promise<{ status: number; body: string }> {
  // Dijalankan lewat APIRequestContext (sisi Node), bukan `page.evaluate`,
  // supaya seeding tidak gagal "Failed to fetch" ketika halaman kebetulan
  // reload (cache-buster/HMR) di tengah permintaan.
  const token = await accessToken(page);
  const res = await page.request.fetch(`${cfg.url}/rest/v1/${path}`, {
    method: init.method,
    headers: {
      apikey: cfg.key,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
    ...(init.body ? { data: init.body } : {}),
  });
  return { status: res.status(), body: await res.text() };
}

/** Baca sesi Supabase dari localStorage (mendukung format `base64-…`). */
async function readSession(page: Page): Promise<Record<string, any> | null> {
  return page.evaluate(() => {
    const authKey = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
    if (!authKey) return null;
    try {
      let raw = localStorage.getItem(authKey) || "";
      if (raw.startsWith("base64-")) raw = atob(raw.slice(7));
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });
}

async function accessToken(page: Page): Promise<string | undefined> {
  const s = await readSession(page);
  return (s?.access_token ?? s?.currentSession?.access_token) as string | undefined;
}

async function currentUserId(page: Page): Promise<string | null> {
  const s = await readSession(page);
  return (s?.user?.id ?? s?.currentSession?.user?.id ?? null) as string | null;
}

test.describe("Buku Alamat — nama sama, nomor berbeda tetap bisa disimpan", () => {
  requireAuthState(test);

  test("Simpan berhasil + toast benar; duplikat nomor tetap diblokir", async ({ page }) => {
    const cfg = readEnv();
    skipUnlessAuth(test, !cfg, "Kredensial Supabase tidak tersedia.");
    if (!cfg) return;

    await page.goto("/buku-alamat", { waitUntil: "domcontentloaded" });
    // Lewati guard verifikasi device baru (OTP email) untuk browser test.
    await trustTestDevice(page);
    const uid = await currentUserId(page);
    skipUnlessAuth(test, !uid, "Tidak ada sesi user aktif di storageState.");

    // ── Seed dua kontak bernama sama dengan nomor berbeda.
    const seed = await rest(page, cfg, "address_book", {
      method: "POST",
      body: [
        { user_id: uid, name: NAME, phone: PHONE_A, source: "manual" },
        { user_id: uid, name: NAME, phone: PHONE_B, source: "manual" },
      ],
    });
    skipUnlessAuth(
      test,
      seed.status >= 400,
      `Seed kontak gagal (${seed.status}) — lewati: ${seed.body.slice(0, 120)}`,
    );

    const seeded = JSON.parse(seed.body) as Array<{ id: string }>;
    const cleanup = async () => {
      for (const r of seeded) {
        await rest(page, cfg, `address_book?id=eq.${r.id}`, { method: "DELETE" });
      }
    };

    try {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByLabel("Cari kontak").fill(NAME);

      // Kartu kedua (nomor B) — nama identik dengan kartu pertama.
      const editButtons = page.getByRole("button", { name: `Edit ${NAME}` });
      await expect(editButtons.first()).toBeVisible({ timeout: 15_000 });
      await expect(editButtons).toHaveCount(2);

      // ── Kasus 1: ubah nomor jadi nomor baru yang unik → HARUS berhasil.
      await editButtons.nth(1).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("heading", { name: "Edit kontak" })).toBeVisible();

      const phoneInput = dialog.getByPlaceholder("Nomor telepon");
      await phoneInput.fill(PHONE_B_NEW);
      // Nama sengaja TIDAK diubah: tetap kembar dengan kontak pertama.
      await expect(dialog.getByPlaceholder("Nama")).toHaveValue(NAME);

      await dialog.getByRole("button", { name: "Simpan" }).click();

      await expect(page.getByText("Kontak berhasil diperbarui")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/sudah terdaftar/i)).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByText(PHONE_B_NEW)).toBeVisible();

      // ── Kasus 2: nomor yang sama persis dengan kontak lain (format +62)
      //   harus tetap diblokir setelah normalisasi.
      await editButtons.nth(1).click();
      const dialog2 = page.getByRole("dialog");
      await expect(dialog2).toBeVisible();
      await dialog2.getByPlaceholder("Nomor telepon").fill(`+62${PHONE_A.slice(1)}`);
      await dialog2.getByRole("button", { name: "Simpan" }).click();

      await expect(page.getByText(/sudah terdaftar/i)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
    } finally {
      await cleanup();
    }
  });
});
