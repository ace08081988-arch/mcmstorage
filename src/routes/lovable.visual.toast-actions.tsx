/**
 * Harness publik untuk uji visual toast beraksi (Undo / Lihat Detail).
 * URL: /lovable/visual/toast-actions — noindex, tanpa auth.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { toastUndo, toastDetail } from "@/lib/toast-actions";

export const Route = createFileRoute("/lovable/visual/toast-actions")({
  head: () => ({
    meta: [
      { title: "Harness · Toast actions" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: ToastActionsHarness,
});

function ToastActionsHarness() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-ms-3 px-ms-4 py-ms-6">
      <h1 className="text-ms-lg font-semibold">Harness: Toast actions</h1>
      <Button
        data-testid="btn-undo"
        variant="outline"
        onClick={() =>
          toastUndo("Pembayaran Rp 2.000.000 dicatat.", () => {}, {
            description: "Tersimpan di catatan hutang.",
          })
        }
      >
        Toast Undo
      </Button>
      <Button
        data-testid="btn-detail"
        variant="outline"
        onClick={() => toastDetail("Penyiapan terkirim ke pelanggan.", { onView: () => {} })}
      >
        Toast Lihat Detail
      </Button>
    </div>
  );
}
