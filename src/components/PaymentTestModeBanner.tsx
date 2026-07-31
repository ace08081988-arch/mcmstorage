import { getPaddleEnvironment } from "@/lib/paddle";

export function PaymentTestModeBanner() {
  if (getPaddleEnvironment() !== "sandbox") return null;

  return (
    <div className="w-full rounded-md border border-warning/40 bg-warning/10 px-ms-3 py-ms-2 text-center text-ms-xs text-warning">
      Pembayaran di pratinjau memakai <b>mode uji</b> — tidak ada uang sungguhan yang terpotong.
    </div>
  );
}
