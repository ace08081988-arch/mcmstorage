/**
 * Harness publik (no-auth) untuk e2e "dua user berbeda pada device yang
 * sama tidak boleh saling melihat draft nama pegawai".
 *
 * Kami TIDAK memakai login Supabase asli karena harness harus no-auth.
 * Sebagai gantinya, kami memuat `scopedKey` dari lib sebenarnya
 * (`@/lib/user-scoped-storage`) supaya spec memvalidasi implementasi
 * produksi — bukan salinan lokal. `userId` disimulasikan lewat tombol
 * "Sign in sebagai U1/U2" dan meniru side-effect utama produksi:
 *   - Menyimpan `sb-<ref>-auth-token` di localStorage → membuat
 *     `peekUserIdSync()` mengembalikan userId yang benar walau
 *     `useCurrentUserId()` belum resolve.
 *   - Menghidrasi/menyimpan draft menggunakan key ter-scope produksi
 *     `mcm:sendPrepLink:workerName:u:<uid>:<titleId>`.
 *
 * Marker DOM:
 *   [data-testid="active-user"]         → uid aktif di UI
 *   [data-testid="login-u1|u2|out"]     → tombol switch user
 *   [data-testid="title-A|B"]           → pilih title aktif
 *   [data-testid="worker-name"]         → input nama pegawai
 *   [data-testid="worker-echo"]         → nilai state saat ini
 *   [data-testid="scoped-key"]          → key ter-scope yang dipakai
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { scopedKey, peekUserIdSync } from "@/lib/user-scoped-storage";

export const Route = createFileRoute("/lovable/visual/two-user-drafts")({
  head: () => ({
    meta: [
      { title: "Harness · Two-user localStorage isolation" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: Harness,
});

// Kunci Supabase v2 di localStorage; nilai dibaca oleh peekUserIdSync().
const SB_TOKEN_KEY = "sb-harness-auth-token";

function writeFakeSession(userId: string | null) {
  if (userId) {
    window.localStorage.setItem(
      SB_TOKEN_KEY,
      JSON.stringify({ user: { id: userId }, access_token: "x", refresh_token: "y" }),
    );
  } else {
    window.localStorage.removeItem(SB_TOKEN_KEY);
  }
}

function Harness() {
  const [uid, setUid] = useState<string | null>(null);
  const [titleId, setTitleId] = useState<"A" | "B">("A");
  // Kunci ter-scope produksi.
  const key = scopedKey("mcm:sendPrepLink:workerName", uid, titleId);
  const [name, setName] = useState<string>("");
  const loadedKeyRef = useRef<string | null>(null);

  // LOAD: setiap kali key berubah, hidrasi state dari localStorage[key].
  useEffect(() => {
    const saved = window.localStorage.getItem(key) ?? "";
    setName(saved);
    loadedKeyRef.current = key;
  }, [key]);

  // SAVE: guard sama seperti produksi — tolak simpan bila key belum
  // ter-hidrasi (transisi title/user).
  useEffect(() => {
    if (loadedKeyRef.current !== key) return;
    if (name) window.localStorage.setItem(key, name);
    else window.localStorage.removeItem(key);
  }, [name, key]);

  function signIn(next: string | null) {
    writeFakeSession(next);
    setUid(next);
    // Verifikasi peek sinkron mengikuti sesi baru (tanpa bergantung ke
    // Supabase auth listener yang tak ada di harness ini).
    // eslint-disable-next-line no-console
    console.info("[harness] peekUserIdSync →", peekUserIdSync());
  }

  return (
    <main className="mx-auto max-w-md space-y-4 p-4 text-sm">
      <h1 className="text-lg font-semibold">Two-user drafts</h1>
      <div className="flex flex-wrap gap-2">
        <button data-testid="login-u1" className="rounded border px-2 py-1"
          onClick={() => signIn("user-1")}>Sign in U1</button>
        <button data-testid="login-u2" className="rounded border px-2 py-1"
          onClick={() => signIn("user-2")}>Sign in U2</button>
        <button data-testid="login-out" className="rounded border px-2 py-1"
          onClick={() => signIn(null)}>Sign out</button>
      </div>
      <div>Active user: <span data-testid="active-user">{uid ?? "anon"}</span></div>
      <div className="flex gap-2">
        <button data-testid="title-A" className="rounded border px-2 py-1"
          onClick={() => setTitleId("A")} disabled={titleId === "A"}>Title A</button>
        <button data-testid="title-B" className="rounded border px-2 py-1"
          onClick={() => setTitleId("B")} disabled={titleId === "B"}>Title B</button>
      </div>
      <label className="block">
        <span className="block text-xs text-muted-foreground">Nama pegawai (title {titleId})</span>
        <input
          data-testid="worker-name"
          className="w-full rounded border px-2 py-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div>Nilai state: <span data-testid="worker-echo">{name || "(kosong)"}</span></div>
      <div className="break-all text-xs text-muted-foreground">
        Key: <span data-testid="scoped-key">{key}</span>
      </div>
    </main>
  );
}