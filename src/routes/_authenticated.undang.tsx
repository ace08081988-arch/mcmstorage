import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Copy, Share2, QrCode, UserPlus, RefreshCcw, Check, Camera } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMyProfile } from "@/lib/profile";
import { QrScannerDialog, handleScannedText } from "@/components/QrScannerDialog";
import { useStartDm } from "@/lib/chat";
import {
  addContactByInviteCode,
  buildInviteUrl,
  formatInviteCode,
  isLikelyInviteCode,
  normalizeInviteCode,
  resolveInviteCode,
  validateInviteCode,
  type InviteProfile,
} from "@/lib/invite";

export const Route = createFileRoute("/_authenticated/undang")({
  component: UndangPage,
});

function UndangPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const startDm = useStartDm();
  const { data: profile } = useMyProfile();
  const myCode = profile?.invite_code ?? "";
  const myUrl = useMemo(() => (myCode ? buildInviteUrl(myCode) : ""), [myCode]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!canvasRef.current || !myUrl) return;
    let cancelled = false;
    import("qrcode")
      .then(({ default: QRCode }) => {
        if (cancelled || !canvasRef.current) return;
        return QRCode.toCanvas(canvasRef.current, myUrl, {
          errorCorrectionLevel: "M",
          margin: 2,
          width: 320,
          color: { dark: "#0f172a", light: "#ffffff" },
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [myUrl]);

  const [copied, setCopied] = useState<"code" | "url" | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  async function copyText(kind: "code" | "url", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      toast.success(kind === "code" ? "PIN disalin." : "Link undangan disalin.");
      setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1500);
    } catch {
      toast.error("Gagal menyalin. Coba tekan lama untuk pilih teks.");
    }
  }

  async function share() {
    const text =
      `Tambahkan saya di Ace Chat. PIN: ${formatInviteCode(myCode)}\n` + `Atau buka: ${myUrl}`;
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: "Undangan Ace Chat", text, url: myUrl });
        return;
      }
      await copyText("url", text);
    } catch (e) {
      const msg = (e as Error).message || "";
      if (!/aborted|cancel/i.test(msg)) toast.error("Gagal membagikan undangan.");
    }
  }

  // ==== Cek/tambah kontak dari PIN teman ====
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<InviteProfile | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [adding, setAdding] = useState(false);

  const cleanInput = normalizeInviteCode(input);
  const looksValid = isLikelyInviteCode(input);
  // L13: sequence id — hanya response request terbaru yang boleh
  // menimpa state preview, mencegah race saat user mengetik cepat
  // atau memoles PIN sebelum request lama selesai.
  const reqIdRef = useRef(0);

  // Autocheck saat panjang cukup
  useEffect(() => {
    if (!looksValid) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    const myReq = ++reqIdRef.current;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const p = await resolveInviteCode(cleanInput);
        if (cancelled || myReq !== reqIdRef.current) return;
        setPreview(p);
        setPreviewError(p ? null : "PIN tidak ditemukan.");
      } catch (e) {
        if (!cancelled && myReq === reqIdRef.current) setPreviewError((e as Error).message || "Gagal memeriksa PIN.");
      } finally {
        if (!cancelled && myReq === reqIdRef.current) setChecking(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [cleanInput, looksValid]);

  async function handleAdd() {
    const v = validateInviteCode(input);
    if (!v.ok) {
      toast.error(v.reason);
      return;
    }
    setAdding(true);
    try {
      const r = await addContactByInviteCode(v.code);
      setInput("");
      setPreview(null);
      qc.invalidateQueries({ queryKey: ["friend-requests"] });
      qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
      if (r.alreadyFriends) {
        toast.success(`Sudah berteman dengan ${r.displayName ?? "kontak"}. Membuka chat…`);
        try {
          const cid = await startDm.mutateAsync(r.linkedUserId);
          if (cid) {
            router.navigate({ to: "/chat/$conversationId", params: { conversationId: cid } });
            return;
          }
          router.navigate({ to: "/chat" });
        } catch (e) {
          console.error("[undang] start_dm failed", e);
          router.navigate({ to: "/chat" });
        }
      } else if (r.incomingReverseId) {
        toast.info(
          `${r.displayName ?? "Kontak"} sudah mengirim permintaan lebih dulu — buka daftar Permintaan untuk menerima.`,
        );
        router.navigate({ to: "/kontak/permintaan" as never });
      } else {
        toast.success(
          r.alreadyExisted
            ? `Permintaan sebelumnya masih menunggu diterima ${r.displayName ?? "kontak"}.`
            : `Permintaan pertemanan terkirim ke ${r.displayName ?? "kontak"}. Chat akan aktif setelah diterima.`,
        );
        router.navigate({ to: "/kontak/permintaan" as never });
      }
    } catch (e) {
      toast.error((e as Error).message || "Gagal menambah kontak.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-background pb-24">
      <header className="sticky top-0 z-10 flex items-center gap-ms-3 border-b bg-background px-ms-4 py-ms-3">
        <button
          type="button"
          aria-label="Kembali"
          onClick={() => router.history.back()}
          className="grid h-9 w-9 place-items-center rounded-full hover:bg-accent"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="flex-1 text-ms-lg font-semibold">Undang teman</h1>
        <Link
          to={"/kontak/permintaan" as never}
          className="rounded-full px-ms-3 py-1 text-ms-xs font-medium text-primary hover:bg-accent"
        >
          Permintaan
        </Link>
      </header>

      {/* Kartu PIN saya */}
      <section className="px-ms-4 pt-4">
        <div className="rounded-2xl border bg-card p-ms-4 shadow-sm">
          <div className="text-ms-xs uppercase tracking-wide text-muted-foreground">PIN saya</div>
          <div className="mt-1 flex items-center gap-ms-3">
            <div className="flex-1 select-all font-mono text-ms-3xl font-semibold tabular-nums tracking-widest text-foreground">
              {myCode ? formatInviteCode(myCode) : "········"}
            </div>
            <Button
              type="button"
              size="icon"
              variant="secondary"
              aria-label="Salin PIN"
              disabled={!myCode}
              onClick={() => copyText("code", myCode)}
            >
              {copied === "code" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="mt-2 text-ms-xs text-muted-foreground">
            Berikan PIN ini ke teman. Saat mereka memasukkan PIN, kamu langsung muncul di daftar
            kontak mereka.
          </p>

          <div className="mt-4 flex flex-wrap gap-ms-2">
            <Button type="button" onClick={share} disabled={!myCode} className="gap-ms-2">
              <Share2 className="h-4 w-4" /> Bagikan link
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => copyText("url", myUrl)}
              disabled={!myUrl}
              className="gap-ms-2"
            >
              {copied === "url" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              Salin link
            </Button>
          </div>
        </div>
      </section>

      {/* Barcode */}
      <section className="px-ms-4 pt-4">
        <div className="rounded-2xl border bg-card p-ms-4 shadow-sm">
          <div className="flex items-center gap-ms-2 text-ms-sm font-medium">
            <QrCode className="h-4 w-4 text-primary" /> Kode batang / QR
          </div>
          <p className="mt-1 text-ms-xs text-muted-foreground">
            Tampilkan ke teman untuk dipindai — mereka akan langsung diarahkan menambah kamu sebagai
            kontak.
          </p>
          <div className="mt-3 flex items-center justify-center">
            <div className="rounded-2xl bg-white p-ms-3 shadow-sm ring-1 ring-border">
              <canvas ref={canvasRef} aria-label="Kode QR undangan" className="h-64 w-64" />
            </div>
          </div>
          <div className="mt-2 break-all text-center text-ms-2xs text-muted-foreground">
            {myUrl || ""}
          </div>
          <div className="mt-3 flex justify-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setScanOpen(true)}
              className="gap-ms-2"
              aria-label="Pindai QR teman dengan kamera"
            >
              <Camera className="h-4 w-4" /> Pindai QR teman
            </Button>
          </div>
        </div>
      </section>

      <QrScannerDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        title="Pindai QR undangan teman"
        description="Arahkan kamera ke QR undangan teman untuk mengisi PIN otomatis."
        onResult={(text) => {
          // Prioritas: kalau URL undangan same-origin → isi PIN dari path
          // `/i/<code>`. Kalau teks tampak PIN → langsung isi. Selain itu
          // fallback ke handler generik (buka/salin).
          const trimmed = text.trim();
          try {
            const u = new URL(trimmed);
            const m = u.pathname.match(/\/i\/([^/?#]+)/i);
            if (m && m[1]) {
              const code = normalizeInviteCode(decodeURIComponent(m[1]));
              setInput(formatInviteCode(code));
              toast.success("PIN dari QR terisi.");
              return;
            }
          } catch {
            /* not a URL */
          }
          if (isLikelyInviteCode(trimmed)) {
            setInput(formatInviteCode(normalizeInviteCode(trimmed)));
            toast.success("PIN dari QR terisi.");
            return;
          }
          void handleScannedText(trimmed);
        }}
      />

      {/* Masukkan PIN teman */}
      <section className="px-ms-4 pt-4">
        <div className="rounded-2xl border bg-card p-ms-4 shadow-sm">
          <div className="flex items-center gap-ms-2 text-ms-sm font-medium">
            <UserPlus className="h-4 w-4 text-primary" /> Masukkan PIN teman
          </div>
          <p className="mt-1 text-ms-xs text-muted-foreground">
            Ketik atau tempel PIN 8 karakter yang teman berikan.
          </p>
          <div className="mt-3 flex flex-col gap-ms-2 sm:flex-row">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Contoh: ABCD-1234"
              className="font-mono text-ms-base tracking-widest"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              maxLength={16}
            />
            <Button
              type="button"
              onClick={handleAdd}
              disabled={!looksValid || !preview || adding}
              className="gap-ms-2"
            >
              <UserPlus className="h-4 w-4" />
              {adding ? "Mengirim…" : "Kirim permintaan"}
            </Button>
          </div>

          {/* Status preview */}
          <div className="mt-3 min-h-[3rem] text-ms-sm">
            {!looksValid && input.length > 0 && (
              <span className="text-warning">
                PIN belum lengkap. Butuh 6–16 karakter huruf/angka.
              </span>
            )}
            {looksValid && checking && (
              <span className="inline-flex items-center gap-ms-2 text-muted-foreground">
                <RefreshCcw className="h-3.5 w-3.5 animate-spin" /> Memeriksa…
              </span>
            )}
            {looksValid && !checking && previewError && (
              <span className="text-destructive">{previewError}</span>
            )}
            {preview && (
              <div className="flex items-center gap-ms-3 rounded-lg border bg-muted/30 p-ms-2">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-orange-950 text-ms-lg font-medium text-orange-300">
                  {(preview.display_name || "?").trim()[0]?.toUpperCase() || "?"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{preview.display_name || "Tanpa nama"}</div>
                  <div className="truncate text-ms-xs text-muted-foreground">
                    PIN {formatInviteCode(preview.invite_code)}
                    {preview.chat_only ? " · Akun Chat" : ""}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 text-center text-ms-xs text-muted-foreground">
          Punya link undangan?{" "}
          <Link to="/" className="text-primary underline">
            Buka lewat browser
          </Link>{" "}
          — link `/i/PIN` akan otomatis menambahkanmu.
        </div>
      </section>
    </main>
  );
}
