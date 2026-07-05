/**
 * Harness publik (no-auth) untuk uji e2e toast akses-ditolak.
 *
 * Merender 5 tombol yang memicu `notifyError` dengan error khas:
 *   - 42501 (RLS Postgres)
 *   - PGRST301 (JWT PostgREST)
 *   - HTTP 401
 *   - HTTP 403
 *   - error biasa (kontrol negatif — TIDAK boleh tampilkan tombol
 *     "Perbaiki Akses")
 *
 * `window.location.assign` di-hook ringan ke `data-last-assign` pada
 * `#assign-sink` supaya spec bisa memverifikasi target navigasi tanpa
 * benar-benar keluar dari halaman (dan tanpa mengaktifkan auth-gate
 * `_authenticated`).
 *
 * URL: /lovable/visual/access-denied-toast
 * Tidak diindeks, tidak butuh auth, tidak mengirim request server.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { notifyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/lovable/visual/access-denied-toast")({
  head: () => ({
    meta: [
      { title: "Harness · Access denied toast" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AccessDeniedToastHarness,
});

function AccessDeniedToastHarness() {
  // Hook window.location.assign supaya klik "Perbaiki Akses" tidak
  // benar-benar bernavigasi — cukup catat target di DOM agar spec bisa
  // membaca `data-last-assign`. Restore saat unmount.
  useEffect(() => {
    const sink = document.getElementById("assign-sink");
    const orig = window.location.assign.bind(window.location);
    // @ts-expect-error — sengaja override untuk instrumen test
    window.location.assign = (url: string | URL) => {
      const s = typeof url === "string" ? url : url.toString();
      if (sink) sink.setAttribute("data-last-assign", s);
    };
    return () => {
      // @ts-expect-error — kembalikan assign asli
      window.location.assign = orig;
    };
  }, []);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 px-4 py-6">
      <h1 className="text-lg font-semibold">Harness: Access denied toast</h1>
      <div id="assign-sink" data-last-assign="" className="sr-only" />

      <Button
        data-testid="btn-42501"
        variant="outline"
        onClick={() =>
          notifyError({ code: "42501", message: "permission denied for table" })
        }
      >
        Trigger 42501 (RLS)
      </Button>

      <Button
        data-testid="btn-pgrst301"
        variant="outline"
        onClick={() =>
          notifyError({ code: "PGRST301", message: "JWT expired" })
        }
      >
        Trigger PGRST301
      </Button>

      <Button
        data-testid="btn-401"
        variant="outline"
        onClick={() => notifyError({ status: 401, message: "Unauthorized" })}
      >
        Trigger 401
      </Button>

      <Button
        data-testid="btn-403"
        variant="outline"
        onClick={() => notifyError({ status: 403, message: "Forbidden" })}
      >
        Trigger 403
      </Button>

      <Button
        data-testid="btn-generic"
        variant="outline"
        onClick={() =>
          notifyError({ code: "23505", message: "duplicate key" })
        }
      >
        Trigger error biasa (kontrol negatif)
      </Button>
    </div>
  );
}
