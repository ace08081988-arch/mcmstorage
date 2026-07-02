import { useState } from "react";
import { ShoppingCart, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { encodeCard, type CartCard } from "@/lib/chat-cards";
import { friendlyError } from "@/lib/friendly-error";
import type { Json } from "@/integrations/supabase/types";

type Line = { name: string; qty: string; price: string };

function emptyLine(): Line {
  return { name: "", qty: "1", price: "" };
}

function fmtRp(n: number) {
  return `Rp ${new Intl.NumberFormat("id-ID").format(Math.round(n))}`;
}

export function CartComposer({
  conversationId,
  disabled,
  onSent,
}: {
  conversationId: string;
  disabled?: boolean;
  onSent?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  function reset() {
    setLines([emptyLine()]);
    setNote("");
  }

  const total = lines.reduce((acc, l) => {
    const q = Number(l.qty) || 0;
    const p = Number(l.price);
    return acc + (Number.isFinite(p) && l.price.trim() !== "" ? q * p : 0);
  }, 0);

  async function submit() {
    const clean = lines
      .map((l) => ({
        name: l.name.trim(),
        qty: Number(l.qty),
        price: l.price.trim() === "" ? null : Number(l.price),
      }))
      .filter((l) => l.name !== "" && Number.isFinite(l.qty) && l.qty > 0);

    if (clean.length === 0) {
      toast.error("Tambahkan minimal satu barang dengan jumlah > 0.");
      return;
    }
    for (const l of clean) {
      if (l.price !== null && !Number.isFinite(l.price)) {
        toast.error("Harga harus berupa angka.");
        return;
      }
    }

    setSending(true);
    try {
      const trimmedNote = note.trim();
      const { data: cartId, error } = await supabase.rpc("create_chat_cart", {
        p_conversation_id: conversationId,
        p_lines: clean as unknown as Json,
        ...(trimmedNote ? { p_note: trimmedNote } : {}),
      });
      if (error || !cartId) {
        toast.error(friendlyError(error) || "Gagal membuat pesanan.");
        return;
      }

      const card: CartCard = {
        type: "cart",
        cart_group_id: cartId as string,
        currency: "Rp",
        lines: clean.map((l) => ({
          name: l.name,
          qty: l.qty,
          price: l.price,
        })),
        note: note.trim() || null,
      };

      const preview = [
        "🛒 Keranjang",
        ...clean.map(
          (l) =>
            `• ${l.name} × ${l.qty}${
              l.price !== null ? ` — ${fmtRp(l.price * l.qty)}` : ""
            }`,
        ),
        total > 0 ? `Total: ${fmtRp(total)}` : "",
        note.trim() ? `Catatan: ${note.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const { data: session } = await supabase.auth.getUser();
      const senderId = session.user?.id;
      if (!senderId) {
        toast.error("Sesi tidak aktif.");
        return;
      }

      const { error: msgErr } = await supabase.from("messages").insert({
        conversation_id: conversationId,
        sender_id: senderId,
        body: encodeCard(card, preview),
      });
      if (msgErr) {
        toast.error(friendlyError(msgErr) || "Gagal mengirim keranjang.");
        return;
      }

      toast.success(`Keranjang terkirim (${clean.length} item)`);
      reset();
      setOpen(false);
      onSent?.();
    } catch (e) {
      toast.error((e as Error)?.message || "Gagal mengirim keranjang.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={disabled}
          aria-label="Buka keranjang"
          title="Kirim keranjang"
          data-testid="chat-cart-trigger"
        >
          <ShoppingCart className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4" /> Keranjang
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {lines.map((line, i) => (
            <div key={i} className="rounded-md border p-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Barang #{i + 1}
                </span>
                {lines.length > 1 ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    aria-label="Hapus baris"
                    onClick={() =>
                      setLines((prev) => prev.filter((_, idx) => idx !== i))
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>
              <div className="mt-1 space-y-1.5">
                <div>
                  <Label className="text-[11px]">Nama barang</Label>
                  <Input
                    value={line.name}
                    maxLength={200}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l, idx) =>
                          idx === i ? { ...l, name: e.target.value } : l,
                        ),
                      )
                    }
                    placeholder="mis. Beras 5kg"
                    className="h-8"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px]">Jumlah</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      value={line.qty}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l, idx) =>
                            idx === i ? { ...l, qty: e.target.value } : l,
                          ),
                        )
                      }
                      className="h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">Harga satuan (opsional)</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      value={line.price}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l, idx) =>
                            idx === i ? { ...l, price: e.target.value } : l,
                          ),
                        )
                      }
                      placeholder="Rp"
                      className="h-8"
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setLines((prev) => [...prev, emptyLine()])}
            disabled={lines.length >= 50}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Tambah barang
          </Button>

          <div>
            <Label className="text-[11px]">Catatan (opsional)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="mis. Antar sore, bayar COD"
              rows={2}
              maxLength={500}
            />
          </div>
        </div>

        <div className="flex items-center justify-between border-t pt-2 text-sm">
          <span className="text-muted-foreground">Total (dari yang berharga)</span>
          <span className="font-semibold tabular-nums">{fmtRp(total)}</span>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={sending}>
            Batal
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={sending}>
            {sending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Kirim keranjang
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}