import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { ArrowLeft, Copy, Share2, QrCode, UserPlus, RefreshCcw, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMyProfile } from "@/lib/profile";
import {
  addContactByInviteCode,
  buildInviteUrl,
  formatInviteCode,
  isLikelyInviteCode,
  normalizeInviteCode,
  resolveInviteCode,
  type InviteProfile,
} from "@/lib/invite";

export const Route = createFileRoute("/_authenticated/undang")({
  component: UndangPage,
});

function UndangPage() {
  const router = useRouter();
  const { data: profile } = useMyProfile();
  const myCode = profile?.invite_code ?? "";
  const myUrl = useMemo(() => (myCode ? buildInviteUrl(myCode) : ""), [myCode]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!canvasRef.current || !myUrl) return;
    QRCode.toCanvas(canvasRef.current, myUrl, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 320,
      color: { dark: "#0f172a", light: "#ffffff" },
    }).catch(() => {});
  }, [myUrl]);

  const [copied, setCopied] = useState<"code" | "url" | null>(null);
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
      `Tambahkan saya di MCM Chat. PIN: ${formatInviteCode(myCode)}\n` +
      `Atau buka: ${myUrl}`;
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: "Undangan MCM Chat", text, url: myUrl });
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

  // Autocheck saat panjang cukup
  useEffect(() => {
    if (!looksValid) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const p = await resolveInviteCode(cleanInput);
        if (cancelled) return;
        setPreview(p);
        setPreviewError(p ? null : "PIN tidak ditemukan.");
      } catch (e) {
        if (!cancelled) setPreviewError((e as Error).message || "Gagal memeriksa PIN.");
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [cleanInput, looksValid]);

  async function handleAdd() {
    if (!looksValid) return;
    setAdding(true);
    try {
      const r = await addContactByInviteCode(cleanInput);
      toast.success(
        r.alreadyExisted
          ? `Sudah ada di kontak: ${r.displayName ?? "Kontak"}`
          : `Ditambahkan: ${r.displayName ?? "Kontak"}`,
      );
      setInput("");
      setPreview(null);
      // Buka chat langsung — pengalaman ala BBM.
      router.navigate({ to: "/chat" });
    } catch (e) {
      toast.error((e as Error).message || "Gagal menambah kontak.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-background pb-24">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background px-4 py-3">
        <button
          type="button"
          aria-label="Kembali"
          onClick={() => router.history.back()}
          className="grid h-9 w-9 place-items-center rounded-full hover:bg-accent"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="flex-1 text-lg font-semibold">Undang teman</h1>
      </header>

      {/* Kartu PIN saya */}
      <section className="px-4 pt-4">
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            PIN saya
          </div>
          <div className="mt-1 flex items-center gap-3">
            <div className="flex-1 select-all font-mono text-3xl font-semibold tabular-nums tracking-widest text-foreground">
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
          <p className="mt-2 text-xs text-muted-foreground">
            Berikan PIN ini ke teman. Saat mereka memasukkan PIN, kamu langsung
            muncul di daftar kontak mereka.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" onClick={share} disabled={!myCode} className="gap-2">
              <Share2 className="h-4 w-4" /> Bagikan link
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => copyText("url", myUrl)}
              disabled={!myUrl}
              className="gap-2"
            >
              {copied === "url" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              Salin link
            </Button>
          </div>
        </div>
      </section>

      {/* Barcode */}
      <section className="px-4 pt-4">
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-medium">
            <QrCode className="h-4 w-4 text-primary" /> Kode batang / QR
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Tampilkan ke teman untuk dipindai — mereka akan langsung diarahkan menambah kamu sebagai kontak.
          </p>
          <div className="mt-3 flex items-center justify-center">
            <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-border">
              <canvas
                ref={canvasRef}
                aria-label="Kode QR undangan"
                className="h-64 w-64"
              />
            </div>
          </div>
          <div className="mt-2 break-all text-center text-[11px] text-muted-foreground">
            {myUrl || ""}
          </div>
        </div>
      </section>

      {/* Masukkan PIN teman */}
      <section className="px-4 pt-4">
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-medium">
            <UserPlus className="h-4 w-4 text-primary" /> Masukkan PIN teman
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Ketik atau tempel PIN 8 karakter yang teman berikan.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Contoh: ABCD-1234"
              className="font-mono text-base tracking-widest"
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
              className="gap-2"
            >
              <UserPlus className="h-4 w-4" />
              {adding ? "Menambah…" : "Tambah kontak"}
            </Button>
          </div>

          {/* Status preview */}
          <div className="mt-3 min-h-[3rem] text-sm">
            {!looksValid && input.length > 0 && (
              <span className="text-amber-500">PIN belum lengkap. Butuh 6–16 karakter huruf/angka.</span>
            )}
            {looksValid && checking && (
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <RefreshCcw className="h-3.5 w-3.5 animate-spin" /> Memeriksa…
              </span>
            )}
            {looksValid && !checking && previewError && (
              <span className="text-destructive">{previewError}</span>
            )}
            {preview && (
              <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-2">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-orange-950 text-lg font-medium text-orange-300">
                  {(preview.display_name || "?").trim()[0]?.toUpperCase() || "?"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {preview.display_name || "Tanpa nama"}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    PIN {formatInviteCode(preview.invite_code)}
                    {preview.chat_only ? " · Akun Chat" : ""}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 text-center text-xs text-muted-foreground">
          Punya link undangan? <Link to="/" className="text-primary underline">Buka lewat browser</Link> — link `/i/PIN` akan otomatis menambahkanmu.
        </div>
      </section>
    </main>
  );
}