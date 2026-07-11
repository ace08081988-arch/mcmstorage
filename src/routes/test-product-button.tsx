import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ProductSharePopover, type PickedProductRow } from "@/components/chat/ProductSharePopover";

export const Route = createFileRoute("/test-product-button")({
  component: TestProductButtonPage,
});

function TestProductButtonPage() {
  const [rows, setRows] = useState<PickedProductRow[]>([]);
  return (
    <div className="flex min-h-screen flex-col justify-end p-4">
      <div className="mb-4 text-sm text-muted-foreground">
        Fokus textarea di bawah, lalu tekan tombol 📦. Keyboard virtual seharusnya
        tidak muncul dan popover produk terbuka penuh.
      </div>
      <textarea
        className="mb-2 w-full rounded border p-2"
        placeholder="Tulis pesan…"
        rows={2}
      />
      <div className="flex items-center gap-2 border-t p-2">
        <ProductSharePopover
          conversationId="test-conv"
          onQueue={(row) => setRows((prev) => [...prev, row])}
        />
      </div>
      {rows.length > 0 ? (
        <div className="mt-2 text-xs">Queued: {rows.map((r) => r.productName).join(", ")}</div>
      ) : null}
    </div>
  );
}
