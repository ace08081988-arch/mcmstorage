/**
 * Harness publik (no-auth, no-network) untuk menguji perilaku validasi
 * inline form Minimum Versi Kompatibel di halaman Pengaturan APK.
 *
 * Merender ulang kontrol form yang sama (Input + tombol Simpan + toast)
 * dan memakai `validateMinSupportedForm` dari `@/lib/apk-min-validate`
 * yang jadi sumber kebenaran di halaman admin `pengaturan-apk`.
 *
 * URL: /lovable/visual/min-supported-form
 * Bukan diindeks, tidak butuh auth, tidak mengirim request server.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  validateMinSupportedForm,
  hasAnyError,
} from "@/lib/apk-min-validate";

export const Route = createFileRoute("/lovable/visual/min-supported-form")({
  head: () => ({
    meta: [
      { title: "Harness · MinSupported form" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: MinSupportedFormHarness,
});

function MinSupportedFormHarness() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState({
    name: false,
    code: false,
    reason: false,
  });
  const [savedCount, setSavedCount] = useState(0);

  const errors = useMemo(
    () => validateMinSupportedForm({ name, code, reason }),
    [name, code, reason],
  );
  const invalid = hasAnyError(errors);

  const attemptSave = () => {
    setTouched({ name: true, code: true, reason: true });
    if (invalid) {
      toast.error("Perbaiki input yang tidak valid dulu");
      return;
    }
    setSavedCount((n) => n + 1);
    toast.success("Tersimpan");
  };

  return (
    <main className="mx-auto max-w-md space-y-3 p-4">
      <h1 className="text-base font-semibold">Harness MinSupported form</h1>
      <section className="rounded-xl border bg-card p-3 shadow-sm">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] font-medium" htmlFor="mf-name">
              Min. versi (semver)
            </label>
            <Input
              id="mf-name"
              data-testid="mf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, name: true }))}
              placeholder="mis. 1.2.0"
              className={`h-8 font-mono text-xs ${
                touched.name && errors.name
                  ? "border-red-500 focus-visible:ring-red-500"
                  : ""
              }`}
              aria-invalid={touched.name && !!errors.name}
            />
            {touched.name && errors.name && (
              <p
                data-testid="mf-name-error"
                className="mt-1 text-[11px] leading-snug text-red-600"
              >
                {errors.name}
              </p>
            )}
          </div>
          <div>
            <label className="text-[11px] font-medium" htmlFor="mf-code">
              Min. build
            </label>
            <Input
              id="mf-code"
              data-testid="mf-code"
              value={code}
              inputMode="numeric"
              onChange={(e) => setCode(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, code: true }))}
              placeholder="mis. 45"
              className={`h-8 font-mono text-xs ${
                touched.code && errors.code
                  ? "border-red-500 focus-visible:ring-red-500"
                  : ""
              }`}
              aria-invalid={touched.code && !!errors.code}
            />
            {touched.code && errors.code && (
              <p
                data-testid="mf-code-error"
                className="mt-1 text-[11px] leading-snug text-red-600"
              >
                {errors.code}
              </p>
            )}
          </div>
        </div>
        <div className="mt-2">
          <label className="text-[11px] font-medium" htmlFor="mf-reason">
            Alasan (opsional)
          </label>
          <Input
            id="mf-reason"
            data-testid="mf-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, reason: true }))}
            placeholder="mis. Perbaikan keamanan penting"
            className={`h-8 text-xs ${
              touched.reason && errors.reason
                ? "border-red-500 focus-visible:ring-red-500"
                : ""
            }`}
            aria-invalid={touched.reason && !!errors.reason}
          />
          {touched.reason && errors.reason && (
            <p
              data-testid="mf-reason-error"
              className="mt-1 text-[11px] leading-snug text-red-600"
            >
              {errors.reason}
            </p>
          )}
        </div>
        {errors.form &&
          (touched.name || touched.code || touched.reason) && (
            <div
              data-testid="mf-form-error"
              className="mt-2 flex items-start gap-1.5 rounded-lg border border-red-300 bg-red-50 p-2 text-[11px] text-red-700"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{errors.form}</span>
            </div>
          )}
        <div className="mt-2 flex items-center justify-between gap-2">
          <p
            data-testid="mf-saved-count"
            className="text-[11px] text-muted-foreground"
          >
            saved={savedCount}
          </p>
          <Button
            type="button"
            size="sm"
            data-testid="mf-save"
            disabled={invalid}
            onClick={attemptSave}
          >
            Simpan
          </Button>
          {/* Tombol paksa: mengabaikan status disabled untuk verifikasi
              bahwa attemptSave sendiri juga guard-nya (toast error). */}
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="mf-save-force"
            onClick={attemptSave}
          >
            Paksa simpan
          </Button>
        </div>
      </section>
    </main>
  );
}
